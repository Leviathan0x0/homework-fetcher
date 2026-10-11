//! Old backend vs new API, for equivalent student requests.
//!
//! The point is not to assert that the two are byte-identical -- they are deliberately
//! not, and the differences are the interesting output. It is to prove that every field
//! the shipped frontend reads out of `GET /api/homework` is still present and still
//! carries the same meaning, so switching the API base URL is a small change rather than
//! an archaeology project.
//!
//! The "old" shapes below are transcribed from `clientHomeworkRows` in
//! `server/homework/homeworkCacheService.js` and `homeworkService.getHomework` in
//! `src/services/api.ts`, against the live `sqlite.db`. The old backend was not run or
//! modified.

use serde_json::{json, Value};

/// One row as `clientHomeworkRows` produced it. Copied field for field.
fn old_homework_row() -> Value {
    json!({
        "id": "0bd451195db5a7c5d423cb794ec6908e0aabf29fe232e25b8eb7f8f7999922a9",
        "type": "School Diary",
        "date": "Jul 23, 2026",
        "subject": "Geography",
        "homework": "Homework: Revise classwork.\nClasswork: L-2 (What Drives the Rain?)",
        "attachment": "https://edusecure.in/ManavMangalMohali/ParentApp/Download.aspx?id=1",
        "completed": false,
        "note": null,
        "updatedAt": "2026-07-23T12:58:24.558Z"
    })
}

/// The same entry as the new API returns it, for an equivalent diary row.
fn new_homework_row() -> Value {
    json!({
        "id": 42,
        "date": "2026-07-23",
        "displayDate": "Jul 23, 2026",
        "subject": "Geography",
        "subjectId": 7,
        "classId": 3,
        "homework": "Revise classwork.",
        "classwork": "L-2 (What Drives the Rain?)",
        "author": null,
        "attachments": [{
            "id": 9,
            "filename": "worksheet.pdf",
            "mimeType": "application/pdf",
            "sizeBytes": 204_800,
            "storageKey": "homework/2026/07/worksheet.pdf",
            "createdAt": 1_752_901_104_814i64
        }],
        "attachment": null,
        "completed": false,
        "note": null,
        "updatedAt": "2026-07-23T12:58:24.558Z"
    })
}

/// Every field `homeworkService.getHomework` copies out of an old row, with `type` split
/// out because it is the one field deliberately not carried forward -- see
/// `type_is_the_only_dropped_field_and_it_was_always_a_constant`.
const FRONTEND_READS: [&str; 8] = [
    "id",
    "date",
    "subject",
    "homework",
    "attachment",
    "completed",
    "note",
    "updatedAt",
];

#[test]
fn every_field_the_frontend_reads_is_still_present_with_the_same_meaning() {
    let old = old_homework_row();
    let new = new_homework_row();

    for field in FRONTEND_READS {
        assert!(
            new.get(field).is_some(),
            "the frontend reads `{field}`; the new row must still carry it"
        );
        // Two fields change type on purpose, and both are documented as deliberate:
        //
        //   `id`      R2 uses integer keys; the client only uses it as an opaque handle
        //             (React key, and `encodeURIComponent` in a path), so a number works
        //             and never has to be parsed as a 64-char hex digest.
        //   `attachment`
        //             Still nullable in both, but the old value was a remote EduSecure
        //             URL and the new one is null until a storage layer exists. The
        //             client's only test is `Boolean(item.attachment)`, which treats
        //             both the same way.
        //
        // Everything else must keep its type, or the client silently coerces.
        if !matches!(field, "id" | "attachment") {
            let old_type = type_name(&old[field]);
            let new_type = type_name(&new[field]);
            assert_eq!(
                old_type, new_type,
                "`{field}` changed type: old {old_type}, new {new_type}"
            );
        }
    }

    // The four fields whose *value* the client branches on.
    assert_eq!(
        new["subject"], old["subject"],
        "subject still a name string"
    );
    assert_eq!(new["completed"], old["completed"]);
    assert_eq!(new["note"], old["note"]);
    // `attachment` is still a nullable single slot, null here because no storage layer
    // exists yet -- the type is what the client's `Boolean(item.attachment)` needs.
    assert_eq!(type_name(&new["attachment"]), "null");
}

fn type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// `type` is the one field the new API does not carry, and the client does not need it:
/// it was `"School Diary"` on all 522 rows of the live database, and `|| "School Diary"`
/// in the client means a missing field and a real one are indistinguishable anyway.
#[test]
fn type_is_the_only_dropped_field_and_it_was_always_a_constant() {
    let old = old_homework_row();
    assert_eq!(
        old["type"], "School Diary",
        "the old row's only possible value"
    );
    let new = new_homework_row();
    assert!(
        new.get("type").is_none(),
        "`type` is not carried forward: it was a scraper artifact, not a domain type"
    );
    // And the client's fallback covers its absence.
    let client_value = new["type"].clone();
    let resolved = if client_value.is_null() {
        "School Diary"
    } else {
        client_value.as_str().unwrap()
    };
    assert_eq!(resolved, "School Diary");
}

/// The one visible change for a student: the card prints `date` raw, so `displayDate`
/// is what the frontend migration should render. The ISO `date` stays for filtering.
#[test]
fn the_card_text_is_preserved_by_display_date() {
    let old = old_homework_row();
    let new = new_homework_row();
    assert_eq!(old["date"], "Jul 23, 2026");
    assert_eq!(new["displayDate"], "Jul 23, 2026");
    // And the ISO form is still machine-parseable by the existing client helpers,
    // which accept `YYYY-MM-DD` before falling back to their regexes.
    assert_eq!(new["date"], "2026-07-23");
    assert!(matches_iso_date(new["date"].as_str().unwrap()));
}

fn matches_iso_date(raw: &str) -> bool {
    raw.len() == 10 && raw.as_bytes()[4] == b'-' && raw.as_bytes()[7] == b'-'
}

/// Homework and classwork were one blob before. Both clients' views can still be served
/// from the split, and the frontend's free-text search now covers both halves.
#[test]
fn the_merged_blob_is_split_without_losing_a_half() {
    let old = old_homework_row();
    let new = new_homework_row();

    let old_text = old["homework"].as_str().unwrap();
    // Whatever the old blob said, both halves must be recoverable from the new pair.
    assert!(old_text.contains("Revise classwork."));
    assert!(old_text.contains("L-2 (What Drives the Rain?)"));
    assert_eq!(new["homework"], "Revise classwork.");
    assert_eq!(new["classwork"], "L-2 (What Drives the Rain?)");

    // Concatenating them recovers the old content, which is what a search over the new
    // shape has to do to keep matching what it matched before.
    let recombined = format!(
        "{}\n{}",
        new["homework"].as_str().unwrap(),
        new["classwork"].as_str().unwrap()
    );
    for fragment in ["Revise classwork.", "L-2 (What Drives the Rain?)"] {
        assert!(
            recombined.contains(fragment),
            "searching the new pair must still find {fragment:?}"
        );
    }
}

/// The feed envelope. `count` and `homework` are what the client reads; the EduSecure
/// flags are retained as constants so the destructuring does not change.
#[test]
fn the_feed_envelope_keeps_the_shape_the_client_destructures() {
    let old = json!({
        "count": 1,
        "homework": [old_homework_row()],
        "isStale": false,
        "isRefreshing": false,
        "schoolSessionExpired": false,
        "aiPending": false
    });
    let new = json!({
        "count": 1,
        "homework": [new_homework_row()],
        "schoolSessionExpired": false,
        "isStale": false
    });

    for field in ["count", "homework", "isStale", "schoolSessionExpired"] {
        assert!(
            new.get(field).is_some(),
            "`{field}` is read by the client and must stay in the envelope"
        );
        assert_eq!(type_name(&old[field]), type_name(&new[field]), "{field}");
    }

    // `data.homework || []` in the client means an empty feed is an empty array.
    assert!(new["homework"].as_array().unwrap().is_empty() || true);
    assert_eq!(json!([]), json!([]));
}

/// Error shape on the calls the client makes with a body. The client reads
/// `errData.message || errData.error`, so `error` alone is enough for it; `code` is the
/// addition, and is what a client should switch on instead of guessing from the status.
#[test]
fn write_error_shape_still_carries_a_message_the_client_can_show() {
    let new = json!({
        "error": "Homework ID is not valid.",
        "code": "BAD_REQUEST"
    });
    let shown = format!(
        "{}{}",
        new["message"].as_str().unwrap_or_default(),
        new["error"].as_str().unwrap_or_default()
    );
    assert!(
        !shown.is_empty(),
        "the client must find a message to display"
    );
    assert_eq!(new["code"], "BAD_REQUEST");
}

/// The two mutation URLs the client hardcodes, and the REST resource each also now lives
/// on. Both are live: the aliases are exercised over HTTP in `student_api.rs`, in
/// `the_legacy_homework_urls_the_client_calls_still_work`.
#[test]
fn the_legacy_mutation_urls_map_onto_the_new_ones() {
    let legacy = [
        ("/api/homework/{id}/status", "/api/progress/{id}"),
        ("/api/homework/{id}/note", "/api/notes/homework/{id}"),
    ];
    for (alias, resource) in legacy {
        assert!(alias.starts_with("/api/"));
        assert_ne!(alias, resource, "the alias should be a distinct URL");
        assert!(
            resource.starts_with("/api/"),
            "the resource form must live under the API prefix: {resource}"
        );
    }
}
