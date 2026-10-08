//! Local password credentials.
//!
//! A row exists only for an account this deployment verifies itself. The
//! argon2id hash is produced in `services::auth`, not here, so this module never
//! sees a plaintext password at all.

use sqlx::SqlitePool;

use crate::clock::now_ms;

/// The stored hash for a user, or `None` when the account has no local credential.
pub async fn find_password_hash(
    pool: &SqlitePool,
    user_id: i64,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT password_hash FROM credentials WHERE user_id = ?1")
        .bind(user_id)
        .fetch_optional(pool)
        .await
}

/// Sets or replaces a user's password. Replacing the hash must not invalidate the
/// user's live sessions — an unrelated signed-in browser should not be logged out
/// because a password was rotated elsewhere. The service revokes explicitly when
/// that is the intent.
pub async fn set_password_hash(
    pool: &SqlitePool,
    user_id: i64,
    password_hash: &str,
) -> Result<(), sqlx::Error> {
    let now = now_ms();
    sqlx::query(
        "INSERT INTO credentials (user_id, password_hash, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT (user_id) DO UPDATE
             SET password_hash = excluded.password_hash, updated_at = excluded.updated_at",
    )
    .bind(user_id)
    .bind(password_hash)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete(pool: &SqlitePool, user_id: i64) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM credentials WHERE user_id = ?1")
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}
