use sqlx::{Executor, QueryBuilder, Sqlite, SqlitePool};

use crate::clock::now_ms;
use crate::models::{Homework, NewHomework};

const COLUMNS: &str = "id, class_id, subject_id, author_id, due_date, \
                       homework_text, classwork_text, created_at, updated_at";

/// Every criterion is optional and they combine with AND. The dashboard's
/// Today / Recent / Calendar / subject views are all one query with a different
/// subset of these set.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Filter {
    pub class_id: Option<i64>,
    /// "Any of these classes", for a caller who may manage several at once --
    /// the teacher listing. An empty vec means no restriction, so it composes
    /// with `Default` and never turns into `IN ()`. `class_id` and this are
    /// independent, and using both is an impossible query that returns nothing,
    /// which is why no caller does.
    pub class_ids: Vec<i64>,
    pub subject_id: Option<i64>,
    pub author_id: Option<i64>,
    /// Inclusive lower bound on the school day, `YYYY-MM-DD`.
    pub due_from: Option<String>,
    /// Inclusive upper bound on the school day, `YYYY-MM-DD`.
    pub due_to: Option<String>,
    pub limit: Option<i64>,
}

/// Builds the `WHERE` clauses for a [`Filter`].
fn push_filter<'a>(query: &mut QueryBuilder<'a, Sqlite>, filter: &'a Filter) {
    // `QueryBuilder` never inserts whitespace, and the query text always starts
    // with `WHERE 1 = 1`, so every clause can use the same `AND` form.
    if let Some(class_id) = filter.class_id {
        query.push(" AND class_id = ").push_bind(class_id);
    }
    if !filter.class_ids.is_empty() {
        query.push(" AND class_id IN (");
        let mut separated = query.separated(", ");
        for class_id in &filter.class_ids {
            separated.push_bind(class_id);
        }
        separated.push_unseparated(")");
    }
    if let Some(subject_id) = filter.subject_id {
        query.push(" AND subject_id = ").push_bind(subject_id);
    }
    if let Some(author_id) = filter.author_id {
        query.push(" AND author_id = ").push_bind(author_id);
    }
    if let Some(due_from) = &filter.due_from {
        query.push(" AND due_date >= ").push_bind(due_from);
    }
    if let Some(due_to) = &filter.due_to {
        query.push(" AND due_date <= ").push_bind(due_to);
    }
}

/// Inserts one entry.
///
/// Generic over the executor so the same statement runs against a pool or inside
/// a transaction: creating an entry with attachments writes more than one row,
/// and that write must be atomic, so it cannot be split into two functions with
/// the same SQL in each.
pub async fn create<'q, E>(executor: E, new: &NewHomework) -> Result<Homework, sqlx::Error>
where
    E: Executor<'q, Database = Sqlite>,
{
    let now = now_ms();
    sqlx::query_as::<_, Homework>(&format!(
        "INSERT INTO homework
            (class_id, subject_id, author_id, due_date, homework_text, classwork_text,
             created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         RETURNING {COLUMNS}"
    ))
    .bind(new.class_id)
    .bind(new.subject_id)
    .bind(new.author_id)
    .bind(&new.due_date)
    .bind(&new.homework_text)
    .bind(&new.classwork_text)
    .bind(now)
    .fetch_one(executor)
    .await
}

pub async fn find_by_id(pool: &SqlitePool, id: i64) -> Result<Option<Homework>, sqlx::Error> {
    sqlx::query_as::<_, Homework>(&format!("SELECT {COLUMNS} FROM homework WHERE id = ?1"))
        .bind(id)
        .fetch_optional(pool)
        .await
}

/// Fetches one entry, but only if it belongs to `class_id`.
///
/// This is the student-visibility boundary, and it lives in the query rather than in a
/// check after the fetch: an entry the caller may not see never crosses out of SQLite.
/// Returns `None` for both "no such id" and "not your class", so the caller cannot tell
/// the two apart and use this to probe for other classes' homework.
pub async fn find_by_id_in_class(
    pool: &SqlitePool,
    class_id: i64,
    id: i64,
) -> Result<Option<Homework>, sqlx::Error> {
    sqlx::query_as::<_, Homework>(&format!(
        "SELECT {COLUMNS} FROM homework WHERE id = ?1 AND class_id = ?2"
    ))
    .bind(id)
    .bind(class_id)
    .fetch_optional(pool)
    .await
}

/// Entries newest school day first, which is the order every student view wants.
pub async fn list(pool: &SqlitePool, filter: &Filter) -> Result<Vec<Homework>, sqlx::Error> {
    let mut query =
        QueryBuilder::<Sqlite>::new(format!("SELECT {COLUMNS} FROM homework WHERE 1 = 1"));
    push_filter(&mut query, filter);
    query.push(" ORDER BY due_date DESC, id DESC");
    if let Some(limit) = filter.limit {
        query.push(" LIMIT ").push_bind(limit);
    }
    query.build_query_as::<Homework>().fetch_all(pool).await
}

/// Replaces the mutable fields of an entry. A teacher editing an entry supplies
/// all of them, so there is no ambiguity about what a missing argument means and
/// a cleared `classwork_text` can be written as `None` instead of being
/// swallowed by a `COALESCE`.
///
/// Generic over the executor so it can run inside a transaction alongside
/// [`set_class`], which is what a PATCH that moves an entry needs.
pub async fn update<'q, E>(
    executor: E,
    id: i64,
    subject_id: i64,
    due_date: &str,
    homework_text: Option<&str>,
    classwork_text: Option<&str>,
) -> Result<Option<Homework>, sqlx::Error>
where
    E: Executor<'q, Database = Sqlite>,
{
    let now = now_ms();
    sqlx::query_as::<_, Homework>(&format!(
        "UPDATE homework
            SET subject_id     = ?2,
                due_date       = ?3,
                homework_text  = ?4,
                classwork_text = ?5,
                updated_at     = ?6
          WHERE id = ?1
      RETURNING {COLUMNS}"
    ))
    .bind(id)
    .bind(subject_id)
    .bind(due_date)
    .bind(homework_text)
    .bind(classwork_text)
    .bind(now)
    .fetch_optional(executor)
    .await
}

/// Moves an entry to another class.
///
/// Separate from [`update`] because that one takes its whole argument list
/// positionally and is called by the frozen R2 data-layer tests; widening it would
/// mean editing callers that phase 5 has no business touching. Both statements
/// write `updated_at` the same way, so a move is as visible in the timeline as an
/// edit.
pub async fn set_class<'q, E>(
    executor: E,
    id: i64,
    class_id: i64,
) -> Result<Option<Homework>, sqlx::Error>
where
    E: Executor<'q, Database = Sqlite>,
{
    sqlx::query_as::<_, Homework>(&format!(
        "UPDATE homework SET class_id = ?2, updated_at = ?3 WHERE id = ?1 RETURNING {COLUMNS}"
    ))
    .bind(id)
    .bind(class_id)
    .bind(now_ms())
    .fetch_optional(executor)
    .await
}

/// Cascades to the entry's attachments, notes and progress, so no metadata can
/// outlive the entry it describes. Callers must not delete dependents by hand:
/// the R2 `ON DELETE CASCADE` rules are the single definition of what an entry
/// owns, and a second copy of that list in application code would drift from
/// them. The files those attachments point at live outside the database; a
/// storage layer added later reads
/// [`crate::repositories::attachments::list_by_homework`] *before* calling this
/// so it can remove the bytes too.
pub async fn delete(pool: &SqlitePool, id: i64) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM homework WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}
