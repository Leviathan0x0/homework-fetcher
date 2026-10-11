//! Phase 6 hardening tests for the student-facing surfaces: notes, progress and
//! attachment metadata.
//!
//! R4 built these routes and R5 added the teacher that writes the homework they hang off.
//! This file is not a second pass over them -- it covers the seams between those phases
//! and the boundaries that are easy to regress because no single earlier test owns them:
//!
//!   * concurrency on the note upsert, which is the one place two requests from the same
//!     student legitimately race;
//!   * notes, progress and attachments reached through homework a *teacher* wrote, which
//!     is the whole point of R5 and had no coverage from the R4 side;
//!   * cascade behaviour when a teacher deletes that homework out from under a student;
//!   * cross-user and cross-class isolation across all three surfaces at once.
//!
//! Every request goes through `POST /api/auth/login` and carries the real cookie. Each
//! test gets a private temporary SQLite file. No real school credential appears anywhere.

use std::sync::atomic::{AtomicU32, Ordering};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use mmss_backend::config::Config;
use mmss_backend::cookies::SESSION_COOKIE;
use mmss_backend::models::{NewHomework, NewUser, Role};
use mmss_backend::repositories::{classes, homework, subjects, teacher_classes};
use mmss_backend::services::auth::AuthService;
use mmss_backend::state::AppState;
use serde_json::{json, Value};
use tower::ServiceExt;

static NEXT_ID: AtomicU32 = AtomicU32::new(0);

const STUDENT_PASSWORD: &str = "test-student-password";
const TEACHER_PASSWORD: &str = "test-teacher-password";
const ADMIN_PASSWORD: &str = "test-admin-password";

/// Two classes, one subject each, two students in the first class, one in the second, a
/// teacher assigned to both, and an admin.
struct World {
    app: axum::Router,
    db: sqlx::SqlitePool,
    own_class: i64,
    subject: i64,
    /// Entry in `own_class`, authored by the teacher. Created through the teacher API by
    /// the tests that need it to have come from HTTP.
    authored: i64,
    /// Entry in `other_class`, so cross-class paths have something to be refused for.
    foreign: i64,
    student_a: i64,
    student_b: i64,
}

async fn world(tag: &str) -> World {
    let unique = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "mmss-r6-test-{}-{tag}-{unique}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    let state = AppState::new(Config::for_tests(format!(
        "sqlite://{}/mmss.db",
        dir.display()
    )))
    .await
    .expect("startup against an empty directory should succeed");
    let db = state.db.clone();
    let auth = AuthService::new(&db, &state.config);

    let own_class = classes::create(&db, &mmss_backend::models::NewClass::new("9-F"))
        .await
        .unwrap();
    let other_class = classes::create(&db, &mmss_backend::models::NewClass::new("9-A"))
        .await
        .unwrap();
    let subject = subjects::create(&db, &mmss_backend::models::NewSubject::new("Mathematics"))
        .await
        .unwrap();

    async fn add_student(auth: &AuthService<'_>, school_id: &str, name: &str, class: i64) -> i64 {
        auth.create_user_with_password(
            &NewUser {
                school_id: school_id.into(),
                display_name: Some(name.into()),
                role: Role::Student,
                class_id: Some(class),
            },
            STUDENT_PASSWORD,
        )
        .await
        .unwrap()
        .user_id
    }

    let student_a = add_student(&auth, "student.a", "Student A", own_class.id).await;
    let student_b = add_student(&auth, "student.b", "Student B", own_class.id).await;
    // A student of the *other* class, so the cross-class tests sign in as a real user of that
    // class rather than as a student who is somehow in both.
    add_student(&auth, "student.outsider", "Outsider", other_class.id).await;

    let teacher = auth
        .create_user_with_password(
            &NewUser {
                school_id: "teacher.test".into(),
                display_name: Some("Test Teacher".into()),
                role: Role::Teacher,
                class_id: None,
            },
            TEACHER_PASSWORD,
        )
        .await
        .unwrap()
        .user_id;
    auth.create_user_with_password(
        &NewUser {
            school_id: "admin.test".into(),
            display_name: None,
            role: Role::Admin,
            class_id: None,
        },
        ADMIN_PASSWORD,
    )
    .await
    .unwrap();

    for class in [own_class.id, other_class.id] {
        teacher_classes::assign(&db, teacher, class).await.unwrap();
    }

    // Seeded directly rather than over HTTP, because the point of these tests is the
    // student surfaces hanging off homework, not the teacher create path. The teacher
    // journey itself is covered in `teacher_api.rs`.
    let authored = homework::create(
        &db,
        &NewHomework {
            class_id: own_class.id,
            subject_id: subject.id,
            author_id: Some(teacher),
            due_date: "2026-10-06".into(),
            homework_text: Some("Complete exercises 1-10".into()),
            classwork_text: Some("Chapter 4 examples".into()),
        },
    )
    .await
    .unwrap()
    .id;

    let foreign = homework::create(
        &db,
        &NewHomework {
            class_id: other_class.id,
            subject_id: subject.id,
            author_id: None,
            due_date: "2026-10-06".into(),
            homework_text: Some("Another class's private homework".into()),
            classwork_text: None,
        },
    )
    .await
    .unwrap()
    .id;

    World {
        app: mmss_backend::app(state),
        db,
        own_class: own_class.id,
        subject: subject.id,
        authored,
        foreign,
        student_a,
        student_b,
    }
}

// -------------------------------------------------------------------- helpers

async fn call(
    app: &axum::Router,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder().method(method).uri(path);
    if let Some(token) = token {
        builder = builder.header("cookie", format!("{SESSION_COOKIE}={token}"));
    }
    let request = match body {
        Some(value) => builder
            .header("content-type", "application/json")
            .body(Body::from(value.to_string()))
            .unwrap(),
        // The auth router refuses a state-changing request that does not declare
        // JSON (the CSRF guard), and the shipped client sends the header even with
        // no body -- so the harness does too.
        None if method != "GET" && method != "HEAD" => builder
            .header("content-type", "application/json")
            .body(Body::empty())
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    };
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or_else(|_| {
            panic!("response was not JSON: {}", String::from_utf8_lossy(&bytes))
        })
    };
    (status, value)
}

/// Signs in over HTTP and returns the session cookie value.
async fn sign_in(world: &World, school_id: &str, password: &str) -> String {
    let (status, body, headers) = {
        let builder = Request::builder()
            .method("POST")
            .uri("/api/auth/login")
            .header("content-type", "application/json")
            .body(Body::from(
                json!({ "studentId": school_id, "password": password }).to_string(),
            ))
            .unwrap();
        let response = world.app.clone().oneshot(builder).await.unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, body, headers)
    };
    assert_eq!(status, StatusCode::OK, "login failed: {body}");
    headers
        .get(axum::http::header::SET_COOKIE)
        .expect("login must set a cookie")
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .split_once('=')
        .unwrap()
        .1
        .to_owned()
}

async fn student_token(world: &World) -> String {
    sign_in(world, "student.a", STUDENT_PASSWORD).await
}

async fn other_student_token(world: &World) -> String {
    sign_in(world, "student.b", STUDENT_PASSWORD).await
}

async fn teacher_token(world: &World) -> String {
    sign_in(world, "teacher.test", TEACHER_PASSWORD).await
}

async fn admin_token(world: &World) -> String {
    sign_in(world, "admin.test", ADMIN_PASSWORD).await
}

/// Every student-facing route that takes an entry id, with the method that reaches it.
/// One list, so "this path is guarded" is a single fact rather than a claim repeated per
/// test.
fn entry_routes(id: &str) -> Vec<(&'static str, String)> {
    vec![
        ("GET", format!("/api/homework/{id}")),
        ("GET", format!("/api/homework/{id}/attachments")),
        ("GET", format!("/api/progress/{id}")),
        ("PATCH", format!("/api/progress/{id}")),
        ("GET", format!("/api/notes/homework/{id}")),
        ("POST", format!("/api/notes/homework/{id}")),
    ]
}

// ------------------------------------------------------------- concurrency

/// The regression test for the one race in these surfaces.
///
/// Two students tapping the same note field -- or a double submit, or a client retry --
/// issue concurrent upserts against the same `(user, homework)` unique index. A
/// read-then-write upsert lets both requests observe "no note yet" and both insert, so the
/// loser gets a constraint violation and a 500 for a request that was entirely valid.
/// This asserts every request succeeds and that the schema's one-note-per-entry promise
/// survives.
#[tokio::test]
async fn concurrent_note_edits_leave_exactly_one_row() {
    let world = world("concurrent-note").await;
    let token = student_token(&world).await;
    let path = format!("/api/notes/homework/{}", world.authored);

    let mut requests = Vec::new();
    for n in 0..8 {
        let app = world.app.clone();
        let token = token.clone();
        let path = path.clone();
        requests.push(async move {
            call(
                &app,
                "POST",
                &path,
                Some(&token),
                Some(json!({ "body": format!("attempt {n}") })),
            )
            .await
        });
    }
    let results = join_all(requests).await;

    for (status, body) in &results {
        assert_eq!(
            *status,
            StatusCode::OK,
            "a concurrent note write must not fail: {body}"
        );
    }
    // Exactly one note survives, and every response described that same row rather than
    // each caller believing it had created a new one.
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM notes WHERE homework_id = ?1")
        .bind(world.authored)
        .fetch_one(&world.db)
        .await
        .unwrap();
    assert_eq!(rows, 1, "the unique index must have held");

    let ids: std::collections::HashSet<i64> = results
        .iter()
        .map(|(_, body)| body["id"].as_i64().unwrap())
        .collect();
    assert_eq!(ids.len(), 1, "all writers must converge on one note");

    // And the list agrees with the table.
    let (status, body) = call(
        &world.app,
        "GET",
        &format!("/api/notes/homework/{}", world.authored),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 1);
}

/// `futures` is not a dependency of this crate, so this is a tiny `join_all`.
async fn join_all<F, T>(futures: Vec<F>) -> Vec<T>
where
    F: std::future::Future<Output = T> + Send + 'static,
    T: Send + 'static,
{
    let handles: Vec<_> = futures.into_iter().map(tokio::spawn).collect();
    let mut out = Vec::with_capacity(handles.len());
    for handle in handles {
        out.push(handle.await.unwrap());
    }
    out
}

// ------------------------------------------------- teacher -> student flow

/// The R6 headline: homework a teacher wrote, then everything a student does with it.
///
/// R5 proved a student can *read* teacher-authored homework. This proves the interactive
/// surfaces attach to it too -- a note, a tick, and attachment metadata -- because those
/// hang off `homework_id` rather than off authorship, and nothing had checked the three
/// layers together.
#[tokio::test]
async fn a_student_annotates_teacher_created_homework() {
    let world = world("teacher-flow").await;
    let token = student_token(&world).await;
    let teacher = teacher_token(&world).await;
    let hw = world.authored;

    // The teacher adds attachment metadata through the teacher API.
    let (status, created) = call(
        &world.app,
        "POST",
        "/api/teacher/homework",
        Some(&teacher),
        Some(json!({
            "classId": world.own_class,
            "subjectId": world.subject,
            "dueDate": "2026-10-09",
            "homework": "Exercise set 2",
            "attachments": [{
                "filename": "worksheet.pdf",
                "mimeType": "application/pdf",
                "sizeBytes": 4096,
                "storageKey": "homework/2026/10/09/worksheet.pdf",
            }],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let teacher_entry = created["id"].as_i64().unwrap();

    // The student sees both entries in their class feed, attributed to the teacher.
    let (status, feed) = call(&world.app, "GET", "/api/homework", Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    let items = feed["homework"].as_array().unwrap();
    let seen: Vec<i64> = items.iter().map(|i| i["id"].as_i64().unwrap()).collect();
    assert!(seen.contains(&hw) && seen.contains(&teacher_entry));

    let card = items
        .iter()
        .find(|i| i["id"].as_i64() == Some(teacher_entry))
        .unwrap();
    assert_eq!(card["subject"], "Mathematics");
    assert_eq!(card["author"]["displayName"], "Test Teacher");
    assert_eq!(card["attachments"].as_array().unwrap().len(), 1);
    assert_eq!(card["attachments"][0]["filename"], "worksheet.pdf");

    // Note, tick, and both show up on the student-facing surfaces and back in the feed.
    let (status, note) = call(
        &world.app,
        "POST",
        &format!("/api/notes/homework/{teacher_entry}"),
        Some(&token),
        Some(json!({ "body": "Finished the odd numbers" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{note}");
    assert_eq!(note["homeworkId"], teacher_entry);

    let (status, progress) = call(
        &world.app,
        "PATCH",
        &format!("/api/progress/{teacher_entry}"),
        Some(&token),
        Some(json!({ "completed": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{progress}");
    assert_eq!(progress["completed"], true);

    let (status, feed) = call(&world.app, "GET", "/api/homework", Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    let card = feed["homework"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["id"].as_i64() == Some(teacher_entry))
        .unwrap();
    assert_eq!(card["completed"], true);
    assert_eq!(card["note"], "Finished the odd numbers");
}

/// A teacher deleting their own entry must take the student's note and tick with it.
///
/// The R2 schema says `ON DELETE CASCADE`, and `data_layer.rs` asserts it. What no test
/// owned was the ordering across phases: that the rows a *student* wrote through the R4
/// routes actually disappear when an *R5* teacher deletes. A student must not be left
/// holding a note pointing at a homework id that no longer exists.
#[tokio::test]
async fn a_teacher_deleting_homework_cascades_to_student_rows() {
    let world = world("cascade").await;
    let token = student_token(&world).await;
    let teacher = teacher_token(&world).await;
    let hw = world.authored;

    call(
        &world.app,
        "POST",
        &format!("/api/notes/homework/{hw}"),
        Some(&token),
        Some(json!({ "body": "note on teacher homework" })),
    )
    .await;
    call(
        &world.app,
        "PATCH",
        &format!("/api/progress/{hw}"),
        Some(&token),
        Some(json!({ "completed": true })),
    )
    .await;

    async fn dependent_counts(db: &sqlx::SqlitePool, hw: i64) -> (i64, i64) {
        let note: i64 = sqlx::query_scalar("SELECT count(*) FROM notes WHERE homework_id = ?1")
            .bind(hw)
            .fetch_one(db)
            .await
            .unwrap();
        let progress: i64 =
            sqlx::query_scalar("SELECT count(*) FROM homework_progress WHERE homework_id = ?1")
                .bind(hw)
                .fetch_one(db)
                .await
                .unwrap();
        (note, progress)
    }
    assert_eq!(
        dependent_counts(&world.db, hw).await,
        (1, 1),
        "both rows exist first"
    );

    let (status, body) = call(
        &world.app,
        "DELETE",
        &format!("/api/teacher/homework/{hw}"),
        Some(&teacher),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    assert_eq!(
        dependent_counts(&world.db, hw).await,
        (0, 0),
        "dependent student rows must cascade, not linger"
    );

    // And the student's own routes agree the entry is gone, rather than leaving a stale
    // note or tick attached to an id that no longer resolves.
    let (status, _) = call(
        &world.app,
        "GET",
        &format!("/api/homework/{hw}"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = call(
        &world.app,
        "GET",
        &format!("/api/notes/homework/{hw}"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ------------------------------------------------------------- isolation

/// Cross-user: a student's note and tick are theirs, and knowing an id is not enough.
///
/// Notes are addressed by their own id on `PATCH`/`DELETE`, which is the only place in
/// these three surfaces where a caller supplies a foreign key rather than having one
/// derived. Both answers are 404 rather than 403, because confirming that the id belongs
/// to somebody else is itself a disclosure about another account.
#[tokio::test]
async fn one_student_cannot_reach_anothers_notes_or_progress() {
    let world = world("cross-user").await;
    let a = student_token(&world).await;
    let b = other_student_token(&world).await;

    let (status, note) = call(
        &world.app,
        "POST",
        &format!("/api/notes/homework/{}", world.authored),
        Some(&a),
        Some(json!({ "body": "student A private note" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{note}");
    let note_id = note["id"].as_i64().unwrap();

    // A personal note has no entry at all, which is a different thing from a note on one.
    let (status, personal) = call(
        &world.app,
        "POST",
        "/api/notes",
        Some(&a),
        Some(json!({ "body": "remember the lab sheets" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{personal}");
    assert_eq!(personal["homeworkId"], Value::Null);

    // B cannot read, edit or delete A's note by id.
    for (method, path, body) in [
        ("GET", format!("/api/notes/{note_id}"), None),
        (
            "PATCH",
            format!("/api/notes/{note_id}"),
            Some(json!({ "body": "hijacked" })),
        ),
        ("DELETE", format!("/api/notes/{note_id}"), None),
    ] {
        // `GET /api/notes/{id}` is not a route at all, so only the two real mutations are
        // asserted; the read is covered by the list assertions below.
        if method == "GET" {
            continue;
        }
        let (status, body_out) = call(&world.app, method, &path, Some(&b), body).await;
        assert_eq!(
            status,
            StatusCode::NOT_FOUND,
            "{method} {path} must not reach another student's note: {body_out}"
        );
    }

    // A's notes are intact and unchanged.
    let (status, list) = call(&world.app, "GET", "/api/notes", Some(&a), None).await;
    assert_eq!(status, StatusCode::OK);
    let bodies: Vec<&str> = list
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["body"].as_str().unwrap())
        .collect();
    assert!(bodies.contains(&"student A private note"), "{bodies:?}");
    assert!(bodies.contains(&"remember the lab sheets"), "{bodies:?}");

    // B's own list is empty: ownership is not inherited from the shared class.
    let (status, list) = call(&world.app, "GET", "/api/notes", Some(&b), None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(list.as_array().unwrap().is_empty(), "{list}");

    // Progress: A ticked it, B never did. B asking gets the not-completed answer, not A's.
    call(
        &world.app,
        "PATCH",
        &format!("/api/progress/{}", world.authored),
        Some(&a),
        Some(json!({ "completed": true })),
    )
    .await;
    let (status, seen_by_a) = call(
        &world.app,
        "GET",
        &format!("/api/progress/{}", world.authored),
        Some(&a),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(seen_by_a["completed"], true);

    let (status, seen_by_b) = call(
        &world.app,
        "GET",
        &format!("/api/progress/{}", world.authored),
        Some(&b),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        seen_by_b["completed"], false,
        "one student's tick must not become another's"
    );

    let (status, list) = call(&world.app, "GET", "/api/progress", Some(&b), None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(list.as_array().unwrap().is_empty(), "{list}");
}

/// Cross-class: an entry from another class is invisible on all three surfaces.
///
/// A student of class 9-F learns nothing about class 9-A -- not the entry, not its note,
/// not its tick, not its attachment metadata -- and every refusal is the same 404 the
/// nonexistent entry gets, so the routes cannot be used to probe for another class's work.
#[tokio::test]
async fn another_classes_homework_is_invisible_on_every_surface() {
    let world = world("cross-class").await;
    let token = student_token(&world).await;
    let foreign = world.foreign.to_string();

    for (method, path) in entry_routes(&foreign) {
        let body = match (method, path.as_str()) {
            ("PATCH", p) if p.contains("/progress/") => Some(json!({ "completed": true })),
            ("POST", p) if p.contains("/notes/homework/") => {
                Some(json!({ "body": "should never be stored" }))
            }
            _ => None,
        };
        let (status, out) = call(&world.app, method, &path, Some(&token), body).await;
        assert_eq!(
            status,
            StatusCode::NOT_FOUND,
            "{method} {path} must be a 404 for another class's entry: {out}"
        );
    }

    // The refused writes left nothing behind.
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM notes WHERE homework_id = ?1")
        .bind(world.foreign)
        .fetch_one(&world.db)
        .await
        .unwrap();
    assert_eq!(rows, 0, "a refused note write must not persist");
    let rows: i64 =
        sqlx::query_scalar("SELECT count(*) FROM homework_progress WHERE homework_id = ?1")
            .bind(world.foreign)
            .fetch_one(&world.db)
            .await
            .unwrap();
    assert_eq!(rows, 0, "a refused tick must not persist");
}

// ---------------------------------------------------------- role boundaries

/// Anonymous is 401 and a signed-in non-student is 403, on every surface.
#[tokio::test]
async fn these_surfaces_require_a_student() {
    let world = world("roles").await;
    let teacher = teacher_token(&world).await;
    let admin = admin_token(&world).await;
    let hw = world.authored.to_string();

    let mut paths: Vec<(&str, String, Option<Value>)> = vec![
        ("GET", "/api/notes".into(), None),
        ("POST", "/api/notes".into(), Some(json!({ "body": "x" }))),
        ("GET", format!("/api/notes/homework/{hw}"), None),
        (
            "POST",
            format!("/api/notes/homework/{hw}"),
            Some(json!({ "body": "x" })),
        ),
        ("GET", "/api/progress".into(), None),
        ("GET", format!("/api/progress/{hw}"), None),
        (
            "PATCH",
            format!("/api/progress/{hw}"),
            Some(json!({ "completed": true })),
        ),
        ("GET", format!("/api/homework/{hw}"), None),
        ("GET", format!("/api/homework/{hw}/attachments"), None),
    ];

    // And the id-addressed note mutations, which take a note id rather than an entry id.
    let (status, note) = call(
        &world.app,
        "POST",
        &format!("/api/notes/homework/{hw}"),
        Some(&sign_in(&world, "student.a", STUDENT_PASSWORD).await),
        Some(json!({ "body": "for the id-addressed routes" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{note}");
    let note_id = note["id"].as_i64().unwrap();
    paths.push((
        "PATCH",
        format!("/api/notes/{note_id}"),
        Some(json!({ "body": "x" })),
    ));
    paths.push(("DELETE", format!("/api/notes/{note_id}"), None));

    for (method, path, body) in paths {
        let (status, _) = call(&world.app, method, &path, None, body.clone()).await;
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "anonymous {method} {path}"
        );

        let (status, out) = call(&world.app, method, &path, Some(&teacher), body.clone()).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "teacher {method} {path} must not reach a student surface: {out}"
        );

        // An admin is not a superuser over the student API either. R5 grants an admin the
        // *teacher* surfaces deliberately, so letting an admin also answer as a student
        // would blur two roles the brief asks to keep distinct -- and would silently give
        // an admin read access to a private note.
        let (status, out) = call(&world.app, method, &path, Some(&admin), body).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "admin {method} {path} must not reach a student surface: {out}"
        );
    }
}

// ------------------------------------------------------- malformed input

/// A malformed id is a 400 everywhere it is accepted, never a 500 and never a wildcard
/// that happens to match something.
///
/// This is the shape of a probing attempt: `abc`, a negative, a float, an empty segment
/// and a path-traversal-ish value must all be refused identically.
#[tokio::test]
async fn malformed_identifiers_are_refused_on_every_surface() {
    let world = world("malformed").await;
    let token = student_token(&world).await;

    // Percent-encoded and whitespace-padded ids are deliberately absent: they are not
    // legal URI characters, so the request never reaches the router and there is nothing
    // for the API to answer. Every value here does reach the handler.
    //
    // `"+4"` is absent too, and for a different reason: `validate::path_id` delegates to
    // `i64::from_str`, which accepts a leading `+`, so `+4` is a well-formed id 4 and is
    // answered 404 rather than 400. That is correct behaviour, not a gap -- it resolves
    // to exactly the id the caller named.
    for bad in [
        "abc",
        "-1",
        "0",
        "1.5",
        "1e3",
        "0x10",
        "1,2",
        "9999999999999999999999",
    ] {
        for (method, path) in entry_routes(bad) {
            let body = match (method, path.as_str()) {
                ("PATCH", p) if p.contains("/progress/") => Some(json!({ "completed": true })),
                ("POST", p) if p.contains("/notes/homework/") => Some(json!({ "body": "x" })),
                _ => None,
            };
            let (status, out) = call(&world.app, method, &path, Some(&token), body).await;
            assert_eq!(
                status,
                StatusCode::BAD_REQUEST,
                "{method} {path} with id {bad:?} must be a clean 400, got {out}"
            );
        }
        // The id-addressed note routes too.
        for (method, path) in [
            ("PATCH", format!("/api/notes/{bad}")),
            ("DELETE", format!("/api/notes/{bad}")),
        ] {
            let (status, out) = call(
                &world.app,
                method,
                &path,
                Some(&token),
                if method == "PATCH" {
                    Some(json!({ "body": "x" }))
                } else {
                    None
                },
            )
            .await;
            assert_eq!(
                status,
                StatusCode::BAD_REQUEST,
                "{method} {path} with id {bad:?} must be a clean 400, got {out}"
            );
        }
    }
}

/// Malformed and out-of-contract bodies are refused before anything is written.
#[tokio::test]
async fn malformed_bodies_are_refused_rather_than_stored() {
    let world = world("bodies").await;
    let token = student_token(&world).await;
    let hw = world.authored.to_string();

    let cases = [
        (
            format!("/api/notes/homework/{hw}"),
            json!({}),
            "a note with no body",
        ),
        (
            format!("/api/notes/homework/{hw}"),
            json!({ "body": "   " }),
            "a whitespace-only note",
        ),
        (
            format!("/api/notes/homework/{hw}"),
            json!({ "body": 42 }),
            "a non-string body",
        ),
        (
            "/api/notes".into(),
            json!({ "body": "" }),
            "an empty personal note",
        ),
    ];

    for (path, body, what) in cases {
        let (status, out) = call(&world.app, "POST", &path, Some(&token), Some(body)).await;
        assert_eq!(
            status,
            StatusCode::BAD_REQUEST,
            "{what} must be a 400: {out}"
        );
    }

    // A tick is a PATCH, and a malformed body is refused before anything is written.
    for (body, what) in [
        (json!({}), "a tick with no flag"),
        (json!({ "completed": "yes" }), "a non-boolean flag"),
        (json!({ "completed": null }), "a null flag"),
    ] {
        let (status, out) = call(
            &world.app,
            "PATCH",
            &format!("/api/progress/{hw}"),
            Some(&token),
            Some(body),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::BAD_REQUEST,
            "{what} must be a 400: {out}"
        );
    }

    // An unrecognised field is ignored rather than rejected, which is ordinary lenient
    // JSON parsing and not a hole: there is no `userId` on the contract, so the extra key
    // has nothing to bind to. What matters is that the write still lands on the
    // authenticated student and cannot be redirected onto the one named in the body.
    let (status, out) = call(
        &world.app,
        "PATCH",
        &format!("/api/progress/{hw}"),
        Some(&token),
        Some(json!({ "completed": true, "userId": world.student_b })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{out}");
    let owners: Vec<i64> =
        sqlx::query_scalar("SELECT user_id FROM homework_progress WHERE homework_id = ?1")
            .bind(world.authored)
            .fetch_all(&world.db)
            .await
            .unwrap();
    assert_eq!(
        owners,
        vec![world.student_a],
        "a forged userId must not redirect the write"
    );

    // Exactly one progress row exists: the deliberate tick above. Every malformed body was
    // refused before the write, so none of them produced one.
    let progress_rows: i64 = sqlx::query_scalar("SELECT count(*) FROM homework_progress")
        .fetch_one(&world.db)
        .await
        .unwrap();
    assert_eq!(
        progress_rows, 1,
        "only the deliberate tick should exist; a malformed body left nothing"
    );
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM notes")
        .fetch_one(&world.db)
        .await
        .unwrap();
    assert_eq!(rows, 0, "no malformed note body may leave a row behind");
}

// --------------------------------------------------------- lifecycle detail

/// The note on an entry is an upsert: a second write replaces rather than duplicates, and
/// the creation time does not move, so it stays an edit.
#[tokio::test]
async fn editing_a_note_in_place_does_not_create_a_second_one() {
    let world = world("note-upsert").await;
    let token = student_token(&world).await;
    let hw = world.authored.to_string();

    let (status, first) = call(
        &world.app,
        "POST",
        &format!("/api/notes/homework/{hw}"),
        Some(&token),
        Some(json!({ "body": "first" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first}");

    let (status, second) = call(
        &world.app,
        "POST",
        &format!("/api/notes/homework/{hw}"),
        Some(&token),
        Some(json!({ "body": "second" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{second}");
    assert_eq!(second["id"], first["id"], "the note id must not change");
    assert_eq!(second["body"], "second");
    assert_eq!(
        second["createdAt"], first["createdAt"],
        "an edit, not a new note"
    );

    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM notes WHERE homework_id = ?1")
        .bind(world.authored)
        .fetch_one(&world.db)
        .await
        .unwrap();
    assert_eq!(rows, 1);
}

/// Ticking twice is idempotent, unticking reverses it, and a student keeps exactly one row
/// per entry however many times they press the box.
#[tokio::test]
async fn ticking_is_idempotent_and_reversible() {
    let world = world("progress-cycle").await;
    let token = student_token(&world).await;
    let hw = world.authored.to_string();

    for completed in [true, true, false, true, false] {
        let (status, body) = call(
            &world.app,
            "PATCH",
            &format!("/api/progress/{hw}"),
            Some(&token),
            Some(json!({ "completed": completed })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["completed"], completed);
    }

    let rows: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM homework_progress WHERE user_id = ?1 AND homework_id = ?2",
    )
    .bind(world.student_a)
    .bind(world.authored)
    .fetch_one(&world.db)
    .await
    .unwrap();
    assert_eq!(rows, 1, "repeated ticks must not accumulate rows");

    let (status, final_state) = call(
        &world.app,
        "GET",
        &format!("/api/progress/{hw}"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(final_state["completed"], false);
}

/// Deleting a note is the student's own business and is idempotent in the sense that a
/// second delete is a 404.
#[tokio::test]
async fn a_deleted_note_is_gone_and_a_second_delete_is_a_404() {
    let world = world("note-delete").await;
    let token = student_token(&world).await;

    let (status, note) = call(
        &world.app,
        "POST",
        "/api/notes",
        Some(&token),
        Some(json!({ "body": "temporary" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{note}");
    let id = note["id"].as_i64().unwrap();

    let (status, _) = call(
        &world.app,
        "DELETE",
        &format!("/api/notes/{id}"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, out) = call(
        &world.app,
        "DELETE",
        &format!("/api/notes/{id}"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{out}");

    // Patching it is a 404 too, and left nothing to write.
    let (status, _) = call(
        &world.app,
        "PATCH",
        &format!("/api/notes/{id}"),
        Some(&token),
        Some(json!({ "body": "resurrect" })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

/// Attachment metadata is reachable through teacher-written homework and carries no bytes.
#[tokio::test]
async fn attachment_metadata_is_reachable_and_holds_no_bytes() {
    let world = world("attachments").await;
    let token = student_token(&world).await;
    let teacher = teacher_token(&world).await;

    let (status, created) = call(
        &world.app,
        "POST",
        "/api/teacher/homework",
        Some(&teacher),
        Some(json!({
            "classId": world.own_class,
            "subjectId": world.subject,
            "dueDate": "2026-10-12",
            "classwork": "Read pages 40-52",
            "attachments": [
                {
                    "filename": "diagram.png",
                    "mimeType": "image/png",
                    "sizeBytes": 2048,
                    "storageKey": "homework/2026/10/12/diagram.png",
                },
                {
                    "filename": "notes.txt",
                    "mimeType": "text/plain",
                    "sizeBytes": 12,
                    "storageKey": "homework/2026/10/12/notes.txt",
                },
            ],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let id = created["id"].as_i64().unwrap();

    let (status, list) = call(
        &world.app,
        "GET",
        &format!("/api/homework/{id}/attachments"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let items = list.as_array().unwrap();
    assert_eq!(items.len(), 2, "{items:?}");
    assert_eq!(items[0]["filename"], "diagram.png");
    assert_eq!(items[1]["storageKey"], "homework/2026/10/12/notes.txt");

    // Metadata only: no data/blob/content column exists to leak a URL or base64 payload
    // through, and nothing in the response is one.
    let columns: Vec<String> =
        sqlx::query_scalar("SELECT name FROM pragma_table_info('attachments')")
            .fetch_all(&world.db)
            .await
            .unwrap();
    for forbidden in ["data", "content", "blob", "bytes", "url"] {
        assert!(
            !columns.iter().any(|c| c == forbidden),
            "attachments must not grow a {forbidden} column: {columns:?}"
        );
    }
    let rendered = list.to_string();
    assert!(!rendered.contains("base64"), "{rendered}");
    assert!(!rendered.contains("data:"), "{rendered}");
}

/// A student in another class cannot reach attachments through the teacher API either.
/// The teacher routes are not a way around the student class boundary, because the
/// attachment surface is reached by homework id and the homework id is class-scoped.
#[tokio::test]
async fn an_out_of_class_student_sees_no_attachments() {
    let world = world("attachments-class").await;
    let outsider = sign_in(&world, "student.outsider", STUDENT_PASSWORD).await;

    let (status, out) = call(
        &world.app,
        "GET",
        &format!("/api/homework/{}/attachments", world.authored),
        Some(&outsider),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{out}");
}
