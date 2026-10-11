//! First-time password setup tokens.
//!
//! One token authorises exactly one thing: setting a password on an account that does
//! not have one. It is not a session and not a password reset, and the table is
//! deliberately separate from `sessions` so those three things cannot be confused for
//! one another.
//!
//! The value is never stored. `token_hash` is a SHA-256 digest, the same construction
//! R3 already uses for session tokens, so a database dump contains nothing an attacker
//! can submit to the setup endpoint.

use sqlx::SqlitePool;

use crate::clock::now_ms;
use crate::cookies::{hash_token, new_session_token};

const COLUMNS: &str = "token_hash, user_id, created_at, expires_at, used_at";

#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct SetupToken {
    pub token_hash: String,
    pub user_id: i64,
    pub created_at: i64,
    pub expires_at: i64,
    pub used_at: Option<i64>,
}

/// The plaintext token, returned exactly once.
///
/// `Debug` is hand-written for the same reason `provisioning::Secret`'s is: this is the
/// one type in the system whose derived `Debug` would put a usable credential in a log
/// line, and it is the value most likely to be passed to `unwrap()` in a test.
#[derive(Clone, PartialEq, Eq)]
pub struct IssuedSetupToken {
    pub token: String,
    pub user_id: i64,
    pub expires_at: i64,
}

impl std::fmt::Debug for IssuedSetupToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("IssuedSetupToken")
            .field("token", &"<redacted>")
            .field("user_id", &self.user_id)
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

/// Issues a token and returns the plaintext, which exists nowhere else.
///
/// The randomness and encoding are `new_session_token`'s: 256 bits from the operating
/// system CSPRNG, unpadded base64url. There is deliberately no second generator here
/// -- a 43-character token is the same primitive whether it authorises a session or a
/// first password, and a second implementation would be a second thing to get wrong.
pub async fn issue(
    pool: &SqlitePool,
    user_id: i64,
    ttl_ms: i64,
) -> Result<IssuedSetupToken, sqlx::Error> {
    let token = new_session_token();
    let now = now_ms();
    let expires_at = now + ttl_ms;
    sqlx::query(
        "INSERT INTO setup_tokens (token_hash, user_id, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(hash_token(&token))
    .bind(user_id)
    .bind(now)
    .bind(expires_at)
    .execute(pool)
    .await?;
    Ok(IssuedSetupToken {
        token,
        user_id,
        expires_at,
    })
}

pub async fn find_by_token_hash(
    pool: &SqlitePool,
    token_hash: &str,
) -> Result<Option<SetupToken>, sqlx::Error> {
    sqlx::query_as::<_, SetupToken>(&format!(
        "SELECT {COLUMNS} FROM setup_tokens WHERE token_hash = ?1"
    ))
    .bind(token_hash)
    .fetch_optional(pool)
    .await
}

/// Marks a token used **and** returns the row it consumed, in one statement.
///
/// This is the single-use guarantee, and it is done in SQL rather than as
/// read-then-write for a reason: two concurrent submissions of the same token would
/// both read an unused row and both proceed. `used_at IS NULL` in the `WHERE` makes the
/// second one match nothing.
///
/// Returns `None` for an unknown, already-used or (see below) expired token. Expiry is
/// handled by the caller, not here, so it can be reported differently from a used token
/// -- an operator debugging "why did this stop working" needs to know which.
pub async fn consume(
    pool: &SqlitePool,
    token_hash: &str,
    now: i64,
) -> Result<Option<SetupToken>, sqlx::Error> {
    sqlx::query_as::<_, SetupToken>(&format!(
        "UPDATE setup_tokens SET used_at = ?2
          WHERE token_hash = ?1 AND used_at IS NULL AND expires_at > ?2
      RETURNING {COLUMNS}"
    ))
    .bind(token_hash)
    .bind(now)
    .fetch_optional(pool)
    .await
}

/// How many unused, unexpired tokens a user holds.
///
/// Used to decide whether issuing another one would leave a usable token behind. Not a
/// security control on its own -- tokens are all equally valid until spent -- but
/// accumulating five live tokens for one account is an operational smell worth
/// refusing.
pub async fn count_live_for_user(
    pool: &SqlitePool,
    user_id: i64,
    now: i64,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM setup_tokens
          WHERE user_id = ?1 AND used_at IS NULL AND expires_at > ?2",
    )
    .bind(user_id)
    .bind(now)
    .fetch_one(pool)
    .await
}

/// Revokes every unused token a user holds, returning how many.
///
/// Called when an account is deactivated: a token that would let a leaver set a
/// password and sign in is exactly the thing deactivation exists to prevent.
pub async fn revoke_for_user(pool: &SqlitePool, user_id: i64) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE setup_tokens SET used_at = ?2
          WHERE user_id = ?1 AND used_at IS NULL",
    )
    .bind(user_id)
    .bind(now_ms())
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

/// Drops rows that are spent or expired.
///
/// Not called on a request path. An expired token already authorises nothing; this only
/// stops the table growing without bound across a school's years of enrolment.
pub async fn delete_dead(pool: &SqlitePool, now: i64) -> Result<u64, sqlx::Error> {
    let result =
        sqlx::query("DELETE FROM setup_tokens WHERE used_at IS NOT NULL OR expires_at <= ?1")
            .bind(now)
            .execute(pool)
            .await?;
    Ok(result.rows_affected())
}
