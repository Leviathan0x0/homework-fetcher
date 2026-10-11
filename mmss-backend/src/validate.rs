//! Input validation for externally supplied data.
//!
//! Two things live here because they are the same concern: a calendar date, and the
//! HTTP-shaped checks around it. Everything a caller can supply is checked before it
//! reaches a repository, and a rejected value produces a 400 that names the field
//! rather than a query that quietly means something broader than was asked for.

use std::collections::HashMap;

use serde::de::DeserializeOwned;

use crate::error::ApiError;

/// Most entries one request may return. The student app fetches its whole class feed
/// in one call, so this is a backstop against an unbounded request rather than a
/// pagination design -- see `STUDENT_API_AUDIT.md`.
pub const MAX_LIMIT: i64 = 500;

/// Longest note body accepted. A student note is a reminder to themselves, not an
/// essay; the old endpoint took any string and let SQLite store it.
pub const MAX_NOTE_LEN: usize = 4_000;

/// Query parameters, as axum hands them over.
///
/// A `HashMap` rather than axum's borrowed `&str` view: the borrowed view forces every
/// call site to re-derive the pair lookup, and it makes `Query` extraction fragile with
/// handlers that take a body. Repeated keys keep the last value, which is what a filter
/// means anyway.
pub type Params = HashMap<String, String>;

/// A calendar date with no time and no zone.
///
/// `due_date` is a school day, so it must not pick up a timezone by accident: `2026-10-05`
/// is the same day for everyone. This is why formatting is a pure reformat with no offset
/// arithmetic anywhere in the codebase.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CalendarDate {
    pub year: i32,
    pub month: u32,
    pub day: u32,
}

impl CalendarDate {
    /// Parses a strict `YYYY-MM-DD` date, rejecting anything else including the
    /// display strings (`"Jul 23, 2026"`) and relative words (`"today"`) that the old
    /// system stored.
    pub fn parse(raw: &str) -> Option<Self> {
        let raw = raw.trim();
        let bytes = raw.as_bytes();
        if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
            return None;
        }
        let digits = |range: std::ops::Range<usize>| raw[range].parse::<u32>().ok();
        let year = digits(0..4)? as i32;
        let month = digits(5..7)?;
        let day = digits(8..10)?;
        let date = Self { year, month, day };
        // Reject anything the digits alone cannot rule out, e.g. 2026-02-31.
        if (1..=12).contains(&month) && (1..=days_in_month(year, month)).contains(&day) {
            Some(date)
        } else {
            None
        }
    }

    pub fn to_iso(self) -> String {
        format!("{:04}-{:02}-{:02}", self.year, self.month, self.day)
    }

    /// The label a student sees on a card, in the same shape the old data used:
    /// `"Oct 5, 2026"` -- abbreviated month, unpadded day.
    pub fn to_display(self) -> String {
        const MONTHS: [&str; 12] = [
            "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
        ];
        format!(
            "{} {}, {}",
            MONTHS[(self.month - 1) as usize],
            self.day,
            self.year
        )
    }
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap(year) => 29,
        2 => 28,
        _ => 0,
    }
}

fn is_leap(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

/// A path segment that has to be an id.
pub fn path_id(raw: &str) -> Result<i64, ApiError> {
    raw.parse::<i64>()
        .ok()
        .filter(|id| *id > 0)
        .ok_or_else(|| ApiError::bad_request("That identifier is not valid."))
}

fn field(name: &str, expect: &str) -> ApiError {
    ApiError::bad_request(format!("{name} must be {expect}."))
}

/// An optional id in the query string.
pub fn query_id(params: &Params, name: &str) -> Result<Option<i64>, ApiError> {
    match params.get(name).map(String::as_str) {
        None => Ok(None),
        Some("") => Ok(None),
        Some(raw) => raw
            .trim()
            .parse::<i64>()
            .ok()
            .filter(|id| *id > 0)
            .map(Some)
            .ok_or_else(|| field(name, "a positive integer")),
    }
}

/// An optional `YYYY-MM-DD` date in the query string.
pub fn query_date(params: &Params, name: &str) -> Result<Option<String>, ApiError> {
    match params.get(name).map(String::as_str) {
        None | Some("") => Ok(None),
        Some(raw) => CalendarDate::parse(raw)
            .map(|date| Some(date.to_iso()))
            .ok_or_else(|| field(name, "a date in YYYY-MM-DD form")),
    }
}

/// An optional `limit` in the query string, bounded on both sides.
pub fn query_limit(params: &Params) -> Result<Option<i64>, ApiError> {
    match params.get("limit").map(String::as_str) {
        None | Some("") => Ok(None),
        Some(raw) => match raw.trim().parse::<i64>() {
            Err(_) => Err(field("limit", "a number")),
            // `LIMIT -1` means *no limit* in SQLite, so a negative value would quietly
            // turn a bad request into an unrestricted query. Rejected rather than
            // normalised.
            Ok(limit) if !(1..=MAX_LIMIT).contains(&limit) => {
                Err(field("limit", &format!("between 1 and {MAX_LIMIT}")))
            }
            Ok(limit) => Ok(Some(limit)),
        },
    }
}

/// Rejects an inverted range rather than silently returning nothing for it.
pub fn check_range(from: Option<&str>, to: Option<&str>) -> Result<(), ApiError> {
    if let (Some(from), Some(to)) = (from, to) {
        if from > to {
            return Err(ApiError::bad_request(
                "The start date must not be after the end date.",
            ));
        }
    }
    Ok(())
}

/// Longest display name accepted.
///
/// The name is shown next to a student's own work, so it is short by intent. The old
/// endpoint took any string and let SQLite store it, which made a pasted paragraph
/// indistinguishable from a name.
pub const MAX_DISPLAY_NAME_LEN: usize = 200;

/// Longest homework or classwork text accepted.
///
/// Generous: a teacher's entry for one school day is a paragraph, and the R2
/// `CHECK` constraints carry no length of their own. This is a bound on the
/// request, not a content rule.
pub const MAX_HOMEWORK_LEN: usize = 20_000;

/// Most attachments one entry may declare. Metadata rows only, but the count is a
/// request-size question like any other.
pub const MAX_ATTACHMENTS: usize = 20;

/// Largest file a teacher may declare, in bytes. Not a storage decision -- storage
/// is deferred -- just the point past which a declared size is a mistake.
pub const MAX_ATTACHMENT_BYTES: i64 = 64 * 1024 * 1024;

/// A user-authored text body: trimmed, non-empty, and length-bounded.
pub fn text_body(raw: &str, name: &str, max_len: usize) -> Result<String, ApiError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(ApiError::bad_request(format!("{name} cannot be empty.")));
    }
    if trimmed.chars().count() > max_len {
        return Err(ApiError::bad_request(format!(
            "{name} must be at most {max_len} characters."
        )));
    }
    Ok(trimmed.to_owned())
}

/// A text field that may legitimately be absent, used for the two halves of an entry.
///
/// Unlike [`text_body`], a blank value is not an error: it means "this half is
/// absent", which is a real state the R2 `CHECK` allows. An entry with *neither*
/// half is not allowed, and that is [`require_content`]'s job rather than this
/// function's, so the two halves stay independently writable.
///
/// Only the ends are trimmed. Interior whitespace, blank lines and unusual but
/// legitimate school content survive unchanged -- a teacher pasting a table or a
/// poem-shaped spacing must get back exactly what they typed.
pub fn optional_text_body(
    raw: Option<&str>,
    name: &str,
    max_len: usize,
) -> Result<Option<String>, ApiError> {
    let Some(raw) = raw else { return Ok(None) };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > max_len {
        return Err(field(name, &format!("at most {max_len} characters")));
    }
    Ok(Some(trimmed.to_owned()))
}

/// The R2 `CHECK` restated as a validation error: at least one half must have
/// content.
///
/// Checked in the service so a client that clears the last half gets a 400 that
/// names the problem, instead of a 500 from a constraint violation a layer up.
/// The `CHECK` still exists as the backstop; this is the friendly version.
pub fn require_content(homework: Option<&str>, classwork: Option<&str>) -> Result<(), ApiError> {
    let has = |text: Option<&str>| text.is_some_and(|t| !t.trim().is_empty());
    if has(homework) || has(classwork) {
        Ok(())
    } else {
        Err(ApiError::bad_request(
            "Provide homework, classwork, or both.",
        ))
    }
}

/// Decodes a JSON body into `T`, turning a malformed body into a clean 400.
pub fn json_body<T: DeserializeOwned>(
    body: &axum::body::Bytes,
    expect: &str,
) -> Result<T, ApiError> {
    serde_json::from_slice(body).map_err(|_| ApiError::bad_request(expect.to_owned()))
}

/// Attachment metadata, after validation.
///
/// There is no upload in this phase: no bytes are read, nothing is written to a
/// filesystem, and no URL is invented. `storage_key` is a caller-supplied key
/// that a future storage service resolves, so validating it means "a bounded,
/// non-blank string" and nothing more.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedAttachment {
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub storage_key: String,
}

/// Validates one declared attachment, and the list length around it.
///
/// A blank filename, MIME type or storage key is a 400 rather than a default: each
/// is something a real client must decide, and filling one in server-side would
/// invent file identity. `size_bytes` must be non-negative and within
/// [`MAX_ATTACHMENT_BYTES`], which matches the R2 `CHECK (size_bytes >= 0)`.
pub fn attachment_list(
    inputs: Vec<crate::api::AttachmentInput>,
) -> Result<Vec<ValidatedAttachment>, ApiError> {
    if inputs.len() > MAX_ATTACHMENTS {
        return Err(field(
            "attachments",
            &format!("at most {MAX_ATTACHMENTS} items"),
        ));
    }
    inputs
        .into_iter()
        .map(|input| {
            Ok(ValidatedAttachment {
                filename: text_body(&input.filename, "attachments[].filename", 255)?,
                mime_type: text_body(&input.mime_type, "attachments[].mimeType", 255)?,
                size_bytes: match input.size_bytes {
                    n if (0..=MAX_ATTACHMENT_BYTES).contains(&n) => n,
                    _ => Err(field(
                        "attachments[].sizeBytes",
                        &format!("between 0 and {MAX_ATTACHMENT_BYTES}"),
                    ))?,
                },
                storage_key: text_body(&input.storage_key, "attachments[].storageKey", 1024)?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_dates_are_strict_and_calendar_real() {
        assert_eq!(
            CalendarDate::parse("2026-10-05"),
            Some(CalendarDate {
                year: 2026,
                month: 10,
                day: 5
            })
        );
        assert_eq!(
            CalendarDate::parse("2024-02-29")
                .map(|d| d.to_iso())
                .as_deref(),
            Some("2024-02-29")
        );
        assert_eq!(
            CalendarDate::parse("2026-02-29"),
            None,
            "2026 is not a leap year"
        );
        assert_eq!(CalendarDate::parse("2025-02-29"), None);
        assert_eq!(CalendarDate::parse("2026-04-31"), None);
        assert_eq!(CalendarDate::parse("2026-13-01"), None);
        assert_eq!(CalendarDate::parse("2026-00-10"), None);
        assert_eq!(CalendarDate::parse("2026-10-00"), None);

        // The formats the old system actually stored must all be refused.
        for legacy in [
            "Jul 23, 2026",
            "today",
            "yesterday",
            "23/07/2026",
            "2026-7-5",
            "2026-10-05T00:00:00.000Z",
            "",
            "20261005",
        ] {
            assert!(
                CalendarDate::parse(legacy).is_none(),
                "{legacy:?} must be refused"
            );
        }
    }

    #[test]
    fn display_dates_match_the_shape_the_cards_show_today() {
        assert_eq!(
            CalendarDate::parse("2026-10-05").unwrap().to_display(),
            "Oct 5, 2026"
        );
        assert_eq!(
            CalendarDate::parse("2026-07-23").unwrap().to_display(),
            "Jul 23, 2026"
        );
        assert_eq!(
            CalendarDate::parse("2026-12-31").unwrap().to_display(),
            "Dec 31, 2026"
        );
    }

    #[test]
    fn iso_round_trips_through_display() {
        for iso in ["2026-01-01", "2026-09-30", "2024-02-29"] {
            let date = CalendarDate::parse(iso).unwrap();
            assert_eq!(date.to_iso(), iso);
        }
    }

    #[test]
    fn path_ids_must_be_positive_integers() {
        assert_eq!(path_id("42").unwrap(), 42);
        for bad in ["0", "-1", "abc", "4.2", "", " 4", "1e3"] {
            assert!(path_id(bad).is_err(), "{bad:?} must be refused");
        }
    }

    fn params(pairs: &[(&str, &str)]) -> Params {
        pairs
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect()
    }

    #[test]
    fn limits_are_bounded_on_both_sides() {
        let q = params(&[("limit", "10")]);
        assert_eq!(query_limit(&q).unwrap(), Some(10));
        assert_eq!(query_limit(&params(&[])).unwrap(), None);
        for bad in [
            "0",
            "-5",
            "many",
            &MAX_LIMIT.to_string().replace("500", "501"),
        ] {
            assert!(
                query_limit(&params(&[("limit", bad)])).is_err(),
                "{bad:?} must be refused"
            );
        }
        assert_eq!(
            query_limit(&params(&[("limit", &MAX_LIMIT.to_string())])).unwrap(),
            Some(MAX_LIMIT)
        );
    }

    #[test]
    fn an_inverted_range_is_rejected() {
        assert!(check_range(Some("2026-10-01"), Some("2026-10-05")).is_ok());
        assert!(check_range(Some("2026-10-05"), Some("2026-10-05")).is_ok());
        assert!(check_range(None, Some("2026-10-05")).is_ok());
        assert!(check_range(Some("2026-10-06"), Some("2026-10-05")).is_err());
    }

    #[test]
    fn text_bodies_are_trimmed_bounded_and_never_empty() {
        assert_eq!(text_body("  hi  ", "note", 10).unwrap(), "hi");
        assert!(text_body("   ", "note", 10).is_err());
        assert!(text_body(&"x".repeat(11), "note", 10).is_err());
        // Length is counted in characters, not bytes, so a non-Latin note is not
        // penalised for its encoding.
        assert_eq!(text_body("ਪੰਜਾਬੀ", "note", 6).unwrap(), "ਪੰਜਾਬੀ");
    }

    #[test]
    fn an_optional_text_body_is_absent_rather_than_an_error_when_blank() {
        assert_eq!(optional_text_body(None, "homework", 10).unwrap(), None);
        assert_eq!(optional_text_body(Some(""), "homework", 10).unwrap(), None);
        assert_eq!(
            optional_text_body(Some("   "), "homework", 10).unwrap(),
            None
        );
        assert_eq!(
            optional_text_body(Some("  Chapter 1  "), "homework", 20).unwrap(),
            Some("Chapter 1".into())
        );
        assert!(optional_text_body(Some(&"x".repeat(11)), "homework", 10).is_err());
    }

    #[test]
    fn trimming_the_ends_leaves_the_interior_exactly_as_written() {
        // The ends go; everything between them survives byte for byte. A teacher
        // pasting a table or an intentionally odd spacing must get it back.
        let typed = "  Q1.  Read  pages\n10-20\n\n\tQ2.  Exercises 3 and 4.  ";
        assert_eq!(
            optional_text_body(Some(typed), "homework", 200).unwrap(),
            Some("Q1.  Read  pages\n10-20\n\n\tQ2.  Exercises 3 and 4.".into())
        );
    }

    #[test]
    fn an_entry_needs_at_least_one_half() {
        assert!(require_content(Some("Chapter 1"), None).is_ok());
        assert!(require_content(None, Some("Exercise 6.1")).is_ok());
        assert!(require_content(Some("a"), Some("b")).is_ok());
        assert!(require_content(None, None).is_err());
        assert!(require_content(Some("   "), None).is_err());
        assert!(require_content(Some("  "), Some("  ")).is_err());
    }

    fn attachment(filename: &str, mime: &str, size: i64, key: &str) -> crate::api::AttachmentInput {
        crate::api::AttachmentInput {
            filename: filename.into(),
            mime_type: mime.into(),
            size_bytes: size,
            storage_key: key.into(),
        }
    }

    #[test]
    fn attachment_metadata_is_validated_and_never_invents_a_default() {
        let ok = attachment_list(vec![attachment(
            "worksheet.pdf",
            "application/pdf",
            204_800,
            "homework/2026/10/worksheet.pdf",
        )])
        .unwrap();
        assert_eq!(
            ok,
            vec![ValidatedAttachment {
                filename: "worksheet.pdf".into(),
                mime_type: "application/pdf".into(),
                size_bytes: 204_800,
                storage_key: "homework/2026/10/worksheet.pdf".into(),
            }]
        );

        // A blank field is refused rather than filled in: the server has no
        // legitimate default for a file's identity.
        for bad in [
            attachment("  ", "application/pdf", 10, "k"),
            attachment("f.pdf", "  ", 10, "k"),
            attachment("f.pdf", "application/pdf", 10, "   "),
        ] {
            assert!(
                attachment_list(vec![bad.clone()]).is_err(),
                "{bad:?} must be refused"
            );
        }
        // A negative size would fail the R2 CHECK; refuse it as a 400 instead.
        assert!(attachment_list(vec![attachment("f.pdf", "application/pdf", -1, "k")]).is_err());
        assert!(attachment_list(vec![attachment(
            "f.pdf",
            "application/pdf",
            MAX_ATTACHMENT_BYTES + 1,
            "k"
        )])
        .is_err());
        // More files than a request should ever declare.
        let many: Vec<_> = (0..MAX_ATTACHMENTS + 1)
            .map(|i| attachment("f.pdf", "application/pdf", 1, &format!("k{i}")))
            .collect();
        assert!(attachment_list(many).is_err());
    }
}
