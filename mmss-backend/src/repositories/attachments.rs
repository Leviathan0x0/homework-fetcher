use sqlx::{Executor, Sqlite, SqlitePool};

use crate::clock::now_ms;
use crate::models::{Attachment, NewAttachment};

const COLUMNS: &str = "id, homework_id, filename, mime_type, size_bytes, storage_key, created_at";

/// Records metadata for one file. The bytes go to whatever storage a later
/// phase installs, addressed by `storage_key`.
///
/// Generic over the executor so the same statement runs against a pool or
/// inside a transaction: creating homework with attachments writes more than one
/// row, and that write has to be atomic.
pub async fn create<'q, E>(executor: E, new: &NewAttachment) -> Result<Attachment, sqlx::Error>
where
    E: Executor<'q, Database = Sqlite>,
{
    let now = now_ms();
    sqlx::query_as::<_, Attachment>(&format!(
        "INSERT INTO attachments
            (homework_id, filename, mime_type, size_bytes, storage_key, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         RETURNING {COLUMNS}"
    ))
    .bind(new.homework_id)
    .bind(&new.filename)
    .bind(&new.mime_type)
    .bind(new.size_bytes)
    .bind(&new.storage_key)
    .bind(now)
    .fetch_one(executor)
    .await
}

pub async fn find_by_id(pool: &SqlitePool, id: i64) -> Result<Option<Attachment>, sqlx::Error> {
    sqlx::query_as::<_, Attachment>(&format!("SELECT {COLUMNS} FROM attachments WHERE id = ?1"))
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn list_by_homework(
    pool: &SqlitePool,
    homework_id: i64,
) -> Result<Vec<Attachment>, sqlx::Error> {
    sqlx::query_as::<_, Attachment>(&format!(
        "SELECT {COLUMNS} FROM attachments WHERE homework_id = ?1 ORDER BY id"
    ))
    .bind(homework_id)
    .fetch_all(pool)
    .await
}

/// Attachments for a whole page of entries in one query, so a feed costs one lookup
/// rather than one per card.
pub async fn list_for_homework(
    pool: &SqlitePool,
    homework_ids: &[i64],
) -> Result<Vec<Attachment>, sqlx::Error> {
    if homework_ids.is_empty() {
        return Ok(Vec::new());
    }
    // `homework_ids` are bound parameters, never interpolated.
    let placeholders = vec!["?"; homework_ids.len()].join(",");
    let sql = format!(
        "SELECT {COLUMNS} FROM attachments WHERE homework_id IN ({placeholders}) ORDER BY id"
    );
    let mut query = sqlx::query_as::<_, Attachment>(&sql);
    for id in homework_ids {
        query = query.bind(id);
    }
    query.fetch_all(pool).await
}

/// Drops the metadata only. The file behind `storage_key` is a storage-layer
/// concern, so a caller that owns the bytes deletes them itself.
pub async fn delete(pool: &SqlitePool, id: i64) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM attachments WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}
