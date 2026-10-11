use sqlx::SqlitePool;

use crate::clock::now_ms;
use crate::models::HomeworkProgress;

const COLUMNS: &str = "id, user_id, homework_id, completed, created_at, updated_at";

/// Ticks or unticks an entry for one student, creating the row on first use.
/// The old API did the same upsert, so a repeated tick is not an error and a
/// student's state survives a diary re-import.
pub async fn set_completed(
    pool: &SqlitePool,
    user_id: i64,
    homework_id: i64,
    completed: bool,
) -> Result<HomeworkProgress, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, HomeworkProgress>(&format!(
        "INSERT INTO homework_progress (user_id, homework_id, completed, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT (user_id, homework_id) DO UPDATE
             SET completed = excluded.completed, updated_at = excluded.updated_at
         RETURNING {COLUMNS}"
    ))
    .bind(user_id)
    .bind(homework_id)
    .bind(completed)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn find(
    pool: &SqlitePool,
    user_id: i64,
    homework_id: i64,
) -> Result<Option<HomeworkProgress>, sqlx::Error> {
    sqlx::query_as::<_, HomeworkProgress>(&format!(
        "SELECT {COLUMNS} FROM homework_progress WHERE user_id = ?1 AND homework_id = ?2"
    ))
    .bind(user_id)
    .bind(homework_id)
    .fetch_optional(pool)
    .await
}

pub async fn list_by_user(
    pool: &SqlitePool,
    user_id: i64,
) -> Result<Vec<HomeworkProgress>, sqlx::Error> {
    sqlx::query_as::<_, HomeworkProgress>(&format!(
        "SELECT {COLUMNS} FROM homework_progress WHERE user_id = ?1 ORDER BY homework_id"
    ))
    .bind(user_id)
    .fetch_all(pool)
    .await
}

/// The student's completion state for a specific page of entries, in one query. Bounded
/// to `homework_ids` so a feed does not drag in every tick this student has ever made.
pub async fn list_for_user_and_homework(
    pool: &SqlitePool,
    user_id: i64,
    homework_ids: &[i64],
) -> Result<Vec<HomeworkProgress>, sqlx::Error> {
    if homework_ids.is_empty() {
        return Ok(Vec::new());
    }
    // `homework_ids` are bound parameters, never interpolated.
    let placeholders = vec!["?"; homework_ids.len()].join(",");
    let sql = format!(
        "SELECT {COLUMNS} FROM homework_progress
          WHERE user_id = ? AND homework_id IN ({placeholders})
          ORDER BY homework_id"
    );
    let mut query = sqlx::query_as::<_, HomeworkProgress>(&sql).bind(user_id);
    for id in homework_ids {
        query = query.bind(id);
    }
    query.fetch_all(pool).await
}

pub async fn delete(
    pool: &SqlitePool,
    user_id: i64,
    homework_id: i64,
) -> Result<bool, sqlx::Error> {
    let result =
        sqlx::query("DELETE FROM homework_progress WHERE user_id = ?1 AND homework_id = ?2")
            .bind(user_id)
            .bind(homework_id)
            .execute(pool)
            .await?;
    Ok(result.rows_affected() > 0)
}
