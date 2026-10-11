//! Bulk account provisioning from a school-supplied roster file.
//!
//! # Why this exists
//!
//! R3–R10 authenticate against local argon2 credentials, and a fresh database contains
//! exactly one account: the administrator bootstrapped from `ADMIN_PASSWORD`. The old
//! system had no roster either -- `sessionService.findOrCreateUser` created a user row
//! the *first time somebody signed in*, so its `users` table was a record of who had
//! happened to log in, not who the school has. There is no bulk export in the old
//! codebase, and `EDUSECURE_AUDIT.md` records that the portal is a read-only parent
//! application with no roster endpoint to read.
//!
//! So the authoritative source is **the school**, and this module's job is to ingest a
//! roster they produce, deterministically, as many times as they like. See
//! `ACCOUNT_PROVISIONING.md` for what has to be handed over and why there is no
//! automated alternative.
//!
//! # Deliberate constraints
//!
//! * **No HTTP surface.** Provisioning is a CLI subcommand (`mmss-backend import`). A
//!   route that creates accounts is a route that creates accounts for whoever reaches
//!   it, and there is no request an unauthenticated caller could make that would be safe.
//! * **Never overwrites.** An existing account's role, class and display name are left
//!   exactly as they are, even when the roster disagrees. A roster is a statement about
//!   who *should* exist; demoting a real teacher because a spreadsheet lost a column is
//!   not a correction, it is an outage. Disagreements are reported as conflicts.
//! * **Passwords are hashed on the way in** and never reach the report, the log, or the
//!   database. See [`Secret`], whose `Debug` is redacted so a stray `{:?}` is safe.
//! * **EduSecure is not consulted.** After an import the accounts are entirely local;
//!   nothing in this module reads the portal, and nothing here becomes a runtime
//!   dependency of the portal.
//!
//! # Idempotency
//!
//! Every write is either keyed on an existing `UNIQUE` column (`classes.name`,
//! `subjects.name`, `users.school_id`) or is already `INSERT OR IGNORE`
//! (`teacher_classes`). Re-running a roster converges: the second run creates nothing and
//! reports everything as existing. That is also the recovery story -- an import killed
//! half way through is finished by running it again, which is why this module does not
//! need a transaction spanning thousands of rows.

use std::collections::HashMap;
use std::fmt;
use std::path::Path;

use anyhow::{bail, Context, Result};
use serde::Serialize;
use sqlx::SqlitePool;

use crate::config::Config;
use crate::models::{NewClass, NewSubject, NewUser, Role};
use crate::repositories::{classes, credentials, subjects, teacher_classes, users};
use crate::services::auth::{hash_password, AuthService};
use crate::state::AppState;

/// Longest accepted school ID. A roll number or a staff code; anything longer is a
/// spreadsheet accident, and it is a column other rows are keyed on.
const MAX_SCHOOL_ID_LEN: usize = 120;
/// Longest accepted class label, e.g. `"IX-F"`.
const MAX_CLASS_LEN: usize = 64;
/// Longest accepted subject name.
const MAX_SUBJECT_LEN: usize = 120;
/// Longest accepted display name.
const MAX_DISPLAY_NAME_LEN: usize = 200;
/// Longest accepted plaintext password. Argon2 is happy with anything, but a megabyte
/// "password" is a paste accident and is pure hashing cost for the operator.
const MAX_PASSWORD_LEN: usize = 1024;

/// A credential supplied by the roster.
///
/// `Debug` is implemented by hand and prints nothing. Every other type in this file
/// derives it, so deriving it here too would be the one place a password could leak
/// into a log line or a test failure message -- exactly the place it would be hardest to
/// notice.
#[derive(Clone, PartialEq, Eq)]
enum Secret {
    /// Plaintext from the roster's `password` column. Hashed immediately and dropped.
    Plain(String),
    /// An argon2id PHC string from the roster's `password_hash` column. Stored verbatim,
    /// so the roster file itself never contains a secret that could be replayed.
    Hash(String),
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(<redacted>)")
    }
}

/// One line of the roster, already validated into a shape the database understands.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Record {
    Class {
        name: String,
        line: usize,
    },
    Subject {
        name: String,
        line: usize,
    },
    User {
        school_id: String,
        display_name: Option<String>,
        role: Role,
        /// For a student, the class label from the row. For staff, `None`.
        section: Option<String>,
        secret: Option<Secret>,
        line: usize,
    },
    Assignment {
        teacher_school_id: String,
        class_name: String,
        line: usize,
    },
}

/// Tracks the physical line each CSV record starts on.
///
/// `csv` tracks lines correctly for a quoted field containing a newline but **not** for
/// blank lines: it skips them silently and keeps counting records, so `Position::line()`
/// under-reports by one for every blank line above the record. In a three-thousand-student
/// roster -- where a stray blank line from a spreadsheet is entirely ordinary -- that
/// makes every error message after it point at the wrong row, and a line number an
/// operator cannot use to find the row is worse than none.
///
/// Byte offsets *are* accurate, including across blank lines, so this counts the newlines
/// in the span the reader actually consumed. The one subtlety is that a blank line falls
/// inside the span of the record that follows it, so leading newlines are attributed to
/// the gap rather than to the record.
pub struct LineTracker {
    line: usize,
    cursor: usize,
}

impl LineTracker {
    /// Starts after a header occupying line 1, from where `reader` has read up to.
    pub fn after_header(reader: &csv::Reader<&[u8]>) -> Self {
        Self {
            line: 2,
            cursor: reader.position().byte() as usize,
        }
    }

    /// The line the record just read starts on. Must be called once per record, in order.
    pub fn next(&mut self, reader: &csv::Reader<&[u8]>, text: &str) -> usize {
        let end = reader.position().byte() as usize;
        let span = text.get(self.cursor..end).unwrap_or_default();
        self.cursor = end;

        let content = span.trim_start_matches(['\n', '\r']);
        let blank = span.len() - content.len();
        let start = self.line + count_newlines(&span[..blank]);
        self.line = start + count_newlines(content);
        start
    }
}

fn count_newlines(text: &str) -> usize {
    text.bytes().filter(|byte| *byte == b'\n').count()
}

/// One row the importer refused, and why.
///
/// `reason` is written to be safe to print. It never includes the offending value for a
/// `password` or `password_hash` field, only the field name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Issue {
    /// 1-based line number in the roster file, counting the header as line 1.
    pub line: usize,
    /// The record the row describes, for a human to find in the file.
    pub subject: String,
    pub reason: String,
}

impl Issue {
    fn new(line: usize, subject: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            line,
            subject: subject.into(),
            reason: reason.into(),
        }
    }
}

/// What one import did.
///
/// Counts only, plus the rows that were not applied. There is no per-user detail at this
/// level on purpose: a report for three thousand students is something an operator skims,
/// and anything longer is a place for a password to hide.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Report {
    pub classes_created: usize,
    pub classes_reused: usize,
    pub subjects_created: usize,
    pub subjects_reused: usize,
    pub users_created: usize,
    /// Accounts that were already there and were left untouched.
    pub users_existing: usize,
    pub credentials_set: usize,
    /// Supplied passwords that were *not* applied because the account already had one.
    pub credentials_preserved: usize,
    pub assignments_created: usize,
    pub assignments_existing: usize,
    /// Rows refused as malformed.
    pub rejected: Vec<Issue>,
    /// Rows that were well formed but would have overwritten an existing account, or
    /// collided with one on a case-insensitive match.
    pub conflicts: Vec<Issue>,
}

impl Report {
    /// Whether the roster applied cleanly. A non-empty `rejected` or `conflicts` is a
    /// failure the operator must look at, so the CLI exits non-zero.
    pub fn is_clean(&self) -> bool {
        self.rejected.is_empty() && self.conflicts.is_empty()
    }

    /// Records that were applied, for the summary line.
    pub fn applied(&self) -> usize {
        self.classes_created + self.subjects_created + self.users_created + self.assignments_created
    }
}

// ---------------------------------------------------------------- parsing

/// Parses and validates a whole roster, refusing the run if any row is malformed.
///
/// All-or-nothing on *parsing*: a roster of three thousand students with one typo in it
/// should not be half applied and then corrected by hand. The database work that
/// follows is where individual rows may be skipped, because by then "this row is wrong"
/// and "this row disagrees with reality" are different problems with different fixes.
fn parse(text: &str) -> Result<Vec<Record>> {
    let mut reader = csv::ReaderBuilder::new()
        // Leading/trailing whitespace in a spreadsheet cell is noise, not data.
        .trim(csv::Trim::All)
        // A roster legitimately omits trailing columns -- a school with no pre-hashed
        // credentials writes five columns, not seven -- and csv's default strictness
        // treats a short row as a malformed file. The header itself is still read by csv
        // (so `records()` skips it) and then interpreted here rather than through serde,
        // which is also what lets a typo'd column name be reported instead of silently
        // importing an empty column.
        .flexible(true)
        .from_reader(text.as_bytes());

    let columns = columns(reader.headers().context("the roster is empty")?)?;

    let mut records = Vec::new();
    let mut rejected = Vec::new();
    let mut row = csv::StringRecord::new();
    let mut lines = LineTracker::after_header(&reader);
    while reader
        .read_record(&mut row)
        .map_err(|error| anyhow::anyhow!("{error}"))?
    {
        let line = lines.next(&reader, text);
        // Fields past the header are an error only when they carry something. A spreadsheet that
        // exports a seven-column template and fills five produces rows with trailing
        // commas, and that is by far the most common way this file is written -- refusing
        // it would make the documented example fail. A field with a *value* in it has
        // nowhere to go, and that is what must be caught: it is how a name column quietly
        // stops importing.
        if let Some(extra) = row
            .iter()
            .skip(columns.width())
            .find(|field| !field.is_empty())
        {
            bail!(
                "line {line} has a value ({extra:?}) in a column the header does not \
                 declare; the columns are: {}",
                KNOWN_COLUMNS
                    .iter()
                    .map(|(name, _)| *name)
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
        let field = |name: Field| row.get(columns[name]).unwrap_or("").to_owned();
        let kind = field(Field::Kind);
        let id = field(Field::Id);
        let name = field(Field::Name);
        let role = field(Field::Role);
        let section = field(Field::Section);
        let password = field(Field::Password);
        let password_hash = field(Field::PasswordHash);

        match interpret(kind, id, name, role, section, password, password_hash, line) {
            Ok(record) => records.push(record),
            Err(issue) => rejected.push(issue),
        }
    }

    if !rejected.is_empty() {
        let detail = rejected
            .iter()
            .map(|issue| format!("  line {}: {}", issue.line, issue.reason))
            .collect::<Vec<_>>()
            .join("\n");
        bail!(
            "{} of the roster's rows could not be read. Nothing was imported.\n{detail}",
            rejected.len()
        );
    }
    Ok(records)
}

/// The columns a roster may declare, in the order they are documented.
///
/// A missing column is not an error -- a school that has no pre-hashed credentials simply
/// does not write `password_hash` -- but a *mistyped* one is, because the alternative is
/// a whole column of names importing as blank and nothing saying so.
const KNOWN_COLUMNS: [(&str, Field); 7] = [
    ("kind", Field::Kind),
    ("id", Field::Id),
    ("name", Field::Name),
    ("role", Field::Role),
    ("section", Field::Section),
    ("password", Field::Password),
    ("password_hash", Field::PasswordHash),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Field {
    Kind,
    Id,
    Name,
    Role,
    Section,
    Password,
    PasswordHash,
}

/// Where each known column sits in the file.
struct Columns {
    positions: [usize; 7],
}

impl Columns {
    /// The index one past the last *declared* column. Absent columns sit at `usize::MAX`
    /// as a sentinel, so they are filtered out rather than taken as the maximum.
    fn width(&self) -> usize {
        self.positions
            .iter()
            .copied()
            .filter(|index| *index != usize::MAX)
            .max()
            .unwrap_or(0)
            + 1
    }
}

impl std::ops::Index<Field> for Columns {
    type Output = usize;

    fn index(&self, field: Field) -> &usize {
        let slot = KNOWN_COLUMNS
            .iter()
            .position(|(_, candidate)| *candidate == field)
            .expect("every field appears in KNOWN_COLUMNS");
        &self.positions[slot]
    }
}

/// Maps the header row onto column positions.
///
/// `kind` is the only required column: without it a row cannot say what it is, and every
/// other field is interpretable only in the context of `kind`.
fn columns(header: &csv::StringRecord) -> Result<Columns> {
    let mut positions = [usize::MAX; 7];
    for (index, name) in header.iter().enumerate() {
        let name = name.trim();
        match KNOWN_COLUMNS.iter().find(|(known, _)| *known == name) {
            Some((_, field)) => {
                let slot = KNOWN_COLUMNS
                    .iter()
                    .position(|(_, candidate)| candidate == field)
                    .unwrap();
                if positions[slot] != usize::MAX {
                    bail!("the header declares {name:?} twice");
                }
                positions[slot] = index;
            }
            None if name.is_empty() => {}
            None => bail!(
                "unknown column {name:?} in the header. The columns are: {}",
                KNOWN_COLUMNS
                    .iter()
                    .map(|(name, _)| *name)
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        }
    }
    let kind_slot = KNOWN_COLUMNS
        .iter()
        .position(|(_, field)| *field == Field::Kind)
        .unwrap();
    if positions[kind_slot] == usize::MAX {
        bail!("the header must declare a `kind` column");
    }
    Ok(Columns { positions })
}

/// Turns one parsed row into a record, or explains why it cannot be one.
#[allow(clippy::too_many_arguments)]
fn interpret(
    kind: String,
    id: String,
    name: String,
    role: String,
    section: String,
    password: String,
    password_hash: String,
    line: usize,
) -> Result<Record, Issue> {
    match kind.to_ascii_lowercase().as_str() {
        "class" => {
            let name = bounded(&id, "id", MAX_CLASS_LEN, line)?;
            Ok(Record::Class { name, line })
        }
        "subject" => {
            let name = bounded(&id, "id", MAX_SUBJECT_LEN, line)?;
            Ok(Record::Subject { name, line })
        }
        "user" => {
            let school_id = school_id(&id, line)?;
            let role = parse_role(&role, line)?;
            let display_name = optional(&name, MAX_DISPLAY_NAME_LEN, "name", line)?;
            let section = optional(&section, MAX_CLASS_LEN, "section", line)?;

            // A class on a staff row would put a teacher or administrator inside a
            // section, which `users.class_id` is documented not to mean: staff have no
            // class and their duties live in `teacher_classes`. Silently ignoring the
            // column would import a roster the school did not write.
            if role != Role::Student && section.is_some() {
                return Err(Issue::new(
                    line,
                    &school_id,
                    format!(
                        "a {:?} must not name a section (staff have no class); \
                         use an `assignment` row for teaching duties",
                        role
                    ),
                ));
            }
            // The mirror case: a student with no section lands on an empty feed with no
            // explanation anywhere, which is worse than a refused roster.
            if role == Role::Student && section.is_none() {
                return Err(Issue::new(
                    line,
                    &school_id,
                    "a student must name a section",
                ));
            }

            Ok(Record::User {
                school_id,
                display_name,
                role,
                section,
                secret: secret(&password, &password_hash, line)?,
                line,
            })
        }
        "assignment" => {
            let teacher_school_id = school_id(&id, line)?;
            let class_name = bounded(&section, "section", MAX_CLASS_LEN, line)?;
            if !password.is_empty() || !password_hash.is_empty() {
                return Err(Issue::new(
                    line,
                    &teacher_school_id,
                    "an `assignment` row must not carry a password",
                ));
            }
            Ok(Record::Assignment {
                teacher_school_id,
                class_name,
                line,
            })
        }
        other => Err(Issue::new(
            line,
            if id.is_empty() { other } else { &id },
            format!("unknown kind {other:?}; expected class, subject, user or assignment"),
        )),
    }
}

/// A school ID, normalised exactly the way a login would normalise it.
///
/// `AuthService::normalize_school_id` strips the school email domain, so a roster that
/// lists `2026001@manavmangalschool.com` produces the same stored ID as one that lists
/// the roll number alone. Normalising here rather than at login is what keeps a roster
/// and a login agreeing about who a person is.
fn school_id(raw: &str, line: usize) -> Result<String, Issue> {
    let id = AuthService::normalize_school_id(raw);
    if id.is_empty() {
        return Err(Issue::new(line, "<blank>", "`id` is required"));
    }
    if id.chars().count() > MAX_SCHOOL_ID_LEN {
        return Err(Issue::new(
            line,
            &id[..id.len().min(32)],
            format!("`id` must be at most {MAX_SCHOOL_ID_LEN} characters"),
        ));
    }
    // A control character here would end up in a cookie value and a log line. Refused
    // rather than stripped: the roster is wrong and the operator should see it.
    if id.chars().any(char::is_control) {
        return Err(Issue::new(
            line,
            "<unprintable>",
            "`id` must not contain control characters",
        ));
    }
    Ok(id)
}

fn parse_role(raw: &str, line: usize) -> Result<Role, Issue> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "" | "student" => Ok(Role::Student),
        "teacher" => Ok(Role::Teacher),
        "admin" => Ok(Role::Admin),
        other => Err(Issue::new(
            line,
            other,
            format!("unknown role {other:?}; expected student, teacher or admin"),
        )),
    }
}

fn bounded(raw: &str, field: &str, max: usize, line: usize) -> Result<String, Issue> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(Issue::new(
            line,
            "<blank>",
            format!("`{field}` is required"),
        ));
    }
    if trimmed.chars().count() > max {
        return Err(Issue::new(
            line,
            &trimmed[..trimmed.len().min(32)],
            format!("`{field}` must be at most {max} characters"),
        ));
    }
    Ok(trimmed.to_owned())
}

/// A field that may legitimately be absent, normalised to `None` when it is blank.
fn optional(raw: &str, max: usize, field: &str, line: usize) -> Result<Option<String>, Issue> {
    match bounded(raw, field, max, line) {
        Ok(value) => Ok(Some(value)),
        Err(issue) if issue.reason == format!("`{field}` is required") => Ok(None),
        Err(issue) => Err(issue),
    }
}

/// Reads whichever credential column the roster used.
fn secret(password: &str, password_hash: &str, line: usize) -> Result<Option<Secret>, Issue> {
    let has_plain = !password.trim().is_empty();
    let has_hash = !password_hash.trim().is_empty();
    match (has_plain, has_hash) {
        (false, false) => Ok(None),
        (true, true) => Err(Issue::new(
            line,
            "<both credential columns>",
            "fill in `password` or `password_hash`, not both",
        )),
        (true, false) => {
            let password = password.trim();
            if password.chars().count() > MAX_PASSWORD_LEN {
                // Length only. The value is deliberately not echoed.
                return Err(Issue::new(
                    line,
                    "<password>",
                    format!("`password` must be at most {MAX_PASSWORD_LEN} characters"),
                ));
            }
            Ok(Some(Secret::Plain(password.to_owned())))
        }
        (false, true) => {
            let hash = password_hash.trim();
            // Only this algorithm. Storing an unverified string and discovering at login
            // that it is not a hash would leave accounts that nobody can ever sign in to.
            if !hash.starts_with("$argon2id$") {
                return Err(Issue::new(
                    line,
                    "<password_hash>",
                    "`password_hash` must be an argon2id PHC string beginning $argon2id$",
                ));
            }
            Ok(Some(Secret::Hash(hash.to_owned())))
        }
    }
}

// ---------------------------------------------------------------- applying

/// A class label already in the database, and the id it resolved to.
struct ClassIndex {
    exact: HashMap<String, i64>,
    folded: HashMap<String, i64>,
}

impl ClassIndex {
    async fn load(pool: &SqlitePool) -> Result<Self> {
        let mut index = Self {
            exact: HashMap::new(),
            folded: HashMap::new(),
        };
        for class in classes::list(pool).await? {
            index.insert(class.name.clone(), class.id);
        }
        Ok(index)
    }

    fn insert(&mut self, name: String, id: i64) {
        self.folded.insert(name.to_lowercase(), id);
        self.exact.insert(name, id);
    }

    /// Case-insensitive, so a roster that spells a section `9-f` reuses the class the
    /// school already calls `9-F` instead of creating a second one that only one half of
    /// the application can see.
    fn get(&self, name: &str) -> Option<i64> {
        self.exact
            .get(name)
            .or_else(|| self.folded.get(&name.to_lowercase()))
            .copied()
    }
}

/// A subject name already in the database, with the same case-insensitive reuse rule.
struct SubjectIndex {
    exact: HashMap<String, i64>,
    folded: HashMap<String, i64>,
}

impl SubjectIndex {
    async fn load(pool: &SqlitePool) -> Result<Self> {
        let mut index = Self {
            exact: HashMap::new(),
            folded: HashMap::new(),
        };
        for subject in subjects::list(pool).await? {
            index.insert(subject.name.clone(), subject.id);
        }
        Ok(index)
    }

    fn insert(&mut self, name: String, id: i64) {
        self.folded.insert(name.to_lowercase(), id);
        self.exact.insert(name, id);
    }

    fn get(&self, name: &str) -> Option<i64> {
        self.exact
            .get(name)
            .or_else(|| self.folded.get(&name.to_lowercase()))
            .copied()
    }
}

/// School IDs already in the database, held both exactly and folded.
///
/// The folded map is not a convenience -- it is a guard. `users.school_id` is `UNIQUE`
/// under SQLite's default binary collation, so `2026001` and `2026001` are two legal
/// rows. `AuthService` would then find both on a case-insensitive login and, correctly,
/// refuse to answer for either. Catching that here turns an unloginable account into a
/// line in the report.
struct UserIndex {
    exact: HashMap<String, i64>,
    folded: HashMap<String, i64>,
}

impl UserIndex {
    async fn load(pool: &SqlitePool) -> Result<Self> {
        let rows: Vec<(i64, String)> = sqlx::query_as("SELECT id, school_id FROM users")
            .fetch_all(pool)
            .await?;
        let mut index = Self {
            exact: HashMap::new(),
            folded: HashMap::new(),
        };
        for (id, school_id) in rows {
            index.insert(school_id, id);
        }
        Ok(index)
    }

    fn insert(&mut self, school_id: String, id: i64) {
        self.folded.insert(school_id.to_lowercase(), id);
        self.exact.insert(school_id, id);
    }

    fn get_exact(&self, school_id: &str) -> Option<i64> {
        self.exact.get(school_id).copied()
    }

    /// An account whose ID matches only when case is ignored.
    fn get_folded_only(&self, school_id: &str) -> bool {
        self.folded.contains_key(&school_id.to_lowercase())
    }
}

/// Applies a parsed roster.
///
/// Records are applied in dependency order -- classes, subjects, users, then teaching
/// assignments -- regardless of the order they appear in the file, so a school can sort
/// the spreadsheet however it likes and get the same database.
async fn apply(pool: &SqlitePool, records: &[Record]) -> Result<Report> {
    let mut report = Report::default();
    let mut class_index = ClassIndex::load(pool).await?;
    let mut subject_index = SubjectIndex::load(pool).await?;
    let mut user_index = UserIndex::load(pool).await?;
    // School IDs seen in *this* roster, so two rows cannot create the ambiguity the
    // folded index guards against for pre-existing accounts.
    let mut seen: HashMap<String, usize> = HashMap::new();

    for record in records {
        match record {
            Record::Class { name, .. } => {
                if class_index.get(name).is_some() {
                    report.classes_reused += 1;
                } else {
                    let created = classes::create(pool, &NewClass::new(name.clone())).await?;
                    class_index.insert(name.clone(), created.id);
                    report.classes_created += 1;
                }
            }
            Record::Subject { name, .. } => {
                if subject_index.get(name).is_some() {
                    report.subjects_reused += 1;
                } else {
                    let created = subjects::create(pool, &NewSubject::new(name.clone())).await?;
                    subject_index.insert(name.clone(), created.id);
                    report.subjects_created += 1;
                }
            }
            _ => {}
        }
    }

    for record in records {
        let Record::User {
            school_id,
            display_name,
            role,
            section,
            secret,
            line,
        } = record
        else {
            continue;
        };

        // A section a class row never declared is created here rather than refused.
        // Refusing would make the file order-dependent and would fail a roster that is
        // correct but lists sections only on the students; the created class shows up in
        // `classes_created`, so a typo is visible in one line of the report.
        let class_id = match section {
            Some(name) => match class_index.get(name) {
                Some(id) => Some(id),
                None => {
                    let created = classes::create(pool, &NewClass::new(name.clone())).await?;
                    class_index.insert(name.clone(), created.id);
                    report.classes_created += 1;
                    Some(created.id)
                }
            },
            None => None,
        };

        // Within-file duplicates are checked *first*, before the database. Two rows for
        // one person is a mistake in the spreadsheet, and reporting it as "an account
        // already exists" would hide that -- the operator needs to know the file repeats
        // itself, not that the import is idempotent.
        if let Some(first_line) = seen.get(&school_id.to_lowercase()) {
            report.rejected.push(Issue::new(
                *line,
                school_id,
                format!(
                    "an earlier row in this roster already uses this school ID (line {first_line})"
                ),
            ));
            continue;
        }

        let existing = match user_index.get_exact(school_id) {
            Some(id) => Some(id),
            None if user_index.get_folded_only(school_id) => {
                report.conflicts.push(Issue::new(
                    *line,
                    school_id,
                    "an account already exists whose school ID differs only in case; \
                     leaving it alone, because either spelling would then be ambiguous at login",
                ));
                seen.insert(school_id.to_lowercase(), *line);
                continue;
            }
            None => None,
        };

        seen.insert(school_id.to_lowercase(), *line);

        let user_id = match existing {
            // Left exactly as it is. A roster is not a migration, and nothing here is
            // allowed to change a role or move a student between classes on its say-so.
            Some(id) => {
                report.users_existing += 1;
                id
            }
            None => {
                let user = users::create(
                    pool,
                    &NewUser {
                        school_id: school_id.clone(),
                        display_name: display_name.clone(),
                        role: *role,
                        class_id,
                    },
                )
                .await?;
                user_index.insert(school_id.clone(), user.id);
                report.users_created += 1;
                user.id
            }
        };

        let Some(secret) = secret else { continue };
        let already = credentials::find_password_hash(pool, user_id)
            .await?
            .is_some();
        if already {
            // A password a person has since changed is not the roster's to reset. Setting
            // it would let a stale spreadsheet lock people out of their own accounts.
            report.credentials_preserved += 1;
            continue;
        }
        let hash = match secret {
            Secret::Plain(password) => {
                hash_password(password).map_err(|error| anyhow::anyhow!("{error}"))?
            }
            Secret::Hash(hash) => hash.clone(),
        };
        credentials::set_password_hash(pool, user_id, &hash).await?;
        report.credentials_set += 1;
    }

    for record in records {
        let Record::Assignment {
            teacher_school_id,
            class_name,
            line,
        } = record
        else {
            continue;
        };

        let Some(teacher_id) = user_index.get_exact(teacher_school_id) else {
            report.rejected.push(Issue::new(
                *line,
                teacher_school_id,
                "no account with this school ID exists, so there is nobody to assign",
            ));
            continue;
        };
        // Checked here as well as by the migration's trigger, so the operator gets a line
        // in the roster report naming the row rather than a trigger error naming a table.
        let role: Role = sqlx::query_scalar("SELECT role FROM users WHERE id = ?1")
            .bind(teacher_id)
            .fetch_one(pool)
            .await?;
        if role != Role::Teacher {
            report.rejected.push(Issue::new(
                *line,
                teacher_school_id,
                "only a teacher may be assigned to a class",
            ));
            continue;
        }
        let Some(class_id) = class_index.get(class_name) else {
            report.rejected.push(Issue::new(
                *line,
                class_name,
                "no class or user row in this roster declares this section",
            ));
            continue;
        };
        // `INSERT OR IGNORE` underneath, so a rerun reports rather than fails.
        if teacher_classes::assign(pool, teacher_id, class_id).await? {
            report.assignments_created += 1;
        } else {
            report.assignments_existing += 1;
        }
    }

    Ok(report)
}

/// Reads a roster file and applies it.
///
/// There is no `--dry-run`, and the reason is worth stating because it looks like a
/// missing feature. A rehearsal would have to be exact to be worth anything, and being
/// exact means writing: the repositories take a `&SqlitePool` rather than an executor,
/// so there is no transaction to roll back, and a run against production that creates
/// rows and deletes them afterwards is briefly visible to real requests.
///
/// The report is the feedback loop instead. Because every write is keyed on an existing
/// `UNIQUE` column, a rehearsal and a real import are the *same operation*: run it,
/// read the counts, fix the roster, run it again. Nothing to undo, and nothing to keep
/// in step with the real code path.
pub async fn import_file(pool: &SqlitePool, path: &Path) -> Result<Report> {
    let text = std::fs::read_to_string(path)
        .with_context(|| format!("could not read the roster at {}", path.display()))?;
    apply(pool, &parse(&text)?).await
}

// ---------------------------------------------------------------- CLI

/// `mmss-backend import --roster <path>`
///
/// Kept as a hand-rolled argument scan: one flag does not justify an argument-parsing
/// dependency, and this keeps the binary's dependency list unchanged.
pub async fn run_cli(args: &[String]) -> Result<()> {
    let mut roster: Option<&str> = None;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--roster" => {
                roster = Some(
                    args.get(index + 1)
                        .context("--roster needs a path to a CSV file")?,
                );
                index += 2;
            }
            other => bail!("unknown argument {other:?}; see ACCOUNT_PROVISIONING.md"),
        }
    }
    let path =
        roster.context("nothing to import. Usage: mmss-backend import --roster <path.csv>")?;

    let config = Config::from_env()?;
    let state = AppState::new(config).await?;
    let report = import_file(&state.db, Path::new(path)).await?;

    println!("{}", serde_json::to_string_pretty(&report)?);
    if !report.is_clean() {
        bail!(
            "{} row(s) were not applied. Nothing is wrong with the database, but the \
             roster and the database do not yet agree -- see `rejected` and `conflicts` above.",
            report.rejected.len() + report.conflicts.len()
        );
    }
    tracing::info!(
        classes_created = report.classes_created,
        classes_reused = report.classes_reused,
        subjects_created = report.subjects_created,
        users_created = report.users_created,
        users_existing = report.users_existing,
        assignments_created = report.assignments_created,
        credentials_set = report.credentials_set,
        "roster import complete"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_secret_never_prints_itself() {
        let plain = Secret::Plain("hunter2".into());
        let hash = Secret::Hash("$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA".into());
        assert_eq!(format!("{plain:?}"), "Secret(<redacted>)");
        assert_eq!(format!("{hash:?}"), "Secret(<redacted>)");
        assert!(!format!("{plain:?}{hash:?}").contains("hunter2"));
        assert!(!format!("{plain:?}").contains("c2FsdA"));
    }

    #[test]
    fn roles_default_to_student_and_refuse_anything_else() {
        assert_eq!(parse_role("", 1).unwrap(), Role::Student);
        assert_eq!(parse_role("student", 1).unwrap(), Role::Student);
        assert_eq!(parse_role("Teacher", 1).unwrap(), Role::Teacher);
        assert_eq!(parse_role("ADMIN", 1).unwrap(), Role::Admin);
        // Case and surrounding whitespace are forgiven -- a spreadsheet cell is not a command
        // line, and `Teacher` must not silently become a student.
        assert_eq!(parse_role("  Teacher  ", 1).unwrap(), Role::Teacher);
        for bad in ["studnet", "root", "moderator", "student teacher", "staff"] {
            let issue = parse_role(bad, 7).unwrap_err();
            assert_eq!(issue.line, 7);
            assert!(issue.reason.starts_with("unknown role"), "{bad:?}");
        }
    }

    #[test]
    fn school_ids_are_normalised_the_way_a_login_normalises_them() {
        assert_eq!(
            school_id("  2026001  ", 1).unwrap(),
            "2026001",
            "trimmed, like a typed login"
        );
        assert_eq!(
            school_id("2026001@manavmangalschool.com", 1).unwrap(),
            "2026001",
            "the school domain is stripped so the roster and a login agree"
        );
        // A bare domain has nothing to strip, so `normalize_school_id` returns it unchanged
        // rather than emptying it. Whatever a login does with such a value, the roster
        // must store exactly what a login would look up, so it round-trips untouched
        // instead of being silently turned into something else.
        assert_eq!(
            school_id("@manavmangalschool.com", 1).unwrap(),
            "@manavmangalschool.com"
        );
        assert!(school_id("", 3).is_err());
        assert!(school_id("   ", 3).is_err(), "whitespace is not an ID");
        assert!(
            school_id("a\nb", 3).is_err(),
            "control characters are refused"
        );
        assert!(school_id(&"x".repeat(MAX_SCHOOL_ID_LEN + 1), 3).is_err());
    }

    #[test]
    fn a_plaintext_credential_is_accepted_but_never_echoed_in_a_rejection() {
        let found = secret("  hunter2  ", "", 4).unwrap().unwrap();
        assert_eq!(found, Secret::Plain("hunter2".into()));

        let too_long = secret("x", &"y".repeat(MAX_PASSWORD_LEN + 1), 4).unwrap_err();
        assert!(!too_long.reason.contains('y'), "{:?}", too_long);
        assert!(!too_long.reason.contains('x'), "{:?}", too_long);
    }

    #[test]
    fn a_prehashed_credential_must_really_be_one() {
        let ok = secret("", "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaA", 5)
            .unwrap()
            .unwrap();
        assert!(matches!(ok, Secret::Hash(_)));

        for bad in [
            "hunter2",
            "$2y$10$something",
            "$argon2i$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA",
            "",
        ] {
            // An empty one is simply "no credential", which is a legitimate state.
            if bad.is_empty() {
                assert!(secret("", "", 5).unwrap().is_none());
                continue;
            }
            assert!(
                secret("", bad, 5).is_err(),
                "{bad:?} must not be storable as a hash"
            );
        }
    }

    #[test]
    fn both_credential_columns_at_once_is_refused() {
        // Both columns named: the reason may say the words "password" and "password_hash", but
        // must carry neither value.
        let issue = secret(
            "the-plain-value",
            "$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA",
            6,
        )
        .unwrap_err();
        assert!(issue.reason.contains("not both"), "{issue:?}");
        assert!(!issue.reason.contains("the-plain-value"), "{issue:?}");
        assert!(!issue.reason.contains("c2FsdA"), "{issue:?}");
    }

    #[test]
    fn staff_must_not_name_a_section_and_students_must() {
        // The whole file is rejected, so both problems surface together rather than one
        // per run.
        let error = parse(
            "kind,id,name,role,section,password,password_hash\n\
             user,t001,Ms Rao,teacher,9-A,,\n\
             user,2026001,Aarav,student,,,\n",
        )
        .unwrap_err()
        .to_string();
        assert!(error.contains("must not name a section"), "{error}");
        assert!(error.contains("must name a section"), "{error}");
        // Both line numbers, so the operator can find both rows.
        assert!(error.contains("line 2"), "{error}");
        assert!(error.contains("line 3"), "{error}");
    }

    #[test]
    fn a_well_formed_roster_parses_in_dependency_order_regardless_of_file_order() {
        let text = "\
kind,id,name,role,section,password,password_hash
assignment,t001,,,9-A,,
user,t001,Ms Rao,teacher,,,
user,2026001,Aarav,student,9-A,secret,
subject,Mathematics,,,,
class,9-A,,,,
";
        let records = parse(text).unwrap();
        assert_eq!(
            records
                .iter()
                .filter(|r| matches!(r, Record::Class { .. }))
                .count(),
            1
        );
        assert_eq!(
            records
                .iter()
                .filter(|r| matches!(r, Record::Subject { .. }))
                .count(),
            1
        );
        assert_eq!(
            records
                .iter()
                .filter(|r| matches!(r, Record::User { .. }))
                .count(),
            2
        );
        assert_eq!(
            records
                .iter()
                .filter(|r| matches!(r, Record::Assignment { .. }))
                .count(),
            1
        );

        let user = records
            .iter()
            .find_map(|r| match r {
                Record::User {
                    school_id, secret, ..
                } if school_id == "2026001" => Some(secret.clone()),
                _ => None,
            })
            .unwrap();
        assert_eq!(user, Some(Secret::Plain("secret".into())));
    }

    #[test]
    fn a_single_bad_row_stops_the_whole_import_before_anything_is_written() {
        let text = "\
kind,id,name,role,section,password,password_hash
class,9-A,,,,
class,9-B,,,,
banana,,whatever,,,,
";
        let error = parse(text).unwrap_err().to_string();
        assert!(error.contains("1 of the roster's rows"), "{error}");
        assert!(error.contains("line 4"), "{error}");
    }

    #[test]
    fn the_line_number_counts_the_header() {
        let text = "kind,id\nclass,9-A\nbogus,x\n";
        let error = parse(text).unwrap_err().to_string();
        assert!(error.contains("line 3"), "{error}");
    }

    #[test]
    fn line_numbers_survive_blank_lines_and_embedded_newlines() {
        // A blank line on 3, and a quoted display name spanning lines 5-6. `csv`'s own
        // counter gets the multi-line case right but silently drops the blank one, so it
        // under-reports every line below it -- and in a three-thousand-student roster a
        // stray blank line from a spreadsheet is entirely ordinary.
        let records = parse(
            "kind,id,name,role,section,password,password_hash\n\
             class,9-A,,,,\n\
             \n\
             class,9-B,,,,\n\
             user,2026001,\"Aarav\nSharma\",student,9-A,\n",
        )
        .unwrap();
        let lines: Vec<usize> = records
            .iter()
            .map(|record| match record {
                Record::Class { line, .. }
                | Record::Subject { line, .. }
                | Record::User { line, .. }
                | Record::Assignment { line, .. } => *line,
            })
            .collect();
        assert_eq!(
            lines,
            vec![2, 4, 5],
            "physical lines, not record numbers -- the number is the only handle an \
             operator has on the file"
        );
    }

    #[test]
    fn trailing_columns_may_be_omitted_entirely() {
        // The common case: a school with no pre-hashed credentials writes five columns and
        // never mentions the other two. Every account is provisioned with no credential,
        // which is the safe state for a password nobody has been handed out yet.
        let text = "kind,id,name,role,section\nuser,2026001,Aarav,student,9-A\n";
        let records = parse(text).unwrap();
        let Record::User {
            secret, section, ..
        } = &records[0]
        else {
            panic!("expected a user record");
        };
        assert!(secret.is_none());
        assert_eq!(section.as_deref(), Some("9-A"));
    }

    #[test]
    fn surrounding_whitespace_in_a_spreadsheet_cell_is_noise() {
        let text = "kind,id,name,role,section\n  class  ,  9-A  ,,, \n";
        let records = parse(text).unwrap();
        assert!(matches!(&records[0], Record::Class { name, .. } if name == "9-A"));
    }

    #[test]
    fn an_unknown_column_is_refused_rather_than_ignored() {
        // A typo'd header is how a whole column of names silently fails to import.
        let text = "kind,id,displayname,role,section\nclass,9-A,,, \n";
        let error = parse(text).unwrap_err().to_string();
        assert!(error.contains("displayname"), "{error}");
    }

    #[test]
    fn trailing_empty_fields_are_fine_but_a_value_past_the_header_is_not() {
        // A spreadsheet exporting a seven-column template and filling five leaves trailing
        // commas on every row. That is the normal shape of this file, not a mistake.
        let trailing = "\
kind,id,name,role,section
user,2026001,Aarav,student,9-A,,
class,9-A,,,,
";
        assert!(parse(trailing).is_ok());

        // A value with nowhere to go is different, and is refused by naming it.
        let error = parse("kind,id,name,role,section\nuser,2026001,Aarav,student,9-A,extra\n")
            .unwrap_err()
            .to_string();
        assert!(error.contains("\"extra\""), "{error}");
        assert!(error.contains("line 2"), "{error}");
    }

    #[test]
    fn a_header_without_a_kind_column_is_refused() {
        let error = parse("id,name,role\n2026001,Aarav,student\n")
            .unwrap_err()
            .to_string();
        assert!(error.contains("must declare a `kind` column"), "{error}");
    }

    #[test]
    fn a_duplicated_column_is_refused() {
        let error = parse("kind,id,id\nclass,9-A,9-B\n")
            .unwrap_err()
            .to_string();
        assert!(error.contains("twice"), "{error}");
    }

    #[test]
    fn columns_may_be_declared_in_any_order() {
        // A school exporting from a spreadsheet tool reorders columns for their own
        // reasons. Position must not be part of the contract.
        let text = "section,role,name,id,kind\n9-A,student,Aarav,2026001,user\n";
        let records = parse(text).unwrap();
        let Record::User {
            school_id,
            display_name,
            section,
            ..
        } = &records[0]
        else {
            panic!("expected a user record");
        };
        assert_eq!(school_id, "2026001");
        assert_eq!(display_name.as_deref(), Some("Aarav"));
        assert_eq!(section.as_deref(), Some("9-A"));
    }

    #[test]
    fn a_report_is_clean_only_when_nothing_was_left_out() {
        let mut report = Report::default();
        assert!(report.is_clean());
        report.rejected.push(Issue::new(1, "x", "y"));
        assert!(!report.is_clean());
        let mut report = Report::default();
        report.conflicts.push(Issue::new(1, "x", "y"));
        assert!(!report.is_clean());
    }
}
