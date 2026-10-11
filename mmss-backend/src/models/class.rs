use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// A class/section, e.g. `9-F`. Homework and classwork both belong to one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Class {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewClass {
    pub name: String,
}

impl NewClass {
    pub fn new(name: impl Into<String>) -> Self {
        Self { name: name.into() }
    }
}
