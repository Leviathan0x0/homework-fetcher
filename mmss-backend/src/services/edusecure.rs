//! The EduSecure boundary.
//!
//! MMSS64 owns homework. EduSecure is a place homework can be *copied to* during the
//! transition, and a source of historical rows to import once. Nothing here can change
//! what homework is: publication is an outbound side effect of a record that already
//! exists locally, and every failure path leaves that record exactly as it was.
//!
//! Three things make that true, and they are the reason this is a service and not a few
//! route handlers:
//!
//!   * [`EduSecureClient`] is a trait, so the portal is reachable from exactly one place
//!     and a test never needs credentials or a network;
//!   * every attempt is written to the publication ledger, so a failure is *recorded*
//!     rather than swallowed, and an already-published entry is a no-op;
//!   * the transform ([`parse_announcement_html`]) works on HTML handed to it, so the
//!     fragile part -- fetching and scraping a portal whose control ids are regenerated
//!     each academic year -- stays outside this codebase. See `EDUSECURE_AUDIT.md`.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use sqlx::SqlitePool;

use crate::api::{ImportResult, PublicationView};
use crate::error::{ApiError, ApiResult};
use crate::models::{Homework, NewHomework, PublicationStatus};
use crate::repositories::{classes, edusecure as ledger, homework as homework_repo, subjects};
use crate::services::auth::Principal;
use crate::validate::CalendarDate;

/// Longest an upstream error message may be stored. An error is kept for an operator to
/// read, so it is bounded rather than being whatever the portal happened to return.
const MAX_ERROR_LEN: usize = 500;

/// What went wrong on the other side.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PortalError {
    /// No credentials are configured. Not a failure: it is the normal state of a local
    /// checkout or a test run, and must not look like a broken deployment.
    #[error("The EduSecure integration is not configured.")]
    Disabled,
    /// Could not reach the portal: DNS, TLS, egress, timeout.
    #[error("EduSecure could not be reached.")]
    Unreachable,
    /// The portal refused our credentials.
    #[error("EduSecure rejected the configured credentials.")]
    Unauthenticated,
    /// The portal answered with something we cannot read.
    #[error("EduSecure returned a response that could not be understood.")]
    Malformed,
    /// The portal answered, and said no.
    #[error("EduSecure refused the entry.")]
    Rejected,
    /// The operation has no implementation yet. See `EDUSECURE_AUDIT.md`: there is no
    /// known write endpoint on the portal to port.
    #[error("This EduSecure operation is not implemented.")]
    Unsupported,
}

impl PortalError {
    /// Safe to store and to show: never a credential, never a database detail.
    fn as_stored(&self) -> String {
        let text = self.to_string();
        text.chars().take(MAX_ERROR_LEN).collect()
    }
}

/// The one way out of this module.
///
/// Implemented by the disabled client in production-without-credentials and by fakes in
/// tests. The signature takes the resolved names rather than ids because a portal needs a
/// human-readable class and subject, and resolving them here keeps the client free of
/// database access.
///
/// The future is boxed rather than written as an `async fn` because a trait with an `async
/// fn` is not dyn-compatible without the `async-trait` crate, and one dependency for this
/// is not worth it -- `BoxFuture` from std does the same job at zero cost.
pub type PublishFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Option<String>, PortalError>> + Send + 'a>>;

/// Whether a set of portal credentials is good.
///
/// A boolean rather than a session: a caller verifying a credential is answering "is
/// this the right password", and anything it would do with the answer -- store the
/// credential, enable the separate password -- happens on this side of the boundary.
pub type VerifyFuture<'a> = Pin<Box<dyn Future<Output = Result<bool, PortalError>> + Send + 'a>>;

pub trait EduSecureClient: Send + Sync {
    /// Publishes one entry, returning the portal's identifier for it if it minted one.
    fn publish<'a>(
        &'a self,
        entry: &'a Homework,
        class_name: &'a str,
        subject_name: &'a str,
    ) -> PublishFuture<'a>;

    /// Whether [`Self::verify_credentials`] can actually answer.
    ///
    /// Asked of the client rather than derived from configuration, because the two are
    /// not the same thing: `EDUSECURE_*` can be fully set on a deployment whose client
    /// is still the disabled one. Callers use this to decide whether a flow can work,
    /// and a wrong `true` there turns "the portal is unavailable" into a 503 on a
    /// request whose outcome would otherwise have been a generic 401 -- which is an
    /// account-enumeration oracle on `POST /auth/login`.
    fn can_verify(&self) -> bool;

    /// Checks a school ID and password against the portal by **completing its normal
    /// login flow**.
    ///
    /// There is no offline verification and there is not going to be one: the portal
    /// holds the password hash and exposes no "check this password" endpoint, so the
    /// only honest implementation of this method is the login POST the portal expects.
    /// The legacy Node client in `server/edusecure/edusecureAuth.js` is the reference
    /// for that handshake; a Rust client has to reproduce it, not invent a cheaper one.
    ///
    /// `PortalError::Unauthenticated` is the answer for a wrong password, and callers
    /// must map every other variant onto their own generic failure -- "the portal could
    /// not be reached" is not "that password is wrong", and telling a student the
    /// second when it is the first is how a working password gets thrown away.
    fn verify_credentials<'a>(&'a self, school_id: &'a str, password: &'a str) -> VerifyFuture<'a>;
}

/// The client used when no credentials are configured.
///
/// It exists so the disabled path is a value rather than a branch: the service logic is
/// identical either way, which is what keeps "EduSecure is off" from being a special case
/// that behaves differently from "EduSecure is on but failing".
#[derive(Debug, Clone, Copy, Default)]
pub struct DisabledClient;

impl EduSecureClient for DisabledClient {
    fn publish<'a>(
        &'a self,
        _entry: &'a Homework,
        _class_name: &'a str,
        _subject_name: &'a str,
    ) -> PublishFuture<'a> {
        Box::pin(async { Err(PortalError::Disabled) })
    }

    fn verify_credentials<'a>(
        &'a self,
        _school_id: &'a str,
        _password: &'a str,
    ) -> VerifyFuture<'a> {
        Box::pin(async { Err(PortalError::Disabled) })
    }

    fn can_verify(&self) -> bool {
        false
    }
}

/// Picks the client the deployment asked for.
pub fn client_for(config: &crate::config::EduSecureConfig) -> Arc<dyn EduSecureClient> {
    if config.enabled() {
        // A configured client would go here. It is not written yet, and claiming otherwise
        // would mean inventing a write endpoint the portal may not have -- see
        // `EDUSECURE_AUDIT.md`. Until it exists, a configured deployment behaves exactly
        // like an unconfigured one and says so with `Unsupported`.
        Arc::new(DisabledClient)
    } else {
        Arc::new(DisabledClient)
    }
}

/// Whether this deployment can actually verify a portal credential.
///
/// Asked of the *client*, not of the configuration. `EDUSECURE_*` being fully set says
/// the operator intended an integration, not that one exists -- and today
/// [`client_for`] returns the disabled client either way. Answering from the config
/// would make `POST /auth/login` return 503 for a legacy account whose password was
/// wrong, where every other account gets 401, which tells a caller exactly which school
/// IDs have no local credential. The Account Security page asks the same question, and
/// there it hides a form that could only fail.
pub fn can_verify_credentials(config: &crate::config::EduSecureConfig) -> bool {
    client_for(config).can_verify()
}

/// One historical row from the school portal, before it becomes local homework.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedHomework {
    pub due_date: String,
    pub homework_text: Option<String>,
    pub classwork_text: Option<String>,
    /// The portal's remote file URL. Recorded as metadata only -- the bytes stay where
    /// they are, and nothing downloads them here.
    pub attachment_url: Option<String>,
}

/// Splits a merged portal body into its two halves.
///
/// The portal sends one string containing `Homework:` and `Classwork:` markers, which R2
/// split into two columns. That split is preserved for migration because it is the only
/// reason this function exists; everything else about the old shape was dropped.
pub fn split_diary_body(body: &str) -> (Option<String>, Option<String>) {
    // Walk the lines once, remembering which section each belongs to. A marker only
    // switches sections; text before any marker is homework, which is what the old
    // single-column data looked like in practice.
    let mut into_classwork = false;
    let mut homework_lines: Vec<&str> = Vec::new();
    let mut classwork_lines: Vec<&str> = Vec::new();
    for line in body.lines() {
        let trimmed = line.trim();
        if starts_with_marker(trimmed, "homework") {
            into_classwork = false;
            if let Some(rest) = strip_marker(trimmed, "homework") {
                push_line(&mut homework_lines, rest);
            }
            continue;
        }
        if starts_with_marker(trimmed, "classwork") {
            into_classwork = true;
            if let Some(rest) = strip_marker(trimmed, "classwork") {
                push_line(&mut classwork_lines, rest);
            }
            continue;
        }
        push_line(
            if into_classwork {
                &mut classwork_lines
            } else {
                &mut homework_lines
            },
            trimmed,
        );
    }
    (joined(homework_lines), joined(classwork_lines))
}

/// Whether a line is the `Homework:` / `Classwork:` marker rather than content.
///
/// The colon is required, or the line being *only* the word. Accepting any line that merely
/// began with the word would swallow real content -- "Homework sheet attached" is a
/// sentence a teacher wrote, not a section header.
fn starts_with_marker(line: &str, marker: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    let Some(rest) = lower.strip_prefix(marker) else {
        return false;
    };
    rest.starts_with(':') || rest.trim().is_empty()
}

fn strip_marker<'a>(line: &'a str, marker: &str) -> Option<&'a str> {
    let rest = line.get(marker.len()..)?.trim_start();
    Some(rest.strip_prefix(':').unwrap_or(rest).trim())
}

fn push_line<'a>(lines: &mut Vec<&'a str>, text: &'a str) {
    // Blank lines inside a section are kept: a blank line between two paragraphs is part
    // of what the teacher wrote, and dropping it would rewrite the content on the way in.
    // R6 made the same call for the local API, and the two paths must not disagree.
    lines.push(text);
}

fn joined(lines: Vec<&str>) -> Option<String> {
    let text = lines.join("\n").trim().to_owned();
    (!text.is_empty()).then_some(text)
}

/// Parses the announcement grid into rows.
///
/// Returns [`PortalError::Malformed`] rather than an empty list when the document is not
/// the page we expect. The distinction matters during a migration: "the portal gave us
/// nothing" and "the portal gave us something we failed to read" must not look alike, or a
/// silent import looks exactly like an empty school week.
pub fn parse_announcement_html(html: &str) -> Result<Vec<ImportedHomework>, PortalError> {
    let lowered = html.to_ascii_lowercase();
    if lowered.contains("txtusername") || lowered.contains("login.aspx") {
        // The old code inferred an expired session the same way.
        return Err(PortalError::Malformed);
    }
    if !lowered.contains("grddashcontents") {
        return Err(PortalError::Malformed);
    }

    let mut rows = Vec::new();
    for raw_row in html.split("<tr").skip(1) {
        let Some(row) = raw_row.split("</tr>").next() else {
            continue;
        };
        let body = row_text(row);
        if body.trim().is_empty() {
            continue;
        }
        let Some(date) = find_date(row) else {
            continue;
        };
        let (homework_text, classwork_text) = split_diary_body(&body);
        if homework_text.is_none() && classwork_text.is_none() {
            continue;
        }
        rows.push(ImportedHomework {
            due_date: date,
            homework_text,
            classwork_text,
            attachment_url: find_attachment_href(row),
        });
    }
    Ok(rows)
}

/// The visible text of the row's first paragraph, which is where the body lives.
fn row_text(row: &str) -> String {
    let Some(start) = row.find("<p") else {
        return String::new();
    };
    let rest = &row[start..];
    let end = rest.find("</p>").unwrap_or(rest.len());
    strip_tags(&rest[..end])
}

fn strip_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut depth = 0usize;
    let bytes = html.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'<' {
            // A line break inside the paragraph is a real boundary in the portal body:
            // `Homework:` and `Classwork:` are separated by `<br/>`, and without turning it
            // into a newline the two markers end up concatenated on one line and the split
            // silently fails.
            let tail = &html[index..];
            if tail.starts_with("<br") || tail.starts_with("<br/") || tail.starts_with("<br />") {
                out.push('\n');
            }
            depth += 1;
            index += 1;
            continue;
        }
        if bytes[index] == b'>' {
            depth = depth.saturating_sub(1);
            index += 1;
            continue;
        }
        if depth == 0 {
            let ch = html[index..].chars().next().unwrap();
            out.push(ch);
            index += ch.len_utf8();
            continue;
        }
        index += 1;
    }
    decode_entities(out.trim())
}

fn decode_entities(text: &str) -> String {
    text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

/// The row's date, in either of the two forms the portal has used.
fn find_date(row: &str) -> Option<String> {
    let mut rest = row;
    while let Some(start) = rest.find("<small") {
        let tail = &rest[start..];
        let end = tail.find("</small>").unwrap_or(tail.len());
        let text = strip_tags(&tail[..end]);
        if let Some(date) = parse_portal_date(&text) {
            return Some(date);
        }
        rest = &tail[end..];
    }
    None
}

/// Accepts `"Jul 23, 2026"`, `"23 Jul 2026"` and ISO `"2026-07-23"`.
///
/// The first two are what the portal actually emits and what R2 removed from the local
/// schema; ISO is accepted too because a portal revision or a manual paste may use it.
pub fn parse_portal_date(raw: &str) -> Option<String> {
    let text = raw.trim();
    if text.is_empty() {
        return None;
    }
    // ISO passes straight through, so a portal revision that emits the local format needs
    // no special case.
    if let Some(iso) = CalendarDate::parse(text) {
        return Some(iso.to_iso());
    }
    let cleaned = text.replace(',', " ");
    let parts: Vec<&str> = cleaned.split_whitespace().collect();
    let [first, second, year] = parts.as_slice() else {
        return None;
    };
    let (month, day) = match (month_number(first), first.parse::<u32>().ok()) {
        // "Jul 23 2026" / "July 23 2026"
        (Some(month), None) => (month, second.parse::<u32>().ok()?),
        // "23 Jul 2026"
        (None, Some(day)) => (month_number(second)?, day),
        // Neither token is a day, so the shape is not one we know.
        _ => return None,
    };
    CalendarDate::parse(&format!("{year}-{month:02}-{day:02}")).map(|date| date.to_iso())
}

/// 1-based month number for a name or abbreviation, case-insensitively.
fn month_number(name: &str) -> Option<u32> {
    const MONTHS: [&str; 12] = [
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
    ];
    let lower = name.trim().to_ascii_lowercase();
    MONTHS
        .iter()
        .position(|month| month.starts_with(&lower))
        .map(|index| index as u32 + 1)
}

fn find_attachment_href(row: &str) -> Option<String> {
    let mut rest = row;
    while let Some(start) = rest.find("<a ") {
        let tail = &rest[start..];
        let end = tail.find('>').unwrap_or(tail.len());
        let tag = &tail[..end];
        if tag.contains("HyperLink1") {
            let href_start = tag.find("href=")? + "href=".len();
            let quote = tag.as_bytes().get(href_start).copied()?;
            let value = &tag[href_start + 1..];
            let close = value.find(quote as char)?;
            let href = value[..close].trim();
            return (!href.is_empty() && !href.starts_with("javascript:")).then(|| href.to_owned());
        }
        rest = &tail[end..];
    }
    None
}

/// A publish request, already checked against the local record.
pub struct EduSecureService<'a> {
    db: &'a SqlitePool,
    client: Arc<dyn EduSecureClient>,
    enabled: bool,
}

impl<'a> EduSecureService<'a> {
    pub fn new(db: &'a SqlitePool, client: Arc<dyn EduSecureClient>, enabled: bool) -> Self {
        Self {
            db,
            client,
            enabled,
        }
    }

    /// Whether the integration is configured at all. Always safe to ask.
    pub fn enabled(&self) -> bool {
        self.enabled
    }

    /// The current publication state of an entry, or `None` if it was never attempted.
    pub async fn publication(&self, homework_id: i64) -> ApiResult<Option<PublicationView>> {
        Ok(ledger::find(self.db, homework_id)
            .await?
            .as_ref()
            .map(PublicationView::from))
    }

    /// Pushes one entry to the portal.
    ///
    /// The order is deliberate. The local record is read and the caller is authorised
    /// first; only then is anything written. A duplicate is answered from the ledger
    /// without calling the portal at all, so a retried request cannot produce a second
    /// copy upstream.
    ///
    /// On failure the attempt is recorded and the error is returned, and the local
    /// `homework` row is untouched -- no rollback, because nothing about the local record
    /// was ever provisional.
    pub async fn publish(&self, homework_id: i64) -> ApiResult<PublicationView> {
        let entry = homework_repo::find_by_id(self.db, homework_id)
            .await?
            .ok_or_else(|| ApiError::not_found("That homework item was not found."))?;

        // A completed publication is a no-op, not an error: the caller asked for the entry
        // to be published and it is, so the honest answer is the state it is already in.
        if let Some(existing) = ledger::find(self.db, homework_id).await? {
            if existing.state() == PublicationStatus::Published {
                return Ok(PublicationView::from(&existing));
            }
        }
        ledger::ensure(self.db, homework_id).await?;

        let class_name = classes::find_by_id(self.db, entry.class_id)
            .await?
            .map(|class| class.name)
            .unwrap_or_default();
        let subject_name = subjects::find_by_id(self.db, entry.subject_id)
            .await?
            .map(|subject| subject.name)
            .unwrap_or_default();

        match self
            .client
            .publish(&entry, &class_name, &subject_name)
            .await
        {
            Ok(external_id) => {
                let row = ledger::finish(
                    self.db,
                    homework_id,
                    PublicationStatus::Published,
                    external_id.as_deref(),
                    None,
                )
                .await?
                .ok_or_else(|| ApiError::internal(anyhow::anyhow!("publication row vanished")))?;
                Ok(PublicationView::from(&row))
            }
            Err(error) => {
                // The attempt is durable, so an operator can see it and a later retry knows
                // this already failed once. The local homework row is not touched.
                ledger::finish(
                    self.db,
                    homework_id,
                    PublicationStatus::Failed,
                    None,
                    Some(&error.as_stored()),
                )
                .await?;
                Err(portal_error_to_api(error))
            }
        }
    }

    /// Imports rows parsed out of a portal page.
    ///
    /// Deduplicated on (class, subject, date, homework text): re-importing the same page
    /// must not double a class's homework, which is exactly what the old system did with
    /// per-student copies.
    ///
    /// Rows are inserted one transaction at a time, all or nothing, because a half-imported
    /// page is harder to reason about than a rejected one.
    pub async fn import(
        &self,
        class_id: i64,
        subject_id: i64,
        rows: &[ImportedHomework],
    ) -> ApiResult<ImportResult> {
        if classes::find_by_id(self.db, class_id).await?.is_none() {
            return Err(ApiError::bad_request("That class does not exist."));
        }
        if subjects::find_by_id(self.db, subject_id).await?.is_none() {
            return Err(ApiError::bad_request("That subject does not exist."));
        }
        if rows.is_empty() {
            return Err(ApiError::bad_request(
                "The page contained no homework rows.",
            ));
        }

        let mut imported = 0;
        let mut skipped = 0;
        let mut tx = self.db.begin().await?;
        for row in rows {
            if exists_in_scope(&mut tx, class_id, subject_id, row).await? {
                skipped += 1;
                continue;
            }
            homework_repo::create(
                &mut *tx,
                &NewHomework {
                    class_id,
                    subject_id,
                    // An imported portal entry has no known author. `author_id` is
                    // nullable for exactly this case, and inventing a teacher would be a
                    // lie the ownership rules then depend on.
                    author_id: None,
                    due_date: row.due_date.clone(),
                    homework_text: row.homework_text.clone(),
                    classwork_text: row.classwork_text.clone(),
                },
            )
            .await?;
            imported += 1;
        }
        tx.commit().await?;
        Ok(ImportResult { imported, skipped })
    }
}

/// Whether this exact row is already present in the import scope.
async fn exists_in_scope(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    class_id: i64,
    subject_id: i64,
    row: &ImportedHomework,
) -> Result<bool, sqlx::Error> {
    let existing: Option<(String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT due_date, homework_text, classwork_text
           FROM homework
          WHERE class_id = ?1 AND subject_id = ?2 AND due_date = ?3",
    )
    .bind(class_id)
    .bind(subject_id)
    .bind(&row.due_date)
    .fetch_optional(&mut **tx)
    .await?;

    Ok(existing.is_some_and(|(date, homework, classwork)| {
        date == row.due_date && homework == row.homework_text && classwork == row.classwork_text
    }))
}

/// A portal failure as a client-visible error.
///
/// `Disabled` is a 503 rather than a 400: nothing about the request is wrong, the
/// integration is simply not available. Everything else is a 502, because the request was
/// fine and the other end is the problem.
fn portal_error_to_api(error: PortalError) -> ApiError {
    match &error {
        PortalError::Disabled | PortalError::Unsupported => ApiError::Client {
            status: axum::http::StatusCode::SERVICE_UNAVAILABLE,
            code: "EDUSECURE_UNAVAILABLE",
            message: error.to_string(),
        },
        _ => ApiError::Client {
            status: axum::http::StatusCode::BAD_GATEWAY,
            code: "EDUSECURE_FAILED",
            message: error.to_string(),
        },
    }
}

/// Import is an administrator action, so the caller is checked before anything is parsed.
pub fn require_admin(principal: &Principal) -> ApiResult<()> {
    if principal.role != crate::models::Role::Admin {
        return Err(ApiError::forbidden(
            "Only an administrator can run EduSecure operations.",
        ));
    }
    Ok(())
}
