use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// A school account.
///
/// The internal key is an integer rowid; the school's own identifier lives in
/// [`User::school_id`] as a separate `UNIQUE` column, so the school can
/// renumber without a primary-key migration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: i64,
    pub school_id: String,
    pub display_name: Option<String>,
    pub role: Role,
    /// `None` for accounts with genuinely no class, such as staff and admin.
    pub class_id: Option<i64>,
    /// R12. `false` is a deactivated account: it cannot sign in, and any session it
    /// held stops working on its next request. The row, and everything the student owns
    /// through the cascading foreign keys, is kept -- deactivating is not deleting.
    ///
    /// Read from SQLite's `INTEGER NOT NULL DEFAULT 1` by sqlx's bool decoding, so the
    /// `CHECK (is_active IN (0, 1))` in the migration is what keeps a value that is not
    /// 0 or 1 out of the column in the first place.
    pub is_active: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl User {
    /// Whether this account may authenticate and may hold a session.
    ///
    /// Named rather than inlined at the call sites because the two places that must ask
    /// -- login and session validation -- are exactly the pair that must not disagree.
    pub fn is_active(&self) -> bool {
        self.is_active
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewUser {
    pub school_id: String,
    pub display_name: Option<String>,
    pub role: Role,
    pub class_id: Option<i64>,
}

impl NewUser {
    /// A student in `class_id`, which is the common case.
    pub fn student(school_id: impl Into<String>, class_id: i64) -> Self {
        Self {
            school_id: school_id.into(),
            display_name: None,
            role: Role::Student,
            class_id: Some(class_id),
        }
    }
}

/// Whether a user is a class-level teacher is a property of their teaching
/// duties, not of their account, so it is not a role here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Student,
    Teacher,
    Admin,
}
