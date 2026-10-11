use sqlx::SqlitePool;

use crate::clock::now_ms;

/// Whether `teacher_id` is assigned to teach `class_id`.
///
/// This is the teacher's authorization question, answered by the assignment
/// table and nothing else. A class named in a request body is a *target*, never
/// a permission: the answer here comes from the authenticated user id plus this
/// row existing.
pub async fn teaches(
    pool: &SqlitePool,
    teacher_id: i64,
    class_id: i64,
) -> Result<bool, sqlx::Error> {
    let found: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM teacher_classes WHERE teacher_id = ?1 AND class_id = ?2")
            .bind(teacher_id)
            .bind(class_id)
            .fetch_optional(pool)
            .await?;
    Ok(found.is_some())
}

/// The class ids one teacher may manage, ascending.
///
/// One query for a whole timetable rather than one per candidate class, which
/// keeps the list endpoint's scoping flat: the ids become an `IN (...)` on the
/// same `homework::Filter` the student feed already uses.
pub async fn list_for_teacher(pool: &SqlitePool, teacher_id: i64) -> Result<Vec<i64>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT class_id FROM teacher_classes WHERE teacher_id = ?1 ORDER BY class_id",
    )
    .bind(teacher_id)
    .fetch_all(pool)
    .await
}

/// Records one assignment, the documented dev path until the admin management
/// CRUD exists (deliberately deferred -- see the migration).
///
/// The `role = 'teacher'` invariant is enforced by triggers in the migration,
/// because a `CHECK` cannot reference `users`; a non-teacher or unknown id is
/// therefore refused by SQLite itself.
pub async fn assign(
    pool: &SqlitePool,
    teacher_id: i64,
    class_id: i64,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "INSERT OR IGNORE INTO teacher_classes (teacher_id, class_id, created_at)
         VALUES (?1, ?2, ?3)",
    )
    .bind(teacher_id)
    .bind(class_id)
    .bind(now_ms())
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}
