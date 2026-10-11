//! Data access, one module per entity.
//!
//! Every function takes the `&SqlitePool` it needs, so nothing depends on
//! global mutable state and a caller can point the same repository at a
//! production pool or a throwaway test database.
//!
//! Queries are runtime `sqlx::query` / `query_as` against `FromRow` structs.
//! Typed rows still catch column/type mistakes when a result is decoded, and
//! skipping the `query!` macros avoids needing a live `DATABASE_URL` and a
//! `.sqlx` cache just to compile.

pub mod account_events;
pub mod attachments;
pub mod classes;
pub mod credentials;
pub mod edusecure;
pub mod edusecure_credentials;
pub mod homework;
pub mod notes;
pub mod progress;
pub mod sessions;
pub mod setup_tokens;
pub mod subjects;
pub mod teacher_classes;
pub mod users;
