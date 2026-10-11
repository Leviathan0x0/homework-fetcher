use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Metadata for a file attached to a homework entry.
///
/// Only the metadata lives in SQLite. `storage_key` is resolved by whichever
/// storage backend a later phase installs, so the database never grows with
/// file size and deleting an entry can never strand bytes in SQLite.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Attachment {
    pub id: i64,
    pub homework_id: i64,
    /// Name as uploaded, shown to the user.
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: i64,
    /// Relative path or object-storage key; not necessarily a resolvable path
    /// on this machine.
    pub storage_key: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewAttachment {
    pub homework_id: i64,
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub storage_key: String,
}
