use sqlx::SqlitePool;

use crate::clock::now_ms;
use crate::models::Session;

const COLUMNS: &str = "token_hash, user_id, created_at, expires_at";

/// Records a session. The caller supplies the already-hashed token, so a plaintext
/// session value is never on its way to being stored.
pub async fn create(
    pool: &SqlitePool,
    token_hash: &str,
    user_id: i64,
    expires_at: i64,
) -> Result<Session, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, Session>(&format!(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4)
         RETURNING {COLUMNS}"
    ))
    .bind(token_hash)
    .bind(user_id)
    .bind(now)
    .bind(expires_at)
    .fetch_one(pool)
    .await
}

/// Looks a session up by the hash of its token.
///
/// Expiry is deliberately *not* applied here: the caller decides what an expired row
/// means (reject, then delete). Hiding it here would make "expired" and "revoked"
/// indistinguishable to the service that has to log them differently.
pub async fn find_by_token_hash(
    pool: &SqlitePool,
    token_hash: &str,
) -> Result<Option<Session>, sqlx::Error> {
    sqlx::query_as::<_, Session>(&format!(
        "SELECT {COLUMNS} FROM sessions WHERE token_hash = ?1"
    ))
    .bind(token_hash)
    .fetch_optional(pool)
    .await
}

/// Revokes one session. `false` means it was already gone, which is what makes
/// repeated logout safe rather than an error.
pub async fn delete(pool: &SqlitePool, token_hash: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM sessions WHERE token_hash = ?1")
        .bind(token_hash)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Revokes every session a user holds, on every device. Used when a credential
/// changes or staff act on an account.
pub async fn delete_for_user(pool: &SqlitePool, user_id: i64) -> Result<u64, sqlx::Error> {
    let result = sqlx::query("DELETE FROM sessions WHERE user_id = ?1")
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}

/// Drops rows that expired before `now`. Expired sessions already grant nothing;
/// this only stops the table growing without bound between logins.
pub async fn delete_expired(pool: &SqlitePool, now: i64) -> Result<u64, sqlx::Error> {
    let result = sqlx::query("DELETE FROM sessions WHERE expires_at <= ?1")
        .bind(now)
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}
