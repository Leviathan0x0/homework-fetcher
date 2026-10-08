//! Business logic that sits above the repositories.
//!
//! A service owns a decision ("is this person who they say they are", "what may this
//! student see", "what does a signed-in request mean"); a repository owns SQL for one
//! entity. Handlers call services and repositories, never SQL.

pub mod accounts;
pub mod ai;
pub mod auth;
pub mod edusecure;
pub mod homework;
pub mod notes;
pub mod progress;
pub mod teacher_homework;
