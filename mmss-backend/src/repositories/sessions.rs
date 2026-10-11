//! Session rows.
//!
//! Two ideas are worth reading before the queries below.
//!
//! **The token is never here.** Callers pass the already-hashed token, so a plaintext
//! session value is never on its way to being stored, and the database holds a digest
//! that cannot be pasted into a cookie.
//!
//! **Expiry is not applied here.** A caller decides what an expired row means --
//! reject it, then delete it, or report it -- and hiding that decision in this module
//! would make "expired" and "revoked" indistinguishable to the service that has to
//! treat them differently.

use sqlx::SqlitePool;

use crate::clock::now_ms;
use crate::models::Session;

const COLUMNS: &str = "token_hash, user_id, created_at, expires_at, id, last_used_at, device_label";

/// How stale `last_used_at` may get before an authenticated request writes it again.
///
/// The column exists so the device list can say "last active" and so the idle timeout
/// has something to measure from, and neither needs second-level accuracy. Writing on
/// every authenticated request instead would turn every read -- every homework fetch,
/// every poll -- into a write, on a SQLite file a single VPS is writing to.
///
/// Five minutes is short enough that "last active" is true to within five minutes and
/// long enough that a page open with a poll running costs one write per five minutes
/// rather than one per poll.
pub const ACTIVITY_TOUCH_INTERVAL_MS: i64 = 5 * 60 * 1000;

/// Records a session. The caller supplies the already-hashed token, the public id and
/// the best-effort device label, so a plaintext session value is never on its way to
/// being stored.
pub async fn create(pool: &SqlitePool, session: NewSession<'_>) -> Result<Session, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, Session>(&format!(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, id, last_used_at, device_label)
         VALUES (?1, ?2, ?3, ?4, ?5, ?3, ?6)
         RETURNING {COLUMNS}"
    ))
    .bind(session.token_hash)
    .bind(session.user_id)
    .bind(now)
    .bind(session.expires_at)
    .bind(session.id)
    .bind(session.device_label)
    .fetch_one(pool)
    .await
}

/// The values a caller supplies when opening a session.
///
/// A struct rather than five positional arguments because two of them are `&str` that
/// are easy to swap, and swapping `id` with `device_label` would produce a device list
/// that leaks session identifiers into a column the frontend renders as text.
pub struct NewSession<'a> {
    pub token_hash: &'a str,
    pub id: &'a str,
    pub user_id: i64,
    pub expires_at: i64,
    pub device_label: &'a str,
}

/// Looks a session up by the hash of its token.
///
/// Expiry is deliberately *not* applied here: the caller decides what an expired row
/// means (reject, then delete).
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

/// Every live session an account holds, most recently active first.
///
/// Expired rows are filtered in SQL rather than after the fetch, so an account that
/// has not signed in for months does not pay to list its own dead rows. Idle-expiry
/// uses the same read path as `AuthService::validate_session`, so a row this list
/// refuses to show is a row the next request would refuse anyway -- the two must not
/// disagree, or the device list becomes a list of sessions that do not work.
pub async fn list_for_user(
    pool: &SqlitePool,
    user_id: i64,
    now: i64,
    idle_ms: i64,
    limit: i64,
    offset: i64,
) -> Result<SessionPage, sqlx::Error> {
    let live = "expires_at > ?2 AND coalesce(last_used_at, created_at) > ?2 - ?3";

    // A separate count, not something derived from the page: "showing 20 of 91" is the
    // fact the UI needs, and "there are at least 20" is not.
    let total: i64 = sqlx::query_scalar(&format!(
        "SELECT count(*) FROM sessions WHERE user_id = ?1 AND {live}"
    ))
    .bind(user_id)
    .bind(now)
    .bind(idle_ms)
    .fetch_one(pool)
    .await?;

    let sessions = sqlx::query_as::<_, Session>(&format!(
        "SELECT {COLUMNS} FROM sessions
          WHERE user_id = ?1 AND {live}
          ORDER BY coalesce(last_used_at, created_at) DESC, created_at DESC, token_hash DESC
          LIMIT ?4 OFFSET ?5"
    ))
    .bind(user_id)
    .bind(now)
    .bind(idle_ms)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok(SessionPage { sessions, total })
}

/// One page of a user's live sessions, plus the total so the caller can say whether it
/// is showing everything.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionPage {
    pub sessions: Vec<Session>,
    pub total: i64,
}

/// Largest page a caller may ask for.
///
/// Bounded so `?limit=100000` cannot turn the device list into a memory spike, and so
/// the number a person is asked to read stays a number they can read.
pub const MAX_PAGE_SIZE: i64 = 100;

/// The page size the UI requests when it does not ask for one.
pub const DEFAULT_PAGE_SIZE: i64 = 20;

/// Revokes one session belonging to `user_id`.
///
/// `user_id` is part of the predicate and not merely checked afterwards. That is the
/// whole cross-user defence: a caller who edits the id in the request body changes
/// which row the statement looks for, and the statement simply matches nothing --
/// there is no code path where an ownership check could be forgotten, because there
/// is no separate ownership check.
///
/// `false` means "not yours, or already gone". Both answer the same way on purpose:
/// telling them apart is how a caller discovers which session ids exist.
pub async fn delete_for_user_by_id(
    pool: &SqlitePool,
    user_id: i64,
    id: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM sessions WHERE user_id = ?1 AND id = ?2")
        .bind(user_id)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Revokes every session an account holds *except* the one making the request.
///
/// The current session is identified by its own `id`, taken from the resolved
/// principal rather than from the request body, so a caller cannot talk this endpoint
/// into signing itself out.
pub async fn delete_others_for_user(
    pool: &SqlitePool,
    user_id: i64,
    keep_id: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query("DELETE FROM sessions WHERE user_id = ?1 AND id IS NOT ?2")
        .bind(user_id)
        .bind(keep_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
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

/// Records activity on a session, at most once per [`ACTIVITY_TOUCH_INTERVAL_MS`].
///
/// The window is enforced in the `WHERE` clause rather than by reading first, so
/// concurrent requests cannot all decide the row is stale and all write. A request
/// that loses the race costs one no-op write, which is the cheapest possible outcome.
pub async fn touch(pool: &SqlitePool, token_hash: &str, now: i64) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE sessions SET last_used_at = ?2
          WHERE token_hash = ?1
            AND coalesce(last_used_at, 0) <= ?2 - ?3",
    )
    .bind(token_hash)
    .bind(now)
    .bind(ACTIVITY_TOUCH_INTERVAL_MS)
    .execute(pool)
    .await?;
    Ok(())
}

/// Drops rows that expired before `now`. Expired sessions already grant nothing;
/// this only stops the table growing without bound between logins.
///
/// Idle-expired rows are deliberately not swept here: unlike an absolute expiry they
/// are still live rows whose token is refused on use, and deleting them on a schedule
/// nobody is running would be a guess about when a deployment does have one.
pub async fn delete_expired(pool: &SqlitePool, now: i64) -> Result<u64, sqlx::Error> {
    let result = sqlx::query("DELETE FROM sessions WHERE expires_at <= ?1")
        .bind(now)
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The read path is one string shared by every query above; if it drifts from
    /// what the `Session` struct expects, sqlx fails at runtime rather than at compile
    /// time, so the count is asserted here instead.
    #[test]
    fn every_column_is_selected_exactly_once() {
        let columns: Vec<&str> = COLUMNS.split(", ").collect();
        assert_eq!(
            columns,
            [
                "token_hash",
                "user_id",
                "created_at",
                "expires_at",
                "id",
                "last_used_at",
                "device_label"
            ]
        );
        assert_eq!(
            columns
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len(),
            columns.len()
        );
    }
}
