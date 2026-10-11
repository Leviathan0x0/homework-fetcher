use sqlx::SqlitePool;

use crate::clock::now_ms;
use crate::models::{NewUser, User};

const COLUMNS: &str =
    "id, school_id, display_name, role, class_id, is_active, created_at, updated_at";

pub async fn find_by_id(pool: &SqlitePool, id: i64) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(&format!("SELECT {COLUMNS} FROM users WHERE id = ?1"))
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn find_by_school_id(
    pool: &SqlitePool,
    school_id: &str,
) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(&format!("SELECT {COLUMNS} FROM users WHERE school_id = ?1"))
        .bind(school_id)
        .fetch_optional(pool)
        .await
}

/// A page of homework needs its authors in one query rather than one per entry.
pub async fn find_by_ids(pool: &SqlitePool, ids: &[i64]) -> Result<Vec<User>, sqlx::Error> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    // `ids` are bound parameters, never interpolated.
    let placeholders = vec!["?"; ids.len()].join(",");
    let sql = format!("SELECT {COLUMNS} FROM users WHERE id IN ({placeholders})");
    let mut query = sqlx::query_as::<_, User>(&sql);
    for id in ids {
        query = query.bind(id);
    }
    query.fetch_all(pool).await
}

/// Finds a user by school ID ignoring case, the way the old login did when a student
/// typed their ID in a different case from the one the school issued.
///
/// Auth-only: exact matching stays canonical everywhere else, and this never
/// rewrites the stored value, so the first account to claim an ID keeps its
/// spelling. If case-insensitive matching ever matches more than one row the IDs are
/// genuinely ambiguous, so this refuses rather than letting one account answer for
/// another -- `LIMIT 2` is enough to notice, `ORDER BY id` keeps it deterministic.
pub async fn find_by_school_id_ignore_case(
    pool: &SqlitePool,
    school_id: &str,
) -> Result<Option<User>, sqlx::Error> {
    let matches: Vec<User> = sqlx::query_as::<_, User>(&format!(
        "SELECT {COLUMNS} FROM users
          WHERE lower(trim(school_id)) = lower(trim(?1))
          ORDER BY id LIMIT 2"
    ))
    .bind(school_id)
    .fetch_all(pool)
    .await?;
    match matches.as_slice() {
        [] => Ok(None),
        [user] => Ok(Some(user.clone())),
        _ => {
            tracing::warn!(
                "case-insensitive school ID lookup matched more than one account; refusing"
            );
            Ok(None)
        }
    }
}

pub async fn create(pool: &SqlitePool, new_user: &NewUser) -> Result<User, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, User>(&format!(
        "INSERT INTO users (school_id, display_name, role, class_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         RETURNING {COLUMNS}"
    ))
    .bind(&new_user.school_id)
    .bind(&new_user.display_name)
    .bind(new_user.role)
    .bind(new_user.class_id)
    .bind(now)
    .fetch_one(pool)
    .await
}

/// Flips an account's active state.
///
/// Returns `None` when the account is already in the requested state, which is what
/// makes a deactivation roster idempotent: re-running it changes nothing and reports
/// "already deactivated" rather than inventing work.
///
/// Deliberately the *only* way `is_active` changes. Role and class have no such
/// function on purpose -- R11 established that a roster does not get authority to
/// change them, and nothing in R12 gives it back.
pub async fn set_active(
    pool: &SqlitePool,
    id: i64,
    is_active: bool,
) -> Result<Option<User>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, User>(&format!(
        "UPDATE users SET is_active = ?2, updated_at = ?3
          WHERE id = ?1 AND is_active != ?2
      RETURNING {COLUMNS}"
    ))
    .bind(id)
    .bind(is_active)
    .bind(now)
    .fetch_optional(pool)
    .await
}

/// Renames a user. `None` leaves the current name alone, which is what a
/// partial update should do.
pub async fn update_display_name(
    pool: &SqlitePool,
    id: i64,
    display_name: Option<&str>,
) -> Result<Option<User>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, User>(&format!(
        "UPDATE users
            SET display_name = COALESCE(?2, display_name), updated_at = ?3
          WHERE id = ?1
      RETURNING {COLUMNS}"
    ))
    .bind(id)
    .bind(display_name)
    .bind(now)
    .fetch_optional(pool)
    .await
}

/// Deleting a user cascades to their notes and progress. Homework they authored
/// survives with a `NULL` author, so deleting an account never silently removes
/// a class's homework.
pub async fn delete(pool: &SqlitePool, id: i64) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM users WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}
