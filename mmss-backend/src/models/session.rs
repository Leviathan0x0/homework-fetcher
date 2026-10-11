use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// A live, revocable login grant.
///
/// `token_hash` is a digest of the cookie value, so a leaked database cannot be
/// replayed as a set of valid cookies.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Session {
    pub token_hash: String,
    pub user_id: i64,
    pub created_at: i64,
    pub expires_at: i64,
}

impl Session {
    /// Epoch milliseconds. Callers that hold a session already know the wall clock
    /// they read it at, so the test suite can age a session without sleeping.
    pub fn is_expired_at(&self, now: i64) -> bool {
        now >= self.expires_at
    }
}
