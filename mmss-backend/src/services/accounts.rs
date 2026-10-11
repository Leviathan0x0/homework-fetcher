//! Account lifecycle: activation, deactivation, and passwords a person owns.
//!
//! R11 could enrol accounts but could not take any of them away, could not give a new
//! student a password without the school inventing one first, and kept no record of who
//! did what. This module is the answer to all three, and it is deliberately narrow:
//!
//! * **Deactivate** flips `users.is_active` and revokes every session and every unused
//!   setup token the account holds. Nothing is deleted -- a student's notes and homework
//!   progress are theirs, and deactivating a leaver must not take them with it.
//! * **Change password** requires the current password. A session alone is not enough,
//!   because whoever holds a stolen session could otherwise change the password and lock
//!   the real owner out permanently.
//! * **First password** requires a setup token: a 256-bit CSPRNG value, stored only as a
//!   digest, single-use and expiring. That token *is* the identity verification, and it
//!   can only be issued by an operator acting on a deployment.
//!
//! # What is deliberately absent
//!
//! **There is no forgotten-password reset.** It would have to be reachable without a
//! session, and the only factor available to verify someone is a school-controlled one
//! this system does not have -- see `ACCOUNT_LIFECYCLE.md` for the prerequisite. Building
//! the endpoint now and filling in the verification later is how unauthenticated
//! account-takeover endpoints ship.
//!
//! **There is no HTTP surface for deactivation.** An operator who holds a session could
//! deactivate any account, and "the admin deactivates students" deserves an auditable,
//! reviewable file rather than an authenticated `DELETE`. It is a CLI operation for the
//! same reason R11's provisioning is: a file an operator can read before running is safer
//! than a request that is already in flight.

use sqlx::SqlitePool;

use crate::clock::now_ms;
use crate::config::Config;
use crate::cookies::hash_token;
use crate::error::ApiError;
use crate::repositories::account_events::{self, EventKind, CLI_ACTOR};
use crate::repositories::{credentials, setup_tokens, users};
use crate::services::auth::{hash_password, verify_password, AuthService, IssuedSession};

/// How long a setup token stays valid.
///
/// A constant rather than configuration. It is a security parameter with one correct
/// shape -- long enough for a slip to reach a parent, short enough that a lost one is
/// not a standing risk -- and an operator who wants it different can revoke the token
/// (`accounts --revoke-tokens`) far more effectively than by making it a week long.
pub const SETUP_TOKEN_TTL_MS: i64 = 24 * 60 * 60 * 1000;

/// Most live setup tokens one account may hold at once.
///
/// Issuing a second token when the first is unused almost always means the first was
/// lost, and quietly adding to the pile makes "which slip is valid" unanswerable.
pub const MAX_LIVE_SETUP_TOKENS: i64 = 1;

/// Longest password accepted. A student typing a paragraph into a setup field has made a
/// mistake, and there is no reason to spend argon2 time proving it.
pub const MAX_PASSWORD_LEN: usize = 1024;

/// Shortest password accepted.
///
/// Deliberately short. This is a school roll number and a first-time setup, not a
/// banking password, and a length rule enforced at signup is the one control that
/// reliably survives being taught. Rejected with a message that says what is required,
/// because this is the one password error a user can act on.
pub const MIN_PASSWORD_LEN: usize = 8;

/// Why an operation was refused, in the shapes a caller has to treat differently.
///
/// The variants are distinguished for the *operator's* benefit -- the CLI reports them
/// per row -- and never for a client's, because an HTTP handler maps all of them onto one
/// message. A student must not be able to learn that a token exists, that it was already
/// used, or that an account exists at all, by comparing error text.
#[derive(Debug, thiserror::Error)]
pub enum LifecycleError {
    #[error("{0}")]
    BadRequest(&'static str),
    /// Any failure of a token: unknown, used, expired, or revoked. One answer, so a
    /// token's state is not observable by trying it.
    #[error("that setup link is not valid")]
    InvalidSetupToken,
    /// The account has a password already. Issuing a setup token for it would be a way
    /// to take over a working account.
    #[error("that account already has a password")]
    AlreadyHasPassword,
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

impl From<crate::services::auth::AuthError> for LifecycleError {
    /// `AuthError` collapses into a database failure here, because every non-database
    /// variant is about credentials -- and this service's callers have already done their
    /// own credential verification. A `BadRequest` reaching here would be a programming
    /// error rather than a user error, so it is not silently reinterpreted as one.
    fn from(error: crate::services::auth::AuthError) -> Self {
        match error {
            crate::services::auth::AuthError::Database(error) => Self::Database(error),
            crate::services::auth::AuthError::BadRequest(_) => Self::BadRequest(
                "The password could not be stored. Try again, or ask your school to reset it.",
            ),
            crate::services::auth::AuthError::InvalidCredentials => {
                Self::BadRequest("The password could not be stored. Try again.")
            }
        }
    }
}

impl From<LifecycleError> for ApiError {
    fn from(error: LifecycleError) -> Self {
        match error {
            // A malformed request: a password that is too short, a blank token. These
            // messages reach the user and have to be actionable.
            LifecycleError::BadRequest(message) => Self::bad_request(message),
            LifecycleError::InvalidSetupToken => {
                Self::bad_request("That setup link is not valid or has expired.")
            }
            LifecycleError::AlreadyHasPassword => {
                Self::bad_request("That setup link is not valid or has expired.")
            }
            LifecycleError::Database(error) => Self::internal(error),
        }
    }
}

pub struct AccountsService<'a> {
    db: &'a SqlitePool,
    config: &'a Config,
}

impl<'a> AccountsService<'a> {
    pub fn new(db: &'a SqlitePool, config: &'a Config) -> Self {
        Self { db, config }
    }

    /// How long a freshly issued session is good for, in seconds. The cookie builder needs
    /// the same number as the session row, and deriving it in two places is how they
    /// drift apart.
    pub fn ttl_seconds(&self) -> i64 {
        (self.config.session_ttl_ms / 1000).max(1)
    }

    // ------------------------------------------------------------- passwords

    /// Changes the caller's own password.
    ///
    /// `current_password` is required and is verified before anything is written, so a
    /// stolen session alone cannot be escalated into a permanent takeover.
    ///
    /// Every session the account holds is then revoked and a fresh one issued for the
    /// caller's browser. Dropping all sessions *including* the current one and re-issuing
    /// is the point: it is what evicts an attacker who already had a session, and the
    /// caller stays signed in because the replacement cookie arrives in the same
    /// response.
    pub async fn change_password(
        &self,
        user_id: i64,
        school_id: &str,
        current_password: &str,
        new_password: &str,
    ) -> Result<IssuedSession, LifecycleError> {
        let password = check_password(new_password)?;

        let stored = credentials::find_password_hash(self.db, user_id)
            .await?
            .ok_or(LifecycleError::InvalidSetupToken)?;
        // The shared verifier. `AuthService` keeps it private because it is the one thing
        // in R3 that must never be reimplemented per call site.
        if !verify_password(current_password, &stored) {
            // Deliberately the same error as a bad setup token rather than "wrong
            // password": this endpoint is authenticated, so the caller already knows who
            // they are, and a distinct message would only help someone guessing.
            return Err(LifecycleError::InvalidSetupToken);
        }
        if verify_password(password, &stored) {
            // Refused rather than accepted, because a "change" to the same password
            // re-issues every session while leaving the credential identical -- all of the
            // disruption with none of the benefit.
            return Err(LifecycleError::BadRequest(
                "Choose a password different from your current one.",
            ));
        }

        credentials::set_password_hash(self.db, user_id, &hash_password(password)?).await?;
        AuthService::new(self.db, self.config)
            .revoke_all_sessions(user_id)
            .await?;
        account_events::record(
            self.db,
            user_id,
            EventKind::PasswordChanged,
            school_id,
            None,
        )
        .await?;
        Ok(AuthService::new(self.db, self.config)
            .create_session(user_id)
            .await?)
    }

    /// Sets an account's first password using a setup token, and signs the account in.
    ///
    /// The token is consumed and the password written in that order, and a failure
    /// after consumption leaves the token spent -- a spent token is a safe failure, a
    /// live one is not.
    pub async fn complete_setup(
        &self,
        token: &str,
        new_password: &str,
    ) -> Result<(IssuedSession, crate::models::User), LifecycleError> {
        let password = check_password(new_password)?;
        if token.is_empty() {
            return Err(LifecycleError::InvalidSetupToken);
        }
        let token_hash = hash_token(token);

        // One statement: find-and-consume. `used_at IS NULL AND expires_at > now` means a
        // token that is unknown, spent, or expired all match nothing, and two concurrent
        // submissions cannot both win.
        let consumed = setup_tokens::consume(self.db, &token_hash, now_ms())
            .await?
            .ok_or(LifecycleError::InvalidSetupToken)?;

        // Re-checked after the token is spent, so a token issued before a deactivation
        // cannot complete a setup afterwards. Deactivation revokes tokens, but a token
        // issued in the same second as the deactivation could otherwise slip through.
        let user = users::find_by_id(self.db, consumed.user_id)
            .await?
            .filter(|user| user.is_active)
            .ok_or(LifecycleError::InvalidSetupToken)?;

        if credentials::find_password_hash(self.db, user.id)
            .await?
            .is_some()
        {
            return Err(LifecycleError::AlreadyHasPassword);
        }

        credentials::set_password_hash(self.db, user.id, &hash_password(password)?).await?;
        account_events::record(
            self.db,
            user.id,
            EventKind::PasswordSet,
            &user.school_id,
            None,
        )
        .await?;
        let session = AuthService::new(self.db, self.config)
            .create_session(user.id)
            .await?;
        Ok((session, user))
    }

    // --------------------------------------------------------- setup tokens

    /// Issues a setup token for an account that has no password.
    ///
    /// The no-password requirement is a safety property, not a limitation. A token for an
    /// account that already has a credential is a second way in, and an operator with
    /// file access to the database would be able to mint one for any account, including
    /// the administrator's. There is no override.
    pub async fn issue_setup_token(
        &self,
        user_id: i64,
    ) -> Result<crate::repositories::setup_tokens::IssuedSetupToken, LifecycleError> {
        users::find_by_id(self.db, user_id)
            .await?
            .filter(|user| user.is_active())
            .ok_or(LifecycleError::BadRequest(
                "That account does not exist or is deactivated.",
            ))?;

        if credentials::find_password_hash(self.db, user_id)
            .await?
            .is_some()
        {
            return Err(LifecycleError::AlreadyHasPassword);
        }

        let now = now_ms();
        let live = setup_tokens::count_live_for_user(self.db, user_id, now).await?;
        if live >= MAX_LIVE_SETUP_TOKENS {
            // Revoke the outstanding one rather than refusing. The operator asking for a
            // token has almost certainly lost the first, and making them find a database
            // to revoke it in is how a stale token outlives the slip it was printed on.
            setup_tokens::revoke_for_user(self.db, user_id).await?;
        }

        Ok(setup_tokens::issue(self.db, user_id, SETUP_TOKEN_TTL_MS).await?)
    }

    // ------------------------------------------------------ active / inactive

    /// Flips an account's active state and records who did it.
    ///
    /// Revoking sessions and live tokens is part of the operation, not a follow-up. A
    /// deactivated account that kept its session would still be fully usable, and one
    /// that kept its setup token could set a password and sign in again.
    pub async fn set_active(
        &self,
        user_id: i64,
        is_active: bool,
        actor: &str,
        reason: Option<&str>,
    ) -> Result<ActivationOutcome, LifecycleError> {
        let kind = if is_active {
            EventKind::Reactivated
        } else {
            EventKind::Deactivated
        };

        // `None` means the account is already in the requested state. Reported rather
        // than treated as success-by-silence, so a deactivation roster that has drifted
        // from the database says so.
        let Some(changed) = users::set_active(self.db, user_id, is_active).await? else {
            let existing = users::find_by_id(self.db, user_id)
                .await?
                .ok_or(LifecycleError::BadRequest("That account does not exist."))?;
            return Ok(ActivationOutcome::Unchanged { user: existing });
        };

        let mut sessions_revoked = 0;
        let mut tokens_revoked = 0;
        if !is_active {
            sessions_revoked = AuthService::new(self.db, self.config)
                .revoke_all_sessions(user_id)
                .await?;
            tokens_revoked = setup_tokens::revoke_for_user(self.db, user_id).await?;
        }

        account_events::record(
            self.db,
            user_id,
            kind,
            actor,
            // Sanitised here rather than by the caller. The CLI does it too, but the CLI
            // is not the only caller and this text is stored forever: a reason containing
            // a newline could forge a log line, and one caller forgetting to strip it is
            // all it takes.
            clean_reason(reason).as_deref(),
        )
        .await?;

        Ok(ActivationOutcome::Changed {
            user: changed,
            sessions_revoked,
            tokens_revoked,
        })
    }

    /// The operator-facing entry point, which finds the account by school ID.
    pub async fn set_active_by_school_id(
        &self,
        school_id: &str,
        is_active: bool,
        reason: Option<&str>,
    ) -> Result<ActivationOutcome, LifecycleError> {
        let user = users::find_by_school_id(self.db, school_id)
            .await?
            .ok_or(LifecycleError::BadRequest("That account does not exist."))?;
        self.set_active(user.id, is_active, CLI_ACTOR, reason).await
    }
}

/// What a state change did, as the CLI reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActivationOutcome {
    Changed {
        user: crate::models::User,
        sessions_revoked: u64,
        tokens_revoked: u64,
    },
    Unchanged {
        user: crate::models::User,
    },
}

/// Validates a new password and returns it.
///
/// Both ends checked here rather than at each call site, because "reject a
/// one-character password" is exactly the rule that gets forgotten at the third call
/// site.
fn check_password(raw: &str) -> Result<&str, LifecycleError> {
    let trimmed = raw.trim();
    // Checked before the length rule, so a field of spaces is told it is empty rather
    // than being told it is too short. Both are refusals; only one of them tells the user
    // anything they can act on.
    if trimmed.is_empty() {
        return Err(LifecycleError::BadRequest("Your password is required."));
    }
    if trimmed.chars().count() < MIN_PASSWORD_LEN {
        return Err(LifecycleError::BadRequest(
            "Your password must be at least 8 characters.",
        ));
    }
    if trimmed.chars().count() > MAX_PASSWORD_LEN {
        return Err(LifecycleError::BadRequest("That password is too long."));
    }
    Ok(trimmed)
}

/// The audit detail an operator may attach to a deactivation.
///
/// Applied by [`AccountsService::set_active`] itself, not by its callers. The text is
/// free text typed by a human and it is stored forever, so it is bounded and stripped of
/// control characters here: a reason containing a newline could forge a log line, and one
/// caller forgetting to strip it is all it takes.
///
/// It cannot be prevented from containing a secret -- only a person who types one can do
/// that -- so the rule for an operator is simply: keep it short, and never put a password
/// in it.
pub fn clean_reason(raw: Option<&str>) -> Option<String> {
    let text = raw?.trim();
    if text.is_empty() {
        return None;
    }
    let cleaned: String = text.chars().filter(|c| !c.is_control()).take(200).collect();
    (!cleaned.is_empty()).then_some(cleaned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_length_is_bounded_at_both_ends() {
        assert!(
            check_password("1234567").is_err(),
            "seven characters is too short"
        );
        assert!(check_password("12345678").is_ok());
        assert!(
            check_password("        ").is_err(),
            "whitespace is not a password"
        );
        assert!(
            check_password("   a-real-one   ").is_ok(),
            "the ends are trimmed"
        );
        assert!(check_password(&"x".repeat(MAX_PASSWORD_LEN + 1)).is_err());
        assert_eq!(
            check_password("  padded-password  ").unwrap(),
            "padded-password"
        );
    }

    #[test]
    fn a_whitespace_only_password_is_told_it_is_empty_not_that_it_is_short() {
        // Both are refusals, but only one tells the user what to do about it.
        let empty = check_password("          ").unwrap_err().to_string();
        assert!(empty.contains("required"), "{empty}");
        assert!(!empty.contains("8 characters"), "{empty}");

        // A genuinely short one does get the requirement.
        let short = check_password("abc").unwrap_err().to_string();
        assert!(short.contains("8 characters"), "{short}");
    }

    #[test]
    fn a_reactivation_is_recorded_under_a_different_kind() {
        assert_ne!(
            EventKind::Deactivated.as_str(),
            EventKind::Reactivated.as_str()
        );
    }

    #[test]
    fn reasons_are_trimmed_bounded_and_control_free() {
        assert_eq!(clean_reason(None), None);
        assert_eq!(clean_reason(Some("   ")), None);
        assert_eq!(
            clean_reason(Some("  left the school  ")).as_deref(),
            Some("left the school")
        );
        // A newline is what would make a log line forgeable.
        assert_eq!(
            clean_reason(Some("left\nFAKE LOG LINE")).as_deref(),
            Some("leftFAKE LOG LINE")
        );
        assert_eq!(clean_reason(Some(&"x".repeat(500))).unwrap().len(), 200);
    }

    #[test]
    fn token_failures_are_one_answer_to_a_caller() {
        // Every token problem collapses to the same HTTP body, so probing the setup
        // endpoint cannot distinguish "no such token" from "already used" from
        // "that account already has a password".
        use axum::response::IntoResponse;
        let body = |error: LifecycleError| {
            let response = ApiError::from(error).into_response();
            let status = response.status();
            let bytes = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(async { axum::body::to_bytes(response.into_body(), 4096).await });
            (status, String::from_utf8(bytes.unwrap().to_vec()).unwrap())
        };
        for error in [
            LifecycleError::InvalidSetupToken,
            LifecycleError::AlreadyHasPassword,
        ] {
            let (status, text) = body(error);
            assert_eq!(status, axum::http::StatusCode::BAD_REQUEST);
            assert_eq!(
                text,
                r#"{"error":"That setup link is not valid or has expired.","code":"BAD_REQUEST"}"#,
                "every token failure must be byte-identical to a caller"
            );
        }
    }
}
