//! Account security: which devices are signed in, and the two passwords.
//!
//! # The two credentials, and why both exist
//!
//! | | MMSS64 password | EduSecure credential |
//! | --- | --- | --- |
//! | proves | who you are *to this app* | who you are *to the school portal* |
//! | stored as | argon2id hash | AES-256-GCM ciphertext |
//! | recoverable | never | yes, by the backend only |
//! | ever sent to the portal | **never** | yes, and only there |
//!
//! They are separate rows, separate endpoints and separate code paths. The rule that
//! keeps them from bleeding into each other is that this module never verifies one
//! against the other and never falls back from one to the other: an account has
//! exactly one password *for MMSS64*, and whether that account is in the "separate
//! password" state is a question about a row existing, not about which verifier ran.
//!
//! # What cannot be done here
//!
//! **Verifying an EduSecure password requires the portal.** The portal holds the
//! password hash and exposes no offline check, so verification means completing its
//! normal login flow -- see
//! [`crate::services::edusecure::EduSecureClient::verify_credentials`]. No Rust client
//! implements that handshake yet (the Node one at
//! `server/edusecure/edusecureAuth.js` is the reference), so on a deployment without
//! one, every operation that *requires* portal verification fails with a clear 503
//! rather than a guess. That includes legacy sign-in. It is stated here, on the
//! endpoint, and in `DEPLOYMENT.md` rather than papered over with a fallback that would
//! look like it worked.
//!
//! **There is no password recovery.** Not deferred, absent: a reset reachable without a
//! session needs an identity factor this deployment does not have, and the existing
//! `ForgotPasswordDialog` points students at the school office for exactly this reason.

use std::sync::Arc;

use sqlx::SqlitePool;

use crate::clock::now_ms;
use crate::config::Config;
use crate::crypto::{self, CredentialKey};
use crate::devices::DeviceInfo;
use crate::error::ApiError;
use crate::repositories::{
    account_events::{self, EventKind},
    credentials as credentials_repo, edusecure_credentials, sessions,
};
use crate::services::accounts::{
    AccountsService, LifecycleError, MAX_PASSWORD_LEN, MIN_PASSWORD_LEN,
};
use crate::services::auth::{hash_password, AuthError, AuthService, IssuedSession};
use crate::services::edusecure::{can_verify_credentials, EduSecureClient, PortalError};

/// One row of the device list, as the frontend sees it.
///
/// Built here rather than serialised from [`crate::models::Session`] because a session
/// row carries `token_hash`, and a type with no field for it is worth more than
/// remembering to leave one out.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    /// The public session id. Safe to show, and revocable *for this account only*.
    pub id: String,
    /// Best effort, and labelled as such in the UI. Never an identity.
    pub device_label: String,
    pub created_at: i64,
    pub last_used_at: i64,
    pub expires_at: i64,
    /// Whether this is the request's own session.
    pub current: bool,
}

/// One page of the device list, as the frontend sees it.
///
/// Wraps the rows with the numbers a paginated UI needs. Without them a client cannot
/// tell "you have two devices" from "you have ninety-one and I am showing you two",
/// and a bounded list that quietly hides the rest is worse than an unbounded one --
/// the user cannot revoke what they cannot see.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionListView {
    sessions: Vec<SessionView>,
    /// Live sessions this account holds in total, across every page.
    total: i64,
    /// How many this page holds.
    limit: i64,
    /// Zero-based index of the first row on this page.
    offset: i64,
    /// Whether more rows exist after this page. Cheaper than `offset + sessions.len() < total`
    /// for the client and impossible to get wrong.
    has_more: bool,
}

impl SessionListView {
    pub fn sessions(&self) -> &[SessionView] {
        &self.sessions
    }
}

/// A validated page request. `limit` is always within `[1, MAX_PAGE_SIZE]` and
/// `offset` is never negative, so nothing downstream has to re-check them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionPageRequest {
    pub limit: i64,
    pub offset: i64,
}

impl SessionPageRequest {
    /// Parses caller input, falling back to the default rather than failing.
    ///
    /// A missing, zero, negative or absurd page size is a client that did not read the
    /// contract, not an attack: clamping serves them something useful. An offset beyond
    /// the end simply yields an empty page with an accurate `total`, which is how a
    /// caller discovers the list got shorter.
    pub fn parse(limit: Option<i64>, offset: Option<i64>) -> Self {
        let limit = limit
            .unwrap_or(sessions::DEFAULT_PAGE_SIZE)
            .clamp(1, sessions::MAX_PAGE_SIZE);
        Self {
            limit,
            offset: offset.unwrap_or(0).max(0),
        }
    }
}
///
/// Booleans about an account's own configuration and one about the deployment. Nothing
/// here says anything about any credential.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityStatus {
    /// The account has an MMSS64 password of its own. `false` means it still signs in
    /// with its EduSecure credentials.
    pub has_mmss_password: bool,
    /// Whether an EduSecure credential is stored. Never the credential itself.
    pub edusecure_credential_configured: bool,
    /// Whether this deployment can verify a portal credential at all. `false` hides
    /// the setup and update flows rather than letting them fail after submission.
    pub edusecure_verification_available: bool,
}

/// Why an account-security operation was refused.
#[derive(Debug, thiserror::Error)]
pub enum SecurityError {
    /// Something about the form the caller can fix. The only variant whose message is
    /// written for a person to read.
    #[error("{0}")]
    BadRequest(String),
    /// The submitted password did not verify. One message for every way of failing to
    /// verify, because a caller must not be able to tell "wrong password" from "no
    /// password here" by comparing error text.
    #[error("That password is not correct.")]
    ReauthenticationFailed,
    /// The EduSecure portal could not verify the credential.
    #[error("{0}")]
    EduSecure(#[from] PortalError),
    /// The account already has an MMSS64 password, so "set one up" is not the request.
    #[error("This account already has an MMSS64 password.")]
    AlreadyMigrated,
    /// No `CREDENTIAL_ENCRYPTION_KEY`, so there is nowhere safe to put a credential.
    ///
    /// Failing closed is the entire point: the alternative is a plaintext column, which
    /// is worse than a feature that is plainly unavailable.
    #[error("Secure credential storage is not configured on this server.")]
    CredentialStorageUnavailable,
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

impl From<SecurityError> for ApiError {
    fn from(error: SecurityError) -> Self {
        match error {
            SecurityError::BadRequest(message) => Self::bad_request(message),
            // Deliberately one answer for a wrong password on every endpoint, so
            // reauthentication cannot be used to probe an account's state.
            SecurityError::ReauthenticationFailed => {
                Self::unauthorized("INVALID_CREDENTIALS", error.to_string())
            }
            // "Already migrated" is not a credential hint: the caller is already
            // authenticated as this account, so they know.
            SecurityError::AlreadyMigrated => Self::bad_request(error.to_string()),
            SecurityError::CredentialStorageUnavailable => Self::Client {
                status: axum::http::StatusCode::SERVICE_UNAVAILABLE,
                code: "CREDENTIAL_STORAGE_UNAVAILABLE",
                message: error.to_string(),
            },
            // A portal that cannot be reached is a server-side problem, not a wrong
            // password. Answering 401 here would teach students to retype a good
            // password until the portal came back.
            SecurityError::EduSecure(PortalError::Unauthenticated) => Self::unauthorized(
                "INVALID_CREDENTIALS",
                "That EduSecure password is not correct.",
            ),
            SecurityError::EduSecure(_) => Self::Client {
                status: axum::http::StatusCode::SERVICE_UNAVAILABLE,
                code: "EDUSECURE_UNAVAILABLE",
                message: error.to_string(),
            },
            SecurityError::Database(error) => Self::internal(error),
        }
    }
}

impl From<AuthError> for SecurityError {
    fn from(error: AuthError) -> Self {
        match error {
            AuthError::BadRequest(message) => Self::BadRequest(message.to_owned()),
            // Both collapse to "that did not work": a caller re-authenticating must
            // not learn whether the value they sent was the wrong shape or the wrong
            // one.
            AuthError::InvalidCredentials => Self::ReauthenticationFailed,
            AuthError::Database(error) => Self::Database(error),
        }
    }
}

impl From<LifecycleError> for SecurityError {
    fn from(error: LifecycleError) -> Self {
        match error {
            LifecycleError::BadRequest(message) => Self::BadRequest(message.to_owned()),
            // `AccountsService` deliberately collapses every credential failure into one
            // message. That is the right one here too, and it keeps the 400 status the
            // existing `PATCH /auth/password` contract is built on -- a caller changing
            // their own password is already authenticated, so "you are not signed in"
            // would be a different and misleading claim.
            //
            // Reauthentication for *session* management keeps its own 401: there the
            // caller is not presenting a credential to be changed, they are presenting
            // one to prove who they are, and that is an authentication failure.
            LifecycleError::InvalidSetupToken | LifecycleError::AlreadyHasPassword => {
                Self::BadRequest("That password is not correct.".into())
            }
            LifecycleError::Database(error) => Self::Database(error),
        }
    }
}

pub struct AccountSecurityService<'a> {
    db: &'a SqlitePool,
    config: &'a Config,
    portal: Arc<dyn EduSecureClient>,
}

impl<'a> AccountSecurityService<'a> {
    pub fn new(db: &'a SqlitePool, config: &'a Config, portal: Arc<dyn EduSecureClient>) -> Self {
        Self { db, config, portal }
    }

    fn key(&self) -> Result<&CredentialKey, SecurityError> {
        self.config
            .credential_key
            .as_ref()
            .ok_or(SecurityError::CredentialStorageUnavailable)
    }

    // ---------------------------------------------------------------- status

    pub async fn status(&self, user_id: i64) -> Result<SecurityStatus, SecurityError> {
        Ok(SecurityStatus {
            has_mmss_password: credentials_repo::find_password_hash(self.db, user_id)
                .await?
                .is_some(),
            edusecure_credential_configured: edusecure_credentials::is_configured(self.db, user_id)
                .await?,
            edusecure_verification_available: can_verify_credentials(&self.config.edusecure),
        })
    }

    // -------------------------------------------------------------- sessions

    /// Every live session the caller holds, newest activity first.
    ///
    /// `current_session_id` comes from the resolved principal, never from the request,
    /// so the "this is you" marker cannot be pointed at somebody else's row.
    pub async fn list_sessions(
        &self,
        user_id: i64,
        current_session_id: Option<&str>,
        page: SessionPageRequest,
    ) -> Result<SessionListView, SecurityError> {
        let result = sessions::list_for_user(
            self.db,
            user_id,
            now_ms(),
            self.config.session_idle_ms,
            page.limit,
            page.offset,
        )
        .await?;
        let returned = result.sessions.len() as i64;

        let sessions = result
            .sessions
            .into_iter()
            // A row with no public id cannot be named by a client, so there is nothing
            // useful to show for it. Only pre-migration rows are ever in this state.
            .filter_map(|row| {
                Some(SessionView {
                    current: current_session_id
                        .is_some_and(|current| Some(current) == row.id.as_deref()),
                    id: row.id.clone()?,
                    device_label: row
                        .device_label
                        .clone()
                        .unwrap_or_else(|| DeviceInfo::UNKNOWN.to_owned()),
                    created_at: row.created_at,
                    last_used_at: row.last_used(),
                    expires_at: row.expires_at,
                })
            })
            .collect();

        // `current` is only ever true for the caller's own row, and that row may not be
        // on this page. Rather than inventing a flag, the total and `hasMore` let the
        // client say "this device is on a later page" honestly instead of implying the
        // page it is looking at is the whole list.
        Ok(SessionListView {
            has_more: page.offset + returned < result.total,
            total: result.total,
            limit: page.limit,
            offset: page.offset,
            sessions,
        })
    }

    /// Revokes one of the caller's sessions.
    ///
    /// `false` means the row was not there -- not the caller's, or already gone. The
    /// repository predicates on `user_id` as well as the id, so a caller who edits the
    /// id in the body changes which row is looked for and matches nothing; there is no
    /// ownership check here that could be forgotten.
    pub async fn revoke_session(
        &self,
        user_id: i64,
        session_id: &str,
    ) -> Result<bool, SecurityError> {
        Ok(sessions::delete_for_user_by_id(self.db, user_id, session_id).await?)
    }

    /// Revokes every session except the one making the request.
    pub async fn revoke_other_sessions(
        &self,
        user_id: i64,
        current_session_id: &str,
    ) -> Result<u64, SecurityError> {
        Ok(sessions::delete_others_for_user(self.db, user_id, current_session_id).await?)
    }

    /// Revokes every session the account holds, including this one.
    pub async fn revoke_all_sessions(&self, user_id: i64) -> Result<u64, SecurityError> {
        Ok(sessions::delete_for_user(self.db, user_id).await?)
    }

    // ----------------------------------------------------------- credentials

    /// Re-checks a password for a caller who is already signed in.
    ///
    /// One verifier per account, chosen by which credential the account actually has:
    /// an MMSS64 password if it has one, otherwise the EduSecure portal. The two are
    /// never tried in sequence, so a student who set a separate password cannot
    /// "reauthenticate" with their portal password by aiming at the wrong field, and a
    /// student still on the legacy path is never asked for a password this deployment
    /// does not hold.
    pub async fn reauthenticate(
        &self,
        user_id: i64,
        school_id: &str,
        password: &str,
    ) -> Result<(), SecurityError> {
        match credentials_repo::find_password_hash(self.db, user_id).await? {
            Some(hash) => {
                if !crate::services::auth::verify_password(password, &hash) {
                    return Err(SecurityError::ReauthenticationFailed);
                }
                Ok(())
            }
            // Legacy account: the only credential it has is the one the portal holds.
            None => match self.verify_with_portal(school_id, password).await? {
                true => Ok(()),
                false => Err(SecurityError::ReauthenticationFailed),
            },
        }
    }

    /// Confirms a portal password through the portal's own login flow.
    ///
    /// Every failure other than an outright rejection becomes an error rather than a
    /// `false`, because "the portal was unreachable" and "that is the wrong password"
    /// must never look the same to the person holding the correct one.
    pub async fn verify_with_portal(
        &self,
        school_id: &str,
        password: &str,
    ) -> Result<bool, SecurityError> {
        match self.portal.verify_credentials(school_id, password).await {
            Ok(verified) => Ok(verified),
            Err(PortalError::Unauthenticated) => Ok(false),
            Err(error) => Err(error.into()),
        }
    }

    /// Replaces the stored EduSecure credential with a **verified** one.
    ///
    /// Verification happens before the transaction opens, so a wrong password cannot
    /// roll anything back, because nothing was ever started. Inside the transaction
    /// there is exactly one write: a valid saved credential is never overwritten by an
    /// unverified one, and a failure after this point rolls the whole thing back
    /// rather than leaving a half-written account.
    pub async fn store_verified_credential(
        &self,
        user_id: i64,
        school_id: &str,
        password: &str,
    ) -> Result<(), SecurityError> {
        let key = self.key()?;
        if !self.verify_with_portal(school_id, password).await? {
            return Err(SecurityError::EduSecure(PortalError::Unauthenticated));
        }
        let sealed = crypto::seal(key, password).map_err(unavailable)?;
        let mut tx = self.db.begin().await?;
        edusecure_credentials::set_ciphertext(&mut *tx, user_id, &sealed).await?;
        tx.commit().await?;
        Ok(())
    }

    /// The saved EduSecure password, for the one job that needs it: fetching homework.
    ///
    /// The single decrypt path in the codebase. Callers get a `String` they are
    /// expected to drop as soon as the outbound request is made; there is no "decrypt
    /// and log", no "decrypt and return to a client", and no cache.
    pub async fn edusecure_password(&self, user_id: i64) -> Result<Option<String>, SecurityError> {
        let Some(key) = self.config.credential_key.as_ref() else {
            return Err(SecurityError::CredentialStorageUnavailable);
        };
        let Some(sealed) = edusecure_credentials::find_ciphertext(self.db, user_id).await? else {
            return Ok(None);
        };
        crypto::open(key, &sealed).map(Some).map_err(unavailable)
    }

    /// Whether an EduSecure credential is stored, without reading or decrypting it.
    pub async fn has_stored_credential(&self, user_id: i64) -> Result<bool, SecurityError> {
        Ok(edusecure_credentials::is_configured(self.db, user_id).await?)
    }

    // ------------------------------------------------------- password setup

    /// Gives a legacy account its own MMSS64 password, and keeps the portal credential.
    ///
    /// The order is the design: **verify, then encrypt, then write, then hash.** A
    /// wrong portal password never reaches the database. An encryption failure never
    /// reaches the database. And if the password write fails after the credential was
    /// committed, the account is left exactly where it started -- still on the legacy
    /// path, still able to sign in with the portal, with a verified credential already
    /// saved. The alternative order would write the hash first and could leave an
    /// account whose only reachable password has no stored portal credential behind it,
    /// which is a locked account, not a partially migrated one.
    ///
    /// Every session is then revoked and a replacement issued for this browser, the
    /// same as a password change: the moment somebody sets a separate password is the
    /// moment a stranger holding a session is worth evicting.
    ///
    /// The EduSecure password is verified through the portal's normal login flow. It is
    /// never used as, or checked against, the MMSS64 password.
    pub async fn set_up_password(
        &self,
        user_id: i64,
        school_id: &str,
        edusecure_password: &str,
        new_password: &str,
        confirm_password: &str,
        device: &DeviceInfo,
    ) -> Result<IssuedSession, SecurityError> {
        if credentials_repo::find_password_hash(self.db, user_id)
            .await?
            .is_some()
        {
            return Err(SecurityError::AlreadyMigrated);
        }
        let password = check_new_password(new_password, confirm_password)?;
        self.store_verified_credential(user_id, school_id, edusecure_password)
            .await?;

        let hash = hash_password(password)?;
        credentials_repo::set_password_hash(self.db, user_id, &hash).await?;
        account_events::record(self.db, user_id, EventKind::PasswordSet, school_id, None).await?;
        AuthService::new(self.db, self.config)
            .revoke_all_sessions(user_id)
            .await?;
        Ok(AuthService::new(self.db, self.config)
            .create_session(user_id, device)
            .await?)
    }

    /// Changes the caller's own MMSS64 password.
    ///
    /// Thin on purpose. The ordering, the session revocation and the re-issue all live
    /// in [`AccountsService::change_password`], which is the one implementation of
    /// "change a password and rotate the sessions" and already runs on
    /// `PATCH /auth/password`. Duplicating it here would be a second implementation,
    /// and two implementations of a security operation is how one of them ends up not
    /// revoking.
    ///
    /// What this adds is the confirmation field, and the refusal of a legacy account:
    /// an account with no MMSS64 password has nothing to change, and accepting the
    /// request anyway would be a second, quieter setup path.
    pub async fn change_password(
        &self,
        user_id: i64,
        school_id: &str,
        current_password: &str,
        new_password: &str,
        confirm_password: &str,
        device: &DeviceInfo,
    ) -> Result<IssuedSession, SecurityError> {
        check_new_password(new_password, confirm_password)?;
        if credentials_repo::find_password_hash(self.db, user_id)
            .await?
            .is_none()
        {
            // Same answer as a wrong current password, so this cannot be used to learn
            // whether an account has been migrated.
            return Err(SecurityError::ReauthenticationFailed);
        }
        Ok(AccountsService::new(self.db, self.config)
            .change_password(user_id, school_id, current_password, new_password, device)
            .await?)
    }
}

/// A `CryptoError` on a credential write is a missing or unusable key as far as the
/// caller is concerned, which is the honest, actionable answer. The underlying cause
/// is logged at debug level by [`ApiError`]; it is never an internal database detail
/// and never mentions the value.
fn unavailable(error: crypto::CryptoError) -> SecurityError {
    tracing::debug!(%error, "credential encryption unavailable");
    SecurityError::CredentialStorageUnavailable
}

/// Validates a new password and checks the confirmation field.
///
/// The bounds are the account lifecycle's, imported rather than restated, because
/// "a password must be at least eight characters" existing in two places is how the
/// two stop agreeing about what a password is.
fn check_new_password<'a>(new_password: &'a str, confirm: &str) -> Result<&'a str, SecurityError> {
    let password = new_password.trim();
    // Checked before the length rule, so a field of spaces is told it is empty rather
    // than being told it is too short. Both are refusals; only one is actionable.
    if password.is_empty() {
        return Err(SecurityError::BadRequest(
            "Your password is required.".into(),
        ));
    }
    if confirm.trim() != password {
        // A phone keyboard adds a space on the first and last taps; both fields get it,
        // and the user is not told their password "does not match" because of that.
        return Err(SecurityError::BadRequest(
            "The two passwords do not match.".into(),
        ));
    }
    let length = password.chars().count();
    if length < MIN_PASSWORD_LEN {
        return Err(SecurityError::BadRequest(format!(
            "Your password must be at least {MIN_PASSWORD_LEN} characters."
        )));
    }
    if length > MAX_PASSWORD_LEN {
        return Err(SecurityError::BadRequest(
            "That password is too long.".into(),
        ));
    }
    Ok(password)
}

/// Convenience so a route can build the service without repeating the client lookup.
pub fn service(state: &crate::state::AppState) -> AccountSecurityService<'_> {
    AccountSecurityService::new(
        &state.db,
        &state.config,
        crate::services::edusecure::client_for(&state.config.edusecure),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn confirmation_and_length_rules_are_checked_together() {
        assert!(
            check_new_password("1234567", "1234567").is_err(),
            "too short"
        );
        assert_eq!(
            check_new_password("12345678", "12345678").unwrap(),
            "12345678"
        );
        // Mismatch is reported as a mismatch even when the password itself is fine.
        let mismatch = check_new_password("a-good-password", "a-good-passwore").unwrap_err();
        assert!(mismatch.to_string().contains("do not match"), "{mismatch}");
        // Whitespace is trimmed from both sides before anything is compared.
        assert_eq!(
            check_new_password("  padded-password  ", "\tpadded-password\n").unwrap(),
            "padded-password"
        );
        // A field of spaces is empty, not short: only one of the two tells the user
        // what to do about it.
        let empty = check_new_password("   ", "   ").unwrap_err().to_string();
        assert!(empty.contains("required"), "{empty}");
        assert!(!empty.contains("characters"), "{empty}");
    }

    #[test]
    fn a_session_view_has_nowhere_to_put_a_token() {
        // The wire shape of a device list row is fixed by this struct, and it has no
        // field a verifier could be put in.
        let json = serde_json::to_string(&SessionView {
            id: "public-id".into(),
            device_label: "Chrome on Linux".into(),
            created_at: 1,
            last_used_at: 2,
            expires_at: 3,
            current: true,
        })
        .unwrap();
        assert_eq!(
            json,
            r#"{"id":"public-id","deviceLabel":"Chrome on Linux","createdAt":1,"lastUsedAt":2,"expiresAt":3,"current":true}"#
        );
    }

    #[test]
    fn the_status_view_reports_configuration_and_never_a_credential() {
        let json = serde_json::to_string(&SecurityStatus {
            has_mmss_password: true,
            edusecure_credential_configured: true,
            edusecure_verification_available: false,
        })
        .unwrap();
        assert_eq!(
            json,
            r#"{"hasMmssPassword":true,"edusecureCredentialConfigured":true,"edusecureVerificationAvailable":false}"#
        );
    }

    #[test]
    fn a_wrong_password_and_a_missing_key_are_different_failures_on_purpose() {
        // One is the caller's problem and says so; the other is the deployment's and is
        // a 503. Collapsing them would either blame a student for a missing secret or
        // hide a server fault behind "try again".
        assert_eq!(
            ApiError::from(SecurityError::ReauthenticationFailed).status(),
            axum::http::StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            ApiError::from(SecurityError::CredentialStorageUnavailable).status(),
            axum::http::StatusCode::SERVICE_UNAVAILABLE
        );
        // A portal that cannot be reached is a 503 too, never a 401.
        assert_eq!(
            ApiError::from(SecurityError::EduSecure(PortalError::Unreachable)).status(),
            axum::http::StatusCode::SERVICE_UNAVAILABLE
        );
        // A portal that rejected the password is the one 401 here.
        assert_eq!(
            ApiError::from(SecurityError::EduSecure(PortalError::Unauthenticated)).status(),
            axum::http::StatusCode::UNAUTHORIZED
        );
    }

    #[test]
    fn a_bad_request_message_reaches_the_caller_verbatim() {
        // A validation message is written for a person; it must survive the trip
        // through the service error and back out as a 400 with that text.
        let error = ApiError::from(SecurityError::BadRequest(
            "The two passwords do not match.".into(),
        ));
        assert_eq!(error.status(), axum::http::StatusCode::BAD_REQUEST);
    }
}
