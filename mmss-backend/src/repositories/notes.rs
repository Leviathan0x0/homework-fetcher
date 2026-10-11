use sqlx::SqlitePool;

use crate::clock::now_ms;
use crate::models::{NewNote, Note};

const COLUMNS: &str = "id, user_id, homework_id, body, created_at, updated_at";

pub async fn create(pool: &SqlitePool, new: &NewNote) -> Result<Note, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, Note>(&format!(
        "INSERT INTO notes (user_id, homework_id, body, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)
         RETURNING {COLUMNS}"
    ))
    .bind(new.user_id)
    .bind(new.homework_id)
    .bind(&new.body)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn find_by_id(pool: &SqlitePool, id: i64) -> Result<Option<Note>, sqlx::Error> {
    sqlx::query_as::<_, Note>(&format!("SELECT {COLUMNS} FROM notes WHERE id = ?1"))
        .bind(id)
        .fetch_optional(pool)
        .await
}

/// The student's notes on a specific page of entries, in one query.
pub async fn list_by_user_and_homework(
    pool: &SqlitePool,
    user_id: i64,
    homework_ids: &[i64],
) -> Result<Vec<Note>, sqlx::Error> {
    if homework_ids.is_empty() {
        return Ok(Vec::new());
    }
    // `homework_ids` are bound parameters, never interpolated.
    let placeholders = vec!["?"; homework_ids.len()].join(",");
    let sql = format!(
        "SELECT {COLUMNS} FROM notes
          WHERE user_id = ? AND homework_id IN ({placeholders})
          ORDER BY id"
    );
    let mut query = sqlx::query_as::<_, Note>(&sql).bind(user_id);
    for id in homework_ids {
        query = query.bind(id);
    }
    query.fetch_all(pool).await
}

/// The note a user has on one entry, if any.
pub async fn find_for_homework(
    pool: &SqlitePool,
    user_id: i64,
    homework_id: i64,
) -> Result<Option<Note>, sqlx::Error> {
    sqlx::query_as::<_, Note>(&format!(
        "SELECT {COLUMNS} FROM notes WHERE user_id = ?1 AND homework_id = ?2"
    ))
    .bind(user_id)
    .bind(homework_id)
    .fetch_optional(pool)
    .await
}

/// Creates or replaces the note a user has on one entry, in a single statement.
///
/// The schema promises at most one note per (user, entry) and says so with a UNIQUE
/// index, so a read-then-write upsert is not safe here: two concurrent requests can both
/// read "no note yet" and then both insert, and the loser gets a constraint violation
/// that surfaces as a 500 for a request that was perfectly valid. One statement makes the
/// upsert atomic, which is what `progress::set_completed` already does.
///
/// `created_at` is deliberately left alone on conflict, so replacing a note stays an edit
/// rather than becoming a new note with a new creation time.
pub async fn upsert_for_homework(
    pool: &SqlitePool,
    user_id: i64,
    homework_id: i64,
    body: &str,
) -> Result<Note, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, Note>(&format!(
        "INSERT INTO notes (user_id, homework_id, body, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT (user_id, homework_id) DO UPDATE
             SET body = excluded.body, updated_at = excluded.updated_at
         RETURNING {COLUMNS}"
    ))
    .bind(user_id)
    .bind(homework_id)
    .bind(body)
    .bind(now)
    .fetch_one(pool)
    .await
}

/// Newest first, across both the user's entry notes and their user-scoped notes.
pub async fn list_by_user(pool: &SqlitePool, user_id: i64) -> Result<Vec<Note>, sqlx::Error> {
    sqlx::query_as::<_, Note>(&format!(
        "SELECT {COLUMNS} FROM notes WHERE user_id = ?1 ORDER BY created_at DESC, id DESC"
    ))
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn update(pool: &SqlitePool, id: i64, body: &str) -> Result<Option<Note>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, Note>(&format!(
        "UPDATE notes SET body = ?2, updated_at = ?3 WHERE id = ?1 RETURNING {COLUMNS}"
    ))
    .bind(id)
    .bind(body)
    .bind(now)
    .fetch_optional(pool)
    .await
}

pub async fn delete(pool: &SqlitePool, id: i64) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM notes WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}
