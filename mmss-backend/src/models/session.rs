use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// A live, revocable login grant.
///
/// `token_hash` is a digest of the cookie value, so a leaked database cannot be
/// replayed as a set of valid cookies, and `id` is the separate public identifier a
/// client uses to *name* a session when revoking it. Neither is a credential on its
/// own: revoking always requires the caller's own session as well.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Session {
    pub token_hash: String,
    pub user_id: i64,
    pub created_at: i64,
    pub expires_at: i64,
    /// Added in R13. `None` only on a row written before the migration that has not
    /// been backfilled; nothing this process creates is ever missing one.
    pub id: Option<String>,
    /// Added in R13, and the basis of the idle timeout as well as the "last active"
    /// column in the device list.
    pub last_used_at: Option<i64>,
    /// Added in R13. Best effort, never an identity. See [`crate::devices`].
    pub device_label: Option<String>,
}

impl Session {
    /// Epoch milliseconds. Callers that hold a session already know the wall clock
    /// they read it at, so the test suite can age a session without sleeping.
    pub fn is_expired_at(&self, now: i64) -> bool {
        now >= self.expires_at
    }

    /// Whether the session has been unused for longer than `idle_ms`.
    ///
    /// Falls back to `created_at` when `last_used_at` is missing, which is the
    /// conservative direction: an un-backfilled old session is treated as idle from
    /// the day it was created rather than as infinitely fresh.
    pub fn is_idle_at(&self, now: i64, idle_ms: i64) -> bool {
        let last = self.last_used_at.unwrap_or(self.created_at);
        now.saturating_sub(last) >= idle_ms
    }

    /// When this session was last used, for display. Same fallback as [`Self::is_idle_at`].
    pub fn last_used(&self) -> i64 {
        self.last_used_at.unwrap_or(self.created_at)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> Session {
        Session {
            token_hash: "digest".into(),
            user_id: 1,
            created_at: 1_000,
            expires_at: 100_000,
            id: Some("id".into()),
            last_used_at: Some(1_000),
            device_label: Some("Chrome on Linux".into()),
        }
    }

    #[test]
    fn expiry_is_absolute_and_idleness_is_relative_to_last_use() {
        let mut session = session();
        assert!(!session.is_expired_at(99_999));
        assert!(session.is_expired_at(100_000));

        // Absolute expiry says nothing about idleness: a session can be well within
        // its lifetime and still have been idle for most of it.
        assert!(!session.is_idle_at(5_000, 10_000));
        assert!(session.is_idle_at(11_000, 10_000));

        // Using the session resets the idle clock without moving the absolute one.
        session.last_used_at = Some(11_000);
        assert!(!session.is_idle_at(15_000, 10_000));
        assert!(session.is_idle_at(21_000, 10_000));
        assert!(!session.is_expired_at(99_000));
    }

    #[test]
    fn a_row_with_no_recorded_activity_is_treated_as_idle_from_its_creation() {
        // The conservative direction: never treat missing data as "fresher than
        // possible", which would be an unbounded session.
        let mut session = session();
        session.last_used_at = None;
        assert_eq!(session.last_used(), 1_000);
        assert!(session.is_idle_at(1_000 + 10_000, 10_000));
    }
}
