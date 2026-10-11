use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// What happened to one publication attempt chain for a local homework entry.
///
/// Deliberately a closed set: the migration stores it under a `CHECK`, so an unexpected
/// value is a bug rather than something a caller can invent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PublicationStatus {
    /// Recorded, not yet attempted.
    Pending,
    /// The portal accepted it.
    Published,
    /// The portal refused or could not be reached.
    Failed,
}

impl PublicationStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Published => "published",
            Self::Failed => "failed",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "pending" => Some(Self::Pending),
            "published" => Some(Self::Published),
            "failed" => Some(Self::Failed),
            _ => None,
        }
    }
}

/// The integration's record about one entry. Never authoritative over `Homework`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct EduSecurePublication {
    pub homework_id: i64,
    pub status: String,
    pub external_id: Option<String>,
    pub last_error: Option<String>,
    pub attempts: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl EduSecurePublication {
    /// The typed status, defaulting to `Pending` for a value the migration's `CHECK`
    /// should already have prevented.
    pub fn state(&self) -> PublicationStatus {
        PublicationStatus::parse(&self.status).unwrap_or(PublicationStatus::Pending)
    }
}
