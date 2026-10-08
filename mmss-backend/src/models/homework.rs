use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// One diary/assignment entry: a class, a subject, a school day, and the
/// homework text and classwork text belonging to that entry.
///
/// The two texts are separate columns rather than one merged body, because they
/// are separately written and separately displayed, but they share the entry's
/// subject, class, author and day.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Homework {
    pub id: i64,
    pub class_id: i64,
    pub subject_id: i64,
    /// The teacher who wrote the entry; `None` when there is no known author,
    /// which is the normal case for a diary entry imported from a portal.
    pub author_id: Option<i64>,
    /// School day, `YYYY-MM-DD`.
    pub due_date: String,
    pub homework_text: Option<String>,
    pub classwork_text: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewHomework {
    pub class_id: i64,
    pub subject_id: i64,
    pub author_id: Option<i64>,
    pub due_date: String,
    pub homework_text: Option<String>,
    pub classwork_text: Option<String>,
}
