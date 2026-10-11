//! Domain models, one module per entity.
//!
//! Each entity has a row struct (what the database holds, `FromRow` + `serde`)
//! and a `New*` input struct (what a caller supplies when creating it). There is
//! deliberately no third layer of response DTOs yet: nothing serialises these
//! over HTTP until a later phase, and a DTO layer with no consumer is just a
//! second place to forget a field.

pub mod attachment;
pub mod class;
pub mod edusecure;
pub mod homework;
pub mod note;
pub mod progress;
pub mod session;
pub mod subject;
pub mod user;

pub use attachment::{Attachment, NewAttachment};
pub use class::{Class, NewClass};
pub use edusecure::{EduSecurePublication, PublicationStatus};
pub use homework::{Homework, NewHomework};
pub use note::{NewNote, Note};
pub use progress::HomeworkProgress;
pub use session::Session;
pub use subject::{NewSubject, Subject};
pub use user::{NewUser, Role, User};
