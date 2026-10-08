use sqlx::SqlitePool;

use crate::clock::now_ms;
use crate::models::{Class, NewClass};

const COLUMNS: &str = "id, name, created_at, updated_at";

pub async fn find_by_id(pool: &SqlitePool, id: i64) -> Result<Option<Class>, sqlx::Error> {
    sqlx::query_as::<_, Class>(&format!("SELECT {COLUMNS} FROM classes WHERE id = ?1"))
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn find_by_name(pool: &SqlitePool, name: &str) -> Result<Option<Class>, sqlx::Error> {
    sqlx::query_as::<_, Class>(&format!("SELECT {COLUMNS} FROM classes WHERE name = ?1"))
        .bind(name)
        .fetch_optional(pool)
        .await
}

/// The classes a page of entries belongs to, in one query rather than one per
/// entry. Same shape as `subjects::find_by_ids` and `users::find_by_ids`, for
/// the same reason: a teacher's list labels every row with its class name.
pub async fn find_by_ids(pool: &SqlitePool, ids: &[i64]) -> Result<Vec<Class>, sqlx::Error> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    // `ids` are bound parameters, never interpolated.
    let placeholders = vec!["?"; ids.len()].join(",");
    let sql = format!("SELECT {COLUMNS} FROM classes WHERE id IN ({placeholders})");
    let mut query = sqlx::query_as::<_, Class>(&sql);
    for id in ids {
        query = query.bind(id);
    }
    query.fetch_all(pool).await
}

pub async fn list(pool: &SqlitePool) -> Result<Vec<Class>, sqlx::Error> {
    sqlx::query_as::<_, Class>(&format!("SELECT {COLUMNS} FROM classes ORDER BY name"))
        .fetch_all(pool)
        .await
}

pub async fn create(pool: &SqlitePool, new_class: &NewClass) -> Result<Class, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, Class>(&format!(
        "INSERT INTO classes (name, created_at, updated_at)
         VALUES (?1, ?2, ?2)
         RETURNING {COLUMNS}"
    ))
    .bind(&new_class.name)
    .bind(now)
    .fetch_one(pool)
    .await
}

/// Renames a class. Students and homework keep pointing at the same row.
pub async fn rename(pool: &SqlitePool, id: i64, name: &str) -> Result<Option<Class>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, Class>(&format!(
        "UPDATE classes SET name = ?2, updated_at = ?3 WHERE id = ?1 RETURNING {COLUMNS}"
    ))
    .bind(id)
    .bind(name)
    .bind(now)
    .fetch_optional(pool)
    .await
}

/// A class still holding a student or homework is rejected by its
/// `ON DELETE RESTRICT` foreign keys rather than being cascaded away.
pub async fn delete(pool: &SqlitePool, id: i64) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM classes WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}
