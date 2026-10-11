//! Stored EduSecure credentials.
//!
//! A row exists only for an account whose portal credential this deployment holds. The
//! value is AES-256-GCM ciphertext produced by [`crate::crypto`], never plaintext and
//! never a hash: a hash would be verifiable but not recoverable, and fetching homework
//! needs the portal to accept the real password.
//!
//! Nothing in this module sees a plaintext password. The encryption happens in the
//! service, above this layer, so the same property holds here that
//! [`crate::repositories::credentials`] has: the repository stores a value it was
//! handed, and that value is already sealed.

use sqlx::SqlitePool;

use crate::clock::now_ms;

/// The stored credential for a user, or `None` when none has been saved.
///
/// Deliberately returns the sealed string rather than a model type: there is one
/// column, no second row shape, and nothing downstream needs to know the timestamp.
pub async fn find_ciphertext(
    pool: &SqlitePool,
    user_id: i64,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT ciphertext FROM edusecure_credentials WHERE user_id = ?1")
        .bind(user_id)
        .fetch_optional(pool)
        .await
}

/// Whether a credential has ever been stored for a user.
///
/// Exists so the account-security page can say "configured" or "not configured"
/// without reading -- let alone decrypting -- the value itself.
pub async fn is_configured(pool: &SqlitePool, user_id: i64) -> Result<bool, sqlx::Error> {
    Ok(find_ciphertext(pool, user_id).await?.is_some())
}

/// Sets or replaces a user's credential in one transaction.
///
/// A single statement, so a caller that runs this inside a transaction cannot end up
/// with the credential written and the password hash not, or the reverse. An upsert
/// rather than insert-then-update because "replace a saved credential" is the same
/// operation as "save one for the first time" and splitting it invites a delete
/// window.
pub async fn set_ciphertext<'e, E>(
    executor: E,
    user_id: i64,
    ciphertext: &str,
) -> Result<(), sqlx::Error>
where
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    let now = now_ms();
    sqlx::query(
        "INSERT INTO edusecure_credentials (user_id, ciphertext, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT (user_id) DO UPDATE
             SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at",
    )
    .bind(user_id)
    .bind(ciphertext)
    .bind(now)
    .execute(executor)
    .await?;
    Ok(())
}
