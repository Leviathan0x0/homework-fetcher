use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// A note. Attached to one user and optionally to one homework entry, so both
/// "my private note on this entry" and "a note about me" are expressible.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Note {
    pub id: i64,
    pub user_id: i64,
    /// `None` for a note that is about the user rather than one entry.
    pub homework_id: Option<i64>,
    pub body: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewNote {
    pub user_id: i64,
    pub homework_id: Option<i64>,
    pub body: String,
}
