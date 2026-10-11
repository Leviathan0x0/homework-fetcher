//! Authentication and session lifecycle.
//!
//! The only place that knows how a credential becomes a session. Handlers call
//! these operations; they never touch SQL or hashing themselves. Passwords are held
//! in the arguments of [`authenticate`] and its callers for exactly as long as the
//! verification takes, and are never logged, never written to the database, and never
//! put in a response.

use argon2::password_hash::phc::PasswordHash;
use argon2::password_hash::{PasswordHasher, PasswordVerifier};
use argon2::{Algorithm, Argon2, Params, Version};
use sqlx::SqlitePool;

use crate::clock::now_ms;
use crate::config::Config;
use crate::cookies::{hash_token, new_session_id, new_session_token};
use crate::devices::DeviceInfo;
use crate::models::User;
use crate::repositories::{credentials, sessions, users};

/// Why authentication failed, in the two shapes a caller has to treat differently.
///
/// The distinction is deliberately *not* visible to the client: every failure that
/// is not a malformed request answers with the same 401 and the same message, so
/// login cannot be used to find out which school IDs exist. `Database` exists for the
/// logs and for the service layer, never for the response body.
#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    /// The request itself was unusable: no school ID, no password.
    #[error("{0}")]
    BadRequest(&'static str),
    /// The school ID is unknown, the password is wrong, or the account has no local
    /// credential. One bucket, one message.
    #[error("invalid credentials")]
    InvalidCredentials,
    /// Storage failed. Surfaced as a 500, never as an authentication answer.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

/// The school's own email domain. A student may type either their roll number or
/// their school email address, and both must reach the same account.
const SCHOOL_EMAIL_DOMAIN: &str = "@manavmangalschool.com";

/// A successfully authenticated user, as the rest of the application needs to see
/// them: enough for authorization, nothing secret.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Principal {
    pub user_id: i64,
    pub school_id: String,
    pub display_name: Option<String>,
    pub role: crate::models::Role,
    pub class_id: Option<i64>,
    /// The public id of the session this request arrived on.
    ///
    /// `None` for a principal built from a `User` rather than from a session -- an
    /// account record knows nothing about which browser is calling. Handlers that need
    /// it (the device list, "sign out other devices") read it from here and never from
    /// the request, so there is no client-supplied value that could name somebody
    /// else's session.
    pub session_id: Option<String>,
}

/// A freshly issued session: the one and only time the plaintext token exists
/// outside the request that produced it.
#[derive(Debug, Clone)]
pub struct IssuedSession {
    pub token: String,
    /// The public id, so a caller can show "this is the device you are on" without
    /// ever being handed the token.
    pub id: String,
    pub expires_at: i64,
}

pub struct AuthService<'a> {
    db: &'a SqlitePool,
    session_ttl_ms: i64,
    session_idle_ms: i64,
}

impl<'a> AuthService<'a> {
    pub fn new(db: &'a SqlitePool, config: &Config) -> Self {
        Self {
            db,
            session_ttl_ms: config.session_ttl_ms,
            session_idle_ms: config.session_idle_ms,
        }
    }

    /// Normalises a school ID the way the old login did.
    ///
    /// Students sign in with their school email as often as with their roll number,
    /// and the old flow stripped the school domain before looking anyone up, so that
    /// kept working. Otherwise the value is only trimmed: no case folding and no
    /// locale rules, because those would make two different IDs resolve to one
    /// account depending on where the server happens to run.
    pub fn normalize_school_id(raw: &str) -> String {
        let trimmed = raw.trim();
        // The old implementation used a case-insensitive regex, so the domain is
        // matched the same way. The comparison is ASCII-only for the same reason the
        // rest of this function avoids locale rules.
        let Some(stem) = trimmed
            .len()
            .checked_sub(SCHOOL_EMAIL_DOMAIN.len())
            .filter(|stem| trimmed[*stem..].eq_ignore_ascii_case(SCHOOL_EMAIL_DOMAIN))
        else {
            return trimmed.to_owned();
        };
        // An address that is only the domain, or empty before the @, is not an ID.
        if stem == 0 {
            return trimmed.to_owned();
        }
        trimmed[..stem].trim().to_owned()
    }

    /// Resolves the account and verifies the password.
    ///
    /// Lookup is exact first, then case-insensitive, which is what the old login did
    /// and what a student who mistypes the case of their own roll number expects. The
    /// stored identifier is never rewritten.
    ///
    /// A wrong password and an unknown school ID both return
    /// [`AuthError::InvalidCredentials`] and both cost the same work, so the response
    /// timing does not reveal which one it was.
    pub async fn authenticate(
        &self,
        school_id: &str,
        password: &str,
    ) -> Result<Principal, AuthError> {
        if school_id.is_empty() {
            return Err(AuthError::BadRequest("School ID is required."));
        }
        if password.is_empty() {
            return Err(AuthError::BadRequest("Password is required."));
        }

        let user = match users::find_by_school_id(self.db, school_id).await? {
            Some(user) => Some(user),
            None => users::find_by_school_id_ignore_case(self.db, school_id).await?,
        };

        let Some(user) = user.filter(User::is_active) else {
            // No account, or one that has been deactivated. Same answer, same work:
            // verifying against the throwaway hash is what stops a caller learning from
            // the response time that a school ID exists but is switched off.
            let _ = verify_password(password, dummy_hash());
            return Err(AuthError::InvalidCredentials);
        };

        let Some(hash) = credentials::find_password_hash(self.db, user.id).await? else {
            // A real account with no local credential: this deployment does not hold
            // its password. Same answer as a wrong password, and a later phase's
            // school-portal check slots in here without changing anything above.
            let _ = verify_password(password, dummy_hash());
            return Err(AuthError::InvalidCredentials);
        };

        if !verify_password(password, &hash) {
            return Err(AuthError::InvalidCredentials);
        }
        Ok(Principal::from(user))
    }

    /// Issues a session for a user and returns the token to hand to the client once.
    ///
    /// `device` is what the sign-in looked like from the outside. It is recorded so the
    /// account owner can recognise their own devices later, and nothing else reads it.
    pub async fn create_session(
        &self,
        user_id: i64,
        device: &DeviceInfo,
    ) -> Result<IssuedSession, AuthError> {
        let token = new_session_token();
        let id = new_session_id();
        let expires_at = now_ms() + self.session_ttl_ms;
        // The digest is what is stored. The token itself is returned to the caller
        // and is not recoverable from the database afterwards.
        sessions::create(
            self.db,
            sessions::NewSession {
                token_hash: &hash_token(&token),
                id: &id,
                user_id,
                expires_at,
                device_label: &device.label,
            },
        )
        .await?;
        Ok(IssuedSession {
            token,
            id,
            expires_at,
        })
    }

    /// Resolves a session token to its user, or `None` when it is not valid.
    ///
    /// Validity is decided by the row, not by anything in the token: a revoked or
    /// expired session is refused even though its token is still perfectly
    /// well-formed. An expired row is deleted on the way past, so a client that keeps
    /// presenting a dead cookie stops costing a lookup after the first time.
    ///
    /// This is the single choke point every authenticated request goes through, which
    /// is what makes "revocation takes effect immediately" true: a revocation deletes
    /// the row, and this function is the one thing every handler calls.
    pub async fn validate_session(&self, token: &str) -> Result<Option<Principal>, AuthError> {
        if token.is_empty() {
            return Ok(None);
        }
        let token_hash = hash_token(token);

        let Some(session) = sessions::find_by_token_hash(self.db, &token_hash).await? else {
            return Ok(None);
        };
        let now = now_ms();
        // Both windows are checked here rather than at each call site, and an
        // unusable row is deleted on the way past rather than left to be re-examined
        // on every subsequent request.
        if session.is_expired_at(now) || session.is_idle_at(now, self.session_idle_ms) {
            sessions::delete(self.db, &token_hash).await?;
            return Ok(None);
        }

        // A deactivated account cannot hold a session, and the check lives here rather
        // than in the extractors so that deactivating someone takes effect on their *next
        // request*, not on their next login. A browser sitting on a valid cookie is the
        // case that matters: without this, "deactivated" would mean nothing to anyone
        // already signed in.
        //
        // The row is deleted on the way past, so the dead cookie stops costing a lookup
        // on every subsequent request rather than only being refused.
        let user = match users::find_by_id(self.db, session.user_id).await? {
            Some(user) if user.is_active => user,
            Some(_) | None => {
                sessions::delete(self.db, &token_hash).await?;
                return Ok(None);
            }
        };

        // Activity is recorded at most once per activity window. A failure here is not
        // allowed to fail the request: losing the "last active" stamp is a cosmetic
        // degradation, and refusing a homework fetch over it would be the wrong trade.
        if let Err(error) = sessions::touch(self.db, &token_hash, now).await {
            tracing::warn!(error = %error, "could not record session activity");
        }

        let mut principal = Principal::from(user);
        principal.session_id = session.id;
        Ok(Some(principal))
    }

    /// Whether this account has verified its EduSecure credential at some point.
    ///
    /// Exposed here because the login path needs it and every other caller goes
    /// through [`crate::services::account_security`]; two ways to ask the same
    /// question is how they drift.
    pub async fn has_stored_password(&self, user_id: i64) -> Result<bool, AuthError> {
        Ok(credentials::find_password_hash(self.db, user_id)
            .await?
            .is_some())
    }

    /// Revokes a session. `Ok(false)` means it was already gone, which is what makes
    /// logging out twice a no-op rather than a failure.
    pub async fn logout(&self, token: &str) -> Result<bool, AuthError> {
        if token.is_empty() {
            return Ok(false);
        }
        Ok(sessions::delete(self.db, &hash_token(token)).await?)
    }

    /// Revokes every session a user holds, on every device.
    pub async fn revoke_all_sessions(&self, user_id: i64) -> Result<u64, AuthError> {
        Ok(sessions::delete_for_user(self.db, user_id).await?)
    }

    /// Drops rows that have expired. Nothing calls this on a request path; a later
    /// phase may run it on a schedule.
    pub async fn purge_expired_sessions(&self) -> Result<u64, AuthError> {
        Ok(sessions::delete_expired(self.db, now_ms()).await?)
    }

    /// Sets a user's password, replacing any previous one.
    ///
    /// The plaintext goes into a hash and is not retained. Existing sessions are left
    /// alone: a signed-in browser on another device should not be dropped because a
    /// password was rotated. Callers that do want that ask for it explicitly.
    pub async fn set_password(&self, user_id: i64, password: &str) -> Result<(), AuthError> {
        if password.is_empty() {
            return Err(AuthError::BadRequest("Password is required."));
        }
        credentials::set_password_hash(self.db, user_id, &hash_password(password)?).await?;
        Ok(())
    }

    /// Creates a user with a password in one step, for provisioning.
    pub async fn create_user_with_password(
        &self,
        new_user: &crate::models::NewUser,
        password: &str,
    ) -> Result<Principal, AuthError> {
        let user = users::create(self.db, new_user).await?;
        self.set_password(user.id, password).await?;
        Ok(Principal::from(user))
    }

    /// Convenience for a route that already holds a validated session.
    pub fn ttl_seconds(&self) -> i64 {
        (self.session_ttl_ms / 1000).max(1)
    }
}

impl From<User> for Principal {
    fn from(user: User) -> Self {
        Self {
            user_id: user.id,
            school_id: user.school_id,
            display_name: user.display_name,
            role: user.role,
            class_id: user.class_id,
            // A user record is not a session. `validate_session` fills this in; every
            // other construction site has no browser to attribute.
            session_id: None,
        }
    }
}

/// Argon2id. Memory-hard, so a stolen hash cannot be cracked at the speed a plain
/// SHA-256 of a password would allow, and it is the algorithm OWASP currently
/// recommends for stored passwords.
fn argon2() -> Result<Argon2<'static>, AuthError> {
    // The library's own default parameters: 19 MiB, 2 passes, 1 lane. They are
    // deliberately not tuned per deployment -- a hardware-specific cost would make
    // the stored hash depend on where it was created.
    Ok(Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::default(),
    ))
}

/// Hashes a password, generating a fresh random salt internally. The result is a
/// self-describing PHC string carrying the algorithm, the salt and the parameters, so
/// a stored hash stays verifiable even if the cost parameters are raised later.
pub fn hash_password(password: &str) -> Result<String, AuthError> {
    argon2()?
        .hash_password(password.as_bytes())
        .map(|hash| hash.to_string())
        .map_err(|_| AuthError::BadRequest("Could not hash the supplied password."))
}

/// Verifies a password against a stored PHC hash.
///
/// A malformed stored hash is a failed verification, never a panic and never a
/// success: a corrupt row must not become a way in.
/// Verifies a password against a stored PHC hash.
///
/// `pub(crate)` because R12's account lifecycle has to verify the *current* password
/// before accepting a new one, and this is the only implementation of "does this
/// password match that hash" in the codebase. A second one per call site is exactly the
/// kind of drift this function existing at all is meant to prevent.
pub(crate) fn verify_password(password: &str, stored_hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(stored_hash) else {
        return false;
    };
    argon2().is_ok_and(|hasher| hasher.verify_password(password.as_bytes(), &parsed).is_ok())
}

/// A real argon2id hash of a value no account can present, used only to spend the
/// same work on a login for an unknown school ID. Regenerated on first use so the
/// parameters always match the current configuration.
fn dummy_hash() -> &'static str {
    use std::sync::OnceLock;
    static DUMMY: OnceLock<String> = OnceLock::new();
    DUMMY
        .get_or_init(|| hash_password(DUMMY_PASSWORD).unwrap_or_else(|_| DUMMY_PASSWORD.to_owned()))
}

/// The value behind [`dummy_hash`]. A fixed string, so a login for an unknown school
/// ID verifies against a hash that no one can match.
const DUMMY_PASSWORD: &str = "mmss64-no-such-account";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn school_ids_are_trimmed_and_the_school_domain_is_stripped() {
        assert_eq!(
            AuthService::normalize_school_id("  guranshbir126  "),
            "guranshbir126"
        );
        assert_eq!(
            AuthService::normalize_school_id("guranshbir126@manavmangalschool.com"),
            "guranshbir126"
        );
        assert_eq!(
            AuthService::normalize_school_id("  Student2@ManavMangalSchool.com  "),
            "Student2"
        );
        // Case is preserved: matching it is the repository's job, not the string's.
        assert_eq!(
            AuthService::normalize_school_id("Guranshbir126"),
            "Guranshbir126"
        );
        // Only the school's own domain is special.
        assert_eq!(AuthService::normalize_school_id("a@b.com"), "a@b.com");
        assert_eq!(
            AuthService::normalize_school_id("someone@manavmangal.com"),
            "someone@manavmangal.com"
        );
        // A bare domain is not an ID and must not normalise to an empty string.
        assert_eq!(
            AuthService::normalize_school_id("@manavmangalschool.com"),
            "@manavmangalschool.com"
        );
    }

    #[test]
    fn a_hash_verifies_only_the_password_that_made_it() {
        let hash = hash_password("correct horse").unwrap();
        assert!(verify_password("correct horse", &hash));
        assert!(!verify_password("wrong horse", &hash));
        assert!(!verify_password("", &hash));
        // A salt is per hash, so the same password never produces the same string.
        assert_ne!(hash, hash_password("correct horse").unwrap());
    }

    #[test]
    fn a_corrupt_stored_hash_is_a_failed_verification() {
        assert!(!verify_password("anything", "not-a-phc-string"));
        assert!(!verify_password("anything", ""));
    }

    #[test]
    fn the_dummy_hash_is_a_real_hash_of_an_unmatchable_value() {
        let hash = dummy_hash();
        assert!(verify_password(DUMMY_PASSWORD, hash));
        assert!(!verify_password("anything else", hash));
    }
}
