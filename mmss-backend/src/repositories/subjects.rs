use sqlx::SqlitePool;

use crate::clock::now_ms;
use crate::models::{NewSubject, Subject};

const COLUMNS: &str = "id, name, created_at, updated_at";

pub async fn find_by_id(pool: &SqlitePool, id: i64) -> Result<Option<Subject>, sqlx::Error> {
    sqlx::query_as::<_, Subject>(&format!("SELECT {COLUMNS} FROM subjects WHERE id = ?1"))
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn find_by_name(pool: &SqlitePool, name: &str) -> Result<Option<Subject>, sqlx::Error> {
    sqlx::query_as::<_, Subject>(&format!("SELECT {COLUMNS} FROM subjects WHERE name = ?1"))
        .bind(name)
        .fetch_optional(pool)
        .await
}

pub async fn list(pool: &SqlitePool) -> Result<Vec<Subject>, sqlx::Error> {
    sqlx::query_as::<_, Subject>(&format!("SELECT {COLUMNS} FROM subjects ORDER BY name"))
        .fetch_all(pool)
        .await
}

/// A page of homework needs the names of the subjects it references, in one query
/// rather than one per entry.
pub async fn find_by_ids(pool: &SqlitePool, ids: &[i64]) -> Result<Vec<Subject>, sqlx::Error> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    // `ids` are bound parameters, never interpolated.
    let placeholders = vec!["?"; ids.len()].join(",");
    let sql = format!("SELECT {COLUMNS} FROM subjects WHERE id IN ({placeholders})");
    let mut query = sqlx::query_as::<_, Subject>(&sql);
    for id in ids {
        query = query.bind(id);
    }
    query.fetch_all(pool).await
}

pub async fn create(pool: &SqlitePool, new_subject: &NewSubject) -> Result<Subject, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, Subject>(&format!(
        "INSERT INTO subjects (name, created_at, updated_at)
         VALUES (?1, ?2, ?2)
         RETURNING {COLUMNS}"
    ))
    .bind(&new_subject.name)
    .bind(now)
    .fetch_one(pool)
    .await
}

/// A subject still referenced by homework is rejected by its
/// `ON DELETE RESTRICT` foreign key.
pub async fn delete(pool: &SqlitePool, id: i64) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM subjects WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}
