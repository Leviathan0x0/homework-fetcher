//! The JSON shapes the API returns.
//!
//! Deliberately separate from the database rows in `models::`. A row is how SQLite
//! stores something; a view is what a client is allowed to know about it. Keeping them
//! apart means a schema change cannot silently become an API change, and it is where
//! the legacy field names that the shipped frontend reads are documented.
//!
//! All views are camelCase, matching the existing client.

use serde::Serialize;

use crate::models::{Attachment, Homework, Note, Role, Subject, User};
use crate::validate::CalendarDate;

/// A subject, as a student sees it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectView {
    pub id: i64,
    pub name: String,
}

/// The author of an entry, when there is one.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorView {
    pub id: i64,
    pub display_name: Option<String>,
}

impl From<&Subject> for SubjectView {
    fn from(subject: &Subject) -> Self {
        Self {
            id: subject.id,
            name: subject.name.clone(),
        }
    }
}

impl From<&User> for AuthorView {
    fn from(user: &User) -> Self {
        Self {
            id: user.id,
            display_name: user.display_name.clone(),
        }
    }
}

/// Attachment metadata. No `url`: file bytes are not served by this API, and a URL
/// that returned JSON would be worse than no URL at all. See `STUDENT_API_AUDIT.md`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentView {
    pub id: i64,
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: i64,
    /// Where the bytes live, for the future storage layer. Never a filesystem path
    /// this process assumes it can open.
    pub storage_key: String,
    /// Epoch milliseconds, as stored.
    pub created_at: i64,
}

impl From<&Attachment> for AttachmentView {
    fn from(attachment: &Attachment) -> Self {
        Self {
            id: attachment.id,
            filename: attachment.filename.clone(),
            mime_type: attachment.mime_type.clone(),
            size_bytes: attachment.size_bytes,
            storage_key: attachment.storage_key.clone(),
            created_at: attachment.created_at,
        }
    }
}

/// One diary/assignment entry as a student receives it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeworkView {
    pub id: i64,
    /// ISO `YYYY-MM-DD`. The client already parses this for sorting and filtering.
    pub date: String,
    /// The label the homework card renders. The card prints `date` raw, so shipping ISO
    /// alone would change what students see.
    pub display_date: String,
    /// Subject name, as a string, because every view matches on the string. `subject_id`
    /// is here for filtering and for the future teacher API.
    pub subject: String,
    pub subject_id: i64,
    pub class_id: i64,
    pub homework: Option<String>,
    /// Separate from `homework` since R2 split the merged diary blob in two.
    pub classwork: Option<String>,
    pub author: Option<AuthorView>,
    pub attachments: Vec<AttachmentView>,
    /// The single legacy attachment slot the current client tests with
    /// `Boolean(item.attachment)`. Always null until a storage layer exists.
    pub attachment: Option<String>,
    /// The signed-in student's own state for this entry.
    pub completed: bool,
    /// The signed-in student's own private note on this entry.
    pub note: Option<String>,
    /// ISO-8601 UTC, which is what the old API sent and what the client passes through.
    pub updated_at: String,
}

/// Everything the homework feed needs, gathered so a student-facing row can be built
/// without a query per entry: the feed is fetched in one statement and then enriched
/// with five more, instead of three per card.
#[derive(Debug, Default)]
pub struct HomeworkContext {
    pub subject_names: std::collections::HashMap<i64, String>,
    pub authors: std::collections::HashMap<i64, Option<AuthorView>>,
    pub attachments: std::collections::HashMap<i64, Vec<AttachmentView>>,
    pub completed: std::collections::HashSet<i64>,
    pub notes: std::collections::HashMap<i64, String>,
    /// Class names, filled in by the teacher listing only. A student always sees one
    /// class and already knows its name, so the student path leaves this empty.
    pub class_names: std::collections::HashMap<i64, String>,
}

/// Builds a student view of one entry.
pub fn homework_view(entry: &Homework, context: &HomeworkContext) -> HomeworkView {
    let date = CalendarDate::parse(&entry.due_date);
    HomeworkView {
        id: entry.id,
        date: entry.due_date.clone(),
        display_date: date.map_or_else(|| entry.due_date.clone(), |d| d.to_display()),
        subject: context
            .subject_names
            .get(&entry.subject_id)
            .cloned()
            .unwrap_or_default(),
        subject_id: entry.subject_id,
        class_id: entry.class_id,
        homework: entry.homework_text.clone(),
        classwork: entry.classwork_text.clone(),
        author: entry
            .author_id
            .and_then(|id| context.authors.get(&id).cloned().flatten()),
        attachments: context
            .attachments
            .get(&entry.id)
            .cloned()
            .unwrap_or_default(),
        // Null rather than a made-up URL: the client's attachment views key off this
        // field, and an entry with no readable bytes has no attachment to show.
        attachment: None,
        completed: context.completed.contains(&entry.id),
        note: context.notes.get(&entry.id).cloned(),
        updated_at: to_iso8601(entry.updated_at),
    }
}

/// A note as its owner sees it. `homeworkId: null` is a personal note, which is a
/// different thing from a note on an entry and stays distinguishable.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteView {
    pub id: i64,
    pub homework_id: Option<i64>,
    pub body: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<&Note> for NoteView {
    fn from(note: &Note) -> Self {
        Self {
            id: note.id,
            homework_id: note.homework_id,
            body: note.body.clone(),
            created_at: note.created_at,
            updated_at: note.updated_at,
        }
    }
}

/// Request body for creating a personal note.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNoteBody {
    pub body: String,
}

/// Request body for creating or replacing a note on one entry.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteBody {
    pub body: String,
}

/// Request body for the legacy `PATCH /api/homework/:id/note`, whose client sends
/// `note` and treats `null` as "clear it".
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyNoteBody {
    pub note: Option<String>,
}

/// Request body for marking an entry done or not done.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionBody {
    pub completed: bool,
}

/// One student's completion state for one entry.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressView {
    pub homework_id: i64,
    pub completed: bool,
    pub updated_at: i64,
}

/// The homework feed envelope. `count` and `homework` are the names the current client
/// reads; the trailing flags are present because the client destructures them, and are
/// `false` here since no school portal is wired up yet.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeworkFeed {
    pub count: usize,
    pub homework: Vec<HomeworkView>,
    /// No EduSecure session exists in this architecture, so this is always false.
    pub school_session_expired: bool,
    pub is_stale: bool,
}

impl HomeworkFeed {
    pub fn new(homework: Vec<HomeworkView>) -> Self {
        Self {
            count: homework.len(),
            homework,
            school_session_expired: false,
            is_stale: false,
        }
    }
}

// ------------------------------------------------------------ teacher API

/// One entry as a teacher sees it: the authoritative record, with the same fields a
/// student reads and no per-student state.
///
/// Nullability, stated once here rather than left to be inferred:
///   * `homework` / `classwork` are `null` when that half is absent. An empty
///     string is never a valid substitute -- the R2 `CHECK` forbids it and the
///     service trims and rejects blanks -- so "absent" has exactly one
///     representation.
///   * `author` is `null` when `homework.author_id` is null, which is the normal
///     state of an entry imported from a school portal and also what a deleted
///     teacher's entry becomes (`ON DELETE SET NULL`).
///   * `className` / `subject` fall back to an empty string if the referenced row
///     has gone missing; the ids stay authoritative and the FKs make it
///     unreachable in practice.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeacherHomeworkView {
    pub id: i64,
    pub class_id: i64,
    pub class_name: String,
    pub subject_id: i64,
    pub subject: String,
    /// ISO `YYYY-MM-DD`, guaranteed calendar-real by `validate::CalendarDate`.
    pub due_date: String,
    pub homework: Option<String>,
    pub classwork: Option<String>,
    pub author: Option<AuthorView>,
    pub attachments: Vec<AttachmentView>,
    /// Epoch milliseconds. The teacher API reports the stored value rather than
    /// an ISO string: nothing about the teacher frontend needs a rendered date,
    /// and one format means one thing to compare. The student view's ISO
    /// `updatedAt` exists only because the shipped client already parses it.
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn teacher_homework_view(entry: &Homework, context: &HomeworkContext) -> TeacherHomeworkView {
    TeacherHomeworkView {
        id: entry.id,
        class_id: entry.class_id,
        class_name: context
            .class_names
            .get(&entry.class_id)
            .cloned()
            .unwrap_or_default(),
        subject_id: entry.subject_id,
        subject: context
            .subject_names
            .get(&entry.subject_id)
            .cloned()
            .unwrap_or_default(),
        due_date: entry.due_date.clone(),
        homework: entry.homework_text.clone(),
        classwork: entry.classwork_text.clone(),
        author: entry
            .author_id
            .and_then(|id| context.authors.get(&id).cloned().flatten()),
        attachments: context
            .attachments
            .get(&entry.id)
            .cloned()
            .unwrap_or_default(),
        created_at: entry.created_at,
        updated_at: entry.updated_at,
    }
}

/// The teacher list envelope. `count` and `items` rather than the student feed's
/// `count`/`homework`: this is a management list, not a class feed, and no
/// existing client reads it, so there is no legacy name to keep.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeacherHomeworkList {
    pub count: usize,
    pub items: Vec<TeacherHomeworkView>,
}

impl TeacherHomeworkList {
    pub fn new(items: Vec<TeacherHomeworkView>) -> Self {
        Self {
            count: items.len(),
            items,
        }
    }
}

/// Attachment metadata supplied on create.
///
/// Metadata only. There is no upload endpoint in this phase and no bytes anywhere:
/// `storageKey` is the key a future storage service resolves, and this process
/// neither reads nor writes it.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInput {
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub storage_key: String,
}

/// `POST /api/teacher/homework`
///
/// Structured fields only. There is deliberately no free-form "diary" blob and no
/// parser for one: homework and classwork are separate values, and a combined blob
/// would have to be guessed apart again.
///
/// `authorId` and `teacherId` are not fields. `author_id` is always the
/// authenticated user, so a forged author is not merely ignored -- it is
/// unrepresentable.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateHomeworkBody {
    pub class_id: i64,
    pub subject_id: i64,
    pub due_date: String,
    #[serde(default)]
    pub homework: Option<String>,
    #[serde(default)]
    pub classwork: Option<String>,
    #[serde(default)]
    pub attachments: Vec<AttachmentInput>,
}

/// `PATCH /api/teacher/homework/{id}`
///
/// Field semantics, uniformly:
///   * omitted  -> unchanged
///   * `null`    -> clear the field
///   * a value   -> validated and written
///
/// `null` therefore means *clear*, everywhere, and never "ignore". The
/// alternative -- treating `null` as "leave alone" -- makes a client that means
/// to clear something fail silently, which is the worse of the two mistakes.
///
/// The double `Option` is what distinguishes the three cases. Serde maps a JSON
/// `null` to `None` for an `Option<T>` field, so `Option<T>` alone cannot tell
/// "cleared" from "absent"; `Option<Option<T>>` with `deserialize_with` can. See
/// [`double_option`].
#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateHomeworkBody {
    /// The class this entry is moved to. Changing it re-checks that the caller
    /// teaches the destination: `classId` names a target resource, never a
    /// permission.
    #[serde(default, deserialize_with = "double_option")]
    pub class_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub subject_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub due_date: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub homework: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub classwork: Option<Option<String>>,
}

/// Makes `Option<Option<T>>` mean three things instead of two: `None` when the key
/// is absent, `Some(None)` when it is `null`, and `Some(Some(v))` otherwise.
///
/// Serde's own `Option<T>` collapses "absent" and "null" into one value, which is
/// right for a field with no meaningful null and wrong for a partial update.
fn double_option<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    serde::Deserialize::deserialize(deserializer).map(Some)
}

/// The publication state of one entry, as the teacher/admin tooling sees it.
///
/// Integration state, never domain state: nothing here can change the homework it refers
/// to. `lastError` is the portal's failure reason, already stripped of anything internal.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicationView {
    pub homework_id: i64,
    pub status: crate::models::PublicationStatus,
    /// The portal's identifier, when it minted one.
    pub external_id: Option<String>,
    pub last_error: Option<String>,
    pub attempts: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<&crate::models::EduSecurePublication> for PublicationView {
    fn from(publication: &crate::models::EduSecurePublication) -> Self {
        Self {
            homework_id: publication.homework_id,
            status: publication.state(),
            external_id: publication.external_id.clone(),
            last_error: publication.last_error.clone(),
            attempts: publication.attempts,
            created_at: publication.created_at,
            updated_at: publication.updated_at,
        }
    }
}

/// Whether the integration is usable at all.
///
/// Deliberately reports only *whether* it is configured. It never echoes the base URL,
/// the username or the password -- a status endpoint is the wrong place to become a
/// credential disclosure, and the old system already had `testTeacherDiagnostics` to
/// avoid leaking a secret through a health check.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EduSecureStatusView {
    pub enabled: bool,
}

/// The outcome of importing a portal page.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    /// Rows written.
    pub imported: usize,
    /// Rows already present, so re-importing a page is safe.
    pub skipped: usize,
}

/// `POST /api/edusecure/import`
///
/// `classId` and `subjectId` are the only structural choices the caller makes; the page
/// supplies the dates and text. The whole import is one transaction, so a rejected page
/// leaves nothing half-written.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBody {
    pub class_id: i64,
    pub subject_id: i64,
    /// The announcement page, as fetched by whoever has portal access.
    pub html: String,
}

/// Whether the AI layer is usable, and which implementation is behind it.
///
/// Reports the provider *name* and a boolean. Never the endpoint, the model credential, or
/// anything derived from homework content -- an assistive layer's status must not become a
/// way to read the deployment's secrets.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatusView {
    pub enabled: bool,
    pub provider: String,
}

/// A classification suggestion. Advisory: nothing in the API writes it anywhere.
///
/// `subject` is null when the model declined to name one. A missing answer is reported as
/// absent rather than guessed, because a plausible wrong subject is worse than none.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationView {
    pub subject: Option<String>,
    /// Whether the text already reads as well-formed homework. Retained from the old
    /// pipeline's classification, where it gated the formatter; now it is just a hint.
    pub is_formatted: bool,
}

impl From<crate::services::ai::ValidatedClassification> for ClassificationView {
    fn from(value: crate::services::ai::ValidatedClassification) -> Self {
        Self {
            subject: value.subject,
            is_formatted: value.is_formatted,
        }
    }
}

/// A safety verdict. Advisory in the same way: the caller decides, the server records
/// nothing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModerationView {
    pub flagged: bool,
    pub categories: Vec<String>,
}

impl From<crate::services::ai::ValidatedModeration> for ModerationView {
    fn from(value: crate::services::ai::ValidatedModeration) -> Self {
        Self {
            flagged: value.flagged,
            categories: value.categories,
        }
    }
}

/// `POST /api/ai/classify`
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassifyBody {
    pub text: String,
    /// Context for the model. Never stored, never authoritative.
    #[serde(default)]
    pub subject_hint: Option<String>,
}

/// `POST /api/ai/moderate`
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModerateBody {
    pub text: String,
}

/// Epoch milliseconds to ISO-8601 UTC, which is the string format the old API used.
pub fn to_iso8601(epoch_ms: i64) -> String {
    // Days-to-civil conversion, so no date library is needed for formatting. The R2
    // timestamp convention stays the single source of truth.
    let secs = epoch_ms.div_euclid(1000);
    let days = secs.div_euclid(86_400);
    let time_of_day = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        time_of_day / 3600,
        (time_of_day % 3600) / 60,
        time_of_day % 60,
        epoch_ms.rem_euclid(1000),
    )
}

/// Howard Hinnant's `civil_from_days`: days since 1970-01-01 to a proleptic Gregorian date.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m as u32, d as u32)
}

/// Whether a role may use the student API. Kept next to the views so the rule and the
/// route that uses it cannot drift.
pub fn is_student(role: Role) -> bool {
    role == Role::Student
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_millis_format_as_the_iso_the_client_expects() {
        assert_eq!(to_iso8601(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(to_iso8601(1_764_000_000_000), "2025-11-24T16:00:00.000Z");
        assert_eq!(to_iso8601(1_759_262_220_814), "2025-09-30T19:57:00.814Z");
        // A leap day, to catch an off-by-one in the civil conversion.
        assert_eq!(to_iso8601(1_709_164_800_000), "2024-02-29T00:00:00.000Z");
        // Sub-second precision is preserved.
        assert_eq!(to_iso8601(1_700_000_000_007), "2023-11-14T22:13:20.007Z");
    }

    #[test]
    fn iso_round_trips_through_the_calendar_date_parser() {
        for epoch_ms in [0_i64, 1_700_000_000_000, 1_764_000_000_123] {
            let iso = to_iso8601(epoch_ms);
            let head = iso.split('T').next().unwrap();
            assert!(CalendarDate::parse(head).is_some(), "{iso}");
        }
    }
}
