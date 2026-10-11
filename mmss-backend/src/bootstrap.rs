//! Startup provisioning.
//!
//! A freshly initialised database has no accounts at all, which would leave nobody
//! able to sign in. The old system solved this the same way: an administrator
//! username and password read from the environment, with the password refusing the
//! login when it is unset rather than falling back to anything.
//!
//! Provisioning is idempotent. It never overwrites a password an administrator has
//! since changed, and it never logs the password or prints it on failure.

use anyhow::Result;
use sqlx::SqlitePool;

use crate::config::Config;
use crate::models::{NewUser, Role};
use crate::repositories::users;
use crate::services::auth::AuthService;

/// Reads `ADMIN_USERNAME` / `ADMIN_PASSWORD` and makes sure the account exists.
///
/// Returns the account's id when one is provisioned, and `None` when no password is
/// configured, which means the deployment has no administrator at all — the same
/// state the old system describes as "admin login is refused".
pub async fn ensure_admin(db: &SqlitePool, config: &Config) -> Result<Option<i64>> {
    let password = match std::env::var("ADMIN_PASSWORD") {
        Ok(value) if !value.trim().is_empty() => value,
        // Nothing to do, and nothing to warn about: an unset password is the
        // supported way to run without an administrator.
        _ => return Ok(None),
    };
    let username = std::env::var("ADMIN_USERNAME").unwrap_or_else(|_| "admin_mmss".to_owned());
    let username = AuthService::normalize_school_id(&username);
    if username.is_empty() {
        anyhow::bail!("ADMIN_USERNAME is set but empty");
    }

    let service = AuthService::new(db, config);
    let existing = match users::find_by_school_id(db, &username).await? {
        Some(user) => Some(user),
        None => users::find_by_school_id_ignore_case(db, &username).await?,
    };

    let Some(user) = existing else {
        let principal = service
            .create_user_with_password(
                &NewUser {
                    school_id: username,
                    display_name: Some("Administrator".to_owned()),
                    role: Role::Admin,
                    class_id: None,
                },
                &password,
            )
            .await?;
        // The id is not a secret, so it is safe to log; the password is not.
        tracing::info!(
            user_id = principal.user_id,
            "provisioned administrator account"
        );
        return Ok(Some(principal.user_id));
    };

    // The account is already there. Fill in only what is missing, so a password an
    // administrator has changed is not silently reverted on the next restart.
    let service_has_credential = crate::repositories::credentials::find_password_hash(db, user.id)
        .await?
        .is_some();
    if !service_has_credential {
        service.set_password(user.id, &password).await?;
        tracing::info!(
            user_id = user.id,
            "set the configured password on the existing administrator account"
        );
    }
    if user.role != Role::Admin {
        tracing::warn!(
            user_id = user.id,
            "the configured administrator account is not an admin role"
        );
    }
    Ok(Some(user.id))
}
