//! The EduSecure publication ledger.
//!
//! Integration state, never domain state. Nothing here can change what homework *is* --
//! the only effect any of these functions has on the source of truth is the cascade when
//! an entry is deleted, which removes its publication row with it.

use sqlx::SqlitePool;

use crate::clock::now_ms;
use crate::models::{EduSecurePublication, PublicationStatus};

const COLUMNS: &str =
    "homework_id, status, external_id, last_error, attempts, created_at, updated_at";

pub async fn find(
    pool: &SqlitePool,
    homework_id: i64,
) -> Result<Option<EduSecurePublication>, sqlx::Error> {
    sqlx::query_as::<_, EduSecurePublication>(&format!(
        "SELECT {COLUMNS} FROM edusecure_publications WHERE homework_id = ?1"
    ))
    .bind(homework_id)
    .fetch_optional(pool)
    .await
}

/// Makes sure a ledger row exists for this entry, and returns it.
///
/// `INSERT OR IGNORE` rather than a check-then-insert: two concurrent publishes would
/// otherwise both see no row and then collide on the primary key. `OR IGNORE` cannot fail,
/// so the select that follows always finds exactly one row.
pub async fn ensure(
    pool: &SqlitePool,
    homework_id: i64,
) -> Result<EduSecurePublication, sqlx::Error> {
    let now = now_ms();
    sqlx::query(
        "INSERT OR IGNORE INTO edusecure_publications
            (homework_id, status, attempts, created_at, updated_at)
         VALUES (?1, 'pending', 0, ?2, ?2)",
    )
    .bind(homework_id)
    .bind(now)
    .execute(pool)
    .await?;
    find(pool, homework_id)
        .await?
        .ok_or(sqlx::Error::RowNotFound)
}

/// Records the outcome of an attempt.
///
/// `attempts` is incremented by the database rather than by the caller, so two concurrent
/// attempts cannot both read the same count and write it back.
pub async fn finish(
    pool: &SqlitePool,
    homework_id: i64,
    status: PublicationStatus,
    external_id: Option<&str>,
    last_error: Option<&str>,
) -> Result<Option<EduSecurePublication>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, EduSecurePublication>(&format!(
        "UPDATE edusecure_publications
            SET status = ?2,
                external_id = ?3,
                last_error = ?4,
                attempts = attempts + 1,
                updated_at = ?5
          WHERE homework_id = ?1
        RETURNING {COLUMNS}"
    ))
    .bind(homework_id)
    .bind(status.as_str())
    .bind(external_id)
    .bind(last_error)
    .bind(now)
    .fetch_optional(pool)
    .await
}

/// Everything still to be pushed, oldest first. The operator/batch entry point.
pub async fn list_pending(pool: &SqlitePool) -> Result<Vec<EduSecurePublication>, sqlx::Error> {
    sqlx::query_as::<_, EduSecurePublication>(&format!(
        "SELECT {COLUMNS} FROM edusecure_publications
          WHERE status != 'published'
          ORDER BY updated_at, homework_id"
    ))
    .fetch_all(pool)
    .await
}

/// Removes the ledger row. Only useful for deliberately re-publishing from scratch.
pub async fn delete(pool: &SqlitePool, homework_id: i64) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM edusecure_publications WHERE homework_id = ?1")
        .bind(homework_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}
