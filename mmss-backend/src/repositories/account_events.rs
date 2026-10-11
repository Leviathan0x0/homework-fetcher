//! The account lifecycle audit trail.
//!
//! Deactivating a student, setting a first password, changing a password: these are
//! consequential and mostly happen out of band, so without a record the only answer to
//! "why can this student not sign in" is a guess.
//!
//! Deliberately append-only and deliberately small. There is no update or delete, so
//! the trail cannot be edited after the fact by whoever performed the action.

use sqlx::SqlitePool;

use crate::clock::now_ms;

/// What happened to an account.
///
/// A closed set rather than a free string: an operator cannot invent a kind, which
/// keeps "what kinds of event exist" answerable without reading every row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventKind {
    Deactivated,
    Reactivated,
    /// A first password, set by the account holder using a setup token.
    PasswordSet,
    /// A password changed by its owner. There is no "reset" kind, because there is no
    /// unauthenticated reset to audit.
    PasswordChanged,
}

impl EventKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Deactivated => "deactivated",
            Self::Reactivated => "reactivated",
            Self::PasswordSet => "password_set",
            Self::PasswordChanged => "password_changed",
        }
    }
}

/// Appends one event.
///
/// `actor` is a school ID for something a signed-in person did, and [`CLI_ACTOR`] for an
/// operator action. It is never the target's own school ID by default -- that would make
/// "a student deactivated themselves" indistinguishable from "the office deactivated a
/// student" -- so the two are different values on purpose.
pub async fn record(
    pool: &SqlitePool,
    user_id: i64,
    kind: EventKind,
    actor: &str,
    detail: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO account_events (user_id, kind, actor, detail, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(user_id)
    .bind(kind.as_str())
    .bind(actor)
    .bind(detail)
    .bind(now_ms())
    .execute(pool)
    .await?;
    Ok(())
}

/// The actor recorded for an operator running the CLI.
///
/// A literal rather than `NULL`, so "nobody in particular" is never stored as if a
/// person's school ID had been lost, and so these rows are trivially filterable.
pub const CLI_ACTOR: &str = "cli";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_kind_has_a_stable_wire_name() {
        // Renaming one of these changes stored history, so the strings are part of the
        // schema's contract rather than an implementation detail.
        assert_eq!(EventKind::Deactivated.as_str(), "deactivated");
        assert_eq!(EventKind::Reactivated.as_str(), "reactivated");
        assert_eq!(EventKind::PasswordSet.as_str(), "password_set");
        assert_eq!(EventKind::PasswordChanged.as_str(), "password_changed");
    }
}
