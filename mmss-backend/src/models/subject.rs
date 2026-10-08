use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// A taught subject. The old system stored a free-text subject on every homework
/// row, including the pseudo-subject `"School Diary"`; here that is just another
/// subject row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Subject {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewSubject {
    pub name: String,
}

impl NewSubject {
    pub fn new(name: impl Into<String>) -> Self {
        Self { name: name.into() }
    }
}
