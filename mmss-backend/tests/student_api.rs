//! Integration tests for the student API, over the real Axum router with the real
//! R3 session system.
//!
//! Every request in this file goes through `POST /api/auth/login` and carries the cookie
//! the server set. Nothing bypasses authentication, because the interesting failures in
//! this layer are all about whether the *session* is scoped correctly, and a test that
//! injects a principal directly cannot see those.
//!
//! Each test gets a private temporary SQLite file, created through the normal startup
//! path so migrations really run. No real school credential appears anywhere.

use std::sync::atomic::{AtomicU32, Ordering};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use mmss_backend::config::Config;
use mmss_backend::cookies::SESSION_COOKIE;
use mmss_backend::models::{NewAttachment, NewHomework, NewUser, Role};
use mmss_backend::repositories::{attachments, classes, homework, subjects};
use mmss_backend::services::auth::AuthService;
use mmss_backend::state::AppState;
use serde_json::{json, Value};
use tower::ServiceExt;

static NEXT_ID: AtomicU32 = AtomicU32::new(0);

const STUDENT_PASSWORD: &str = "test-student-password";
const OTHER_PASSWORD: &str = "test-other-password";
const TEACHER_PASSWORD: &str = "test-teacher-password";
const ADMIN_PASSWORD: &str = "test-admin-password";

/// A class, two of its subjects, four entries, one with attachments.
struct World {
    app: axum::Router,
    db: sqlx::SqlitePool,
    own_class: i64,
    other_class: i64,
    mathematics: i64,
    physics: i64,
    student_a: i64,
    student_b: i64,
    /// Entries belonging to `own_class`, oldest first.
    feed: Vec<i64>,
    /// One entry in `other_class`.
    foreign: i64,
    teacher: i64,
    admin: i64,
    classless: i64,
    attachment_id: i64,
    /// An entry in `own_class` written by the teacher.
    authored: i64,
}

async fn world(tag: &str) -> World {
    let unique = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "mmss-student-test-{}-{tag}-{unique}",
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
    let mathematics = subjects::create(&db, &mmss_backend::models::NewSubject::new("Mathematics"))
        .await
        .unwrap();
    let physics = subjects::create(&db, &mmss_backend::models::NewSubject::new("Physics"))
        .await
        .unwrap();

    let student_a = auth
        .create_user_with_password(
            &NewUser {
                school_id: "student.a".into(),
                display_name: Some("Student A".into()),
                role: Role::Student,
                class_id: Some(own_class.id),
            },
            STUDENT_PASSWORD,
        )
        .await
        .unwrap()
        .user_id;
    let student_b = auth
        .create_user_with_password(
            &NewUser {
                school_id: "student.b".into(),
                display_name: Some("Student B".into()),
                role: Role::Student,
                class_id: Some(own_class.id),
            },
            OTHER_PASSWORD,
        )
        .await
        .unwrap()
        .user_id;
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
    let admin = auth
        .create_user_with_password(
            &NewUser {
                school_id: "admin.test".into(),
                display_name: None,
                role: Role::Admin,
                class_id: None,
            },
            ADMIN_PASSWORD,
        )
        .await
        .unwrap()
        .user_id;
    // A student with no class: the "misconfigured account" case.
    let classless = auth
        .create_user_with_password(
            &NewUser {
                school_id: "student.noclass".into(),
                display_name: None,
                role: Role::Student,
                class_id: None,
            },
            OTHER_PASSWORD,
        )
        .await
        .unwrap()
        .user_id;

    // Four entries for the student's own class, oldest first, with a deliberate mix of
    // homework-only, classwork-only and both.
    let mut feed = Vec::new();
    for (date, subject, hw, cw) in [
        (
            "2026-10-01",
            mathematics.id,
            Some("Chapter 1 questions"),
            None,
        ),
        (
            "2026-10-02",
            physics.id,
            Some("Refraction problems"),
            Some("Lab note on lenses"),
        ),
        ("2026-10-03", mathematics.id, None, Some("Exercise 6.1")),
        (
            "2026-10-05",
            physics.id,
            Some("Optics worksheet"),
            Some("Diagrams to copy"),
        ),
    ] {
        let entry = homework::create(
            &db,
            &NewHomework {
                class_id: own_class.id,
                subject_id: subject,
                author_id: None,
                due_date: date.into(),
                homework_text: hw.map(str::to_owned),
                classwork_text: cw.map(str::to_owned),
            },
        )
        .await
        .unwrap();
        feed.push(entry.id);
    }

    let authored = homework::create(
        &db,
        &NewHomework {
            class_id: own_class.id,
            subject_id: mathematics.id,
            author_id: Some(teacher),
            due_date: "2026-10-04".into(),
            homework_text: Some("Quadratic equations".into()),
            classwork_text: None,
        },
    )
    .await
    .unwrap()
    .id;

    let foreign = homework::create(
        &db,
        &NewHomework {
            class_id: other_class.id,
            subject_id: mathematics.id,
            author_id: None,
            due_date: "2026-10-05".into(),
            homework_text: Some("Another class's private homework".into()),
            classwork_text: None,
        },
    )
    .await
    .unwrap()
    .id;

    let attachment_id = attachments::create(
        &db,
        &NewAttachment {
            homework_id: authored,
            filename: "worksheet.pdf".into(),
            mime_type: "application/pdf".into(),
            size_bytes: 204_800,
            storage_key: "homework/2026/10/worksheet.pdf".into(),
        },
    )
    .await
    .unwrap()
    .id;

    World {
        app: mmss_backend::app(state),
        db,
        own_class: own_class.id,
        other_class: other_class.id,
        mathematics: mathematics.id,
        physics: physics.id,
        student_a,
        student_b,
        feed,
        foreign,
        teacher,
        admin,
        classless,
        attachment_id,
        authored,
    }
}

// ------------------------------------------------------------------ helpers

async fn call(
    app: &axum::Router,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value, axum::http::HeaderMap) {
    let mut builder = Request::builder().method(method).uri(path);
    if let Some(token) = token {
        builder = builder.header("cookie", format!("{SESSION_COOKIE}={token}"));
    }
    let request = match body {
        Some(value) => builder
            .header("content-type", "application/json")
            .body(Body::from(value.to_string()))
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    };
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or_else(|_| {
            panic!("response was not JSON: {}", String::from_utf8_lossy(&bytes))
        })
    };
    (status, value, headers)
}

/// Signs in over HTTP and returns the session cookie value.
async fn sign_in(world: &World, school_id: &str, password: &str) -> String {
    let (status, body, headers) = call(
        &world.app,
        "POST",
        "/api/auth/login",
        None,
        Some(json!({ "studentId": school_id, "password": password })),
    )
    .await;
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

async fn sign_in_a(world: &World) -> String {
    sign_in(world, "student.a", STUDENT_PASSWORD).await
}

// ----------------------------------------------------------------- homework

#[tokio::test]
async fn a_student_gets_their_whole_class_feed() {
    let world = world("feed").await;
    let token = sign_in_a(&world).await;

    let (status, body, _) = call(&world.app, "GET", "/api/homework", Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);

    // Five entries in their class: the four dated ones plus the teacher's.
    assert_eq!(body["count"], 5);
    let ids: Vec<i64> = body["homework"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["id"].as_i64().unwrap())
        .collect();
    assert!(ids.contains(&world.authored));
    assert!(
        !ids.contains(&world.foreign),
        "another class's homework must never appear"
    );
}

#[tokio::test]
async fn homework_and_classwork_come_back_separately() {
    let world = world("split").await;
    let token = sign_in_a(&world).await;
    let (_, body, _) = call(&world.app, "GET", "/api/homework", Some(&token), None).await;

    let entry = body["homework"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["id"].as_i64() == Some(world.authored))
        .expect("the teacher's entry must be present");

    assert_eq!(entry["homework"], "Quadratic equations");
    // Absent means null, not an empty string: "no classwork" and "classwork that is
    // blank" are different things.
    assert_eq!(entry["classwork"], Value::Null);
    assert_eq!(entry["subject"], "Mathematics");
    assert_eq!(entry["author"]["displayName"], "Test Teacher");
    assert_eq!(entry["displayDate"], "Oct 4, 2026");
    assert_eq!(entry["date"], "2026-10-04");

    // An entry with both halves carries both.
    let both = body["homework"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["id"].as_i64() == Some(world.feed[1]))
        .unwrap();
    assert_eq!(both["homework"], "Refraction problems");
    assert_eq!(both["classwork"], "Lab note on lenses");
}

#[tokio::test]
async fn the_feed_is_ordered_newest_day_first_and_stably() {
    let world = world("order").await;
    let token = sign_in_a(&world).await;

    let dates = |body: &Value| -> Vec<String> {
        body["homework"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["date"].as_str().unwrap().to_owned())
            .collect()
    };

    let (_, first, _) = call(&world.app, "GET", "/api/homework", Some(&token), None).await;
    let ordered = dates(&first);
    let mut expected = ordered.clone();
    expected.sort();
    expected.reverse();
    assert_eq!(ordered, expected, "newest school day must come first");

    // Repeated requests must not reshuffle: the same request twice gives the same order.
    let (_, second, _) = call(&world.app, "GET", "/api/homework", Some(&token), None).await;
    assert_eq!(dates(&second), ordered);
}

#[tokio::test]
async fn filters_narrow_the_feed() {
    let world = world("filters").await;
    let token = sign_in_a(&world).await;

    // By subject.
    let (status, body, _) = call(
        &world.app,
        "GET",
        &format!("/api/homework?subjectId={}", world.physics),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 2);
    for entry in body["homework"].as_array().unwrap() {
        assert_eq!(entry["subjectId"].as_i64(), Some(world.physics));
    }

    // By a single day.
    let (_, body, _) = call(
        &world.app,
        "GET",
        "/api/homework?from=2026-10-02&to=2026-10-02",
        Some(&token),
        None,
    )
    .await;
    assert_eq!(body["count"], 1);
    assert_eq!(body["homework"][0]["date"], "2026-10-02");

    // By an inclusive range.
    let (_, body, _) = call(
        &world.app,
        "GET",
        "/api/homework?from=2026-10-02&to=2026-10-04",
        Some(&token),
        None,
    )
    .await;
    assert_eq!(body["count"], 3);

    // By limit.
    let (_, body, _) = call(
        &world.app,
        "GET",
        "/api/homework?limit=2",
        Some(&token),
        None,
    )
    .await;
    assert_eq!(body["count"], 2);

    // A subject the school has but this class has no homework for is empty, not an error.
    let extra = subjects::create(&world.db, &mmss_backend::models::NewSubject::new("Latin"))
        .await
        .unwrap();
    let (status, body, _) = call(
        &world.app,
        "GET",
        &format!("/api/homework?subjectId={}", extra.id),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 0);
    assert_eq!(body["homework"], json!([]), "empty is [], never null");
}

#[tokio::test]
async fn malformed_filters_are_rejected_rather_than_widened() {
    let world = world("bad-filters").await;
    let token = sign_in_a(&world).await;

    for query in [
        "?from=Jul%2023,%202026", // the format the old system stored
        "?from=today",            // a relative word
        "?from=2026-02-30",       // not a real day
        "?from=not-a-date",
        "?subjectId=abc",
        "?subjectId=0",
        "?subjectId=-3",
        "?limit=0",
        "?limit=-1", // LIMIT -1 means "no limit" in SQLite, so this must not be honoured
        "?limit=99999",
        "?limit=lots",
        "?from=2026-10-05&to=2026-10-01", // inverted
    ] {
        let (status, body, _) = call(
            &world.app,
            "GET",
            &format!("/api/homework{query}"),
            Some(&token),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{query} gave {body}");
        assert!(
            body.get("homework").is_none(),
            "a rejected filter must not return a feed at all"
        );
        assert_eq!(body["code"], "BAD_REQUEST");
    }

    // A malformed homework id in the path is a 400 too.
    let (status, _, _) = call(&world.app, "GET", "/api/homework/abc", Some(&token), None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_single_entry_is_reachable_and_out_of_class_ids_are_404() {
    let world = world("single").await;
    let token = sign_in_a(&world).await;

    let (status, body, _) = call(
        &world.app,
        "GET",
        &format!("/api/homework/{}", world.authored),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["id"].as_i64(), Some(world.authored));

    // Another class's entry and a non-existent id are indistinguishable, so this cannot
    // be used to discover that another class's homework exists.
    let (foreign_status, foreign_body, _) = call(
        &world.app,
        "GET",
        &format!("/api/homework/{}", world.foreign),
        Some(&token),
        None,
    )
    .await;
    let (missing_status, missing_body, _) = call(
        &world.app,
        "GET",
        "/api/homework/999999",
        Some(&token),
        None,
    )
    .await;
    assert_eq!(foreign_status, StatusCode::NOT_FOUND);
    assert_eq!(missing_status, StatusCode::NOT_FOUND);
    assert_eq!(foreign_body["error"], missing_body["error"]);
}

#[tokio::test]
async fn a_class_filter_cannot_widen_access() {
    let world = world("class-filter").await;
    let token = sign_in_a(&world).await;

    // Asking for your own class is fine.
    let (status, body, _) = call(
        &world.app,
        "GET",
        &format!("/api/homework?classId={}", world.own_class),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 5);

    // Asking for another class is refused, and does not fall back to quietly answering
    // a different question than the one asked.
    for class in [world.other_class, 999_999] {
        let (status, body, _) = call(
            &world.app,
            "GET",
            &format!("/api/homework?classId={class}"),
            Some(&token),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "classId={class}");
        assert_eq!(body["code"], "FORBIDDEN");
        assert!(body.get("homework").is_none());
    }
}

// --------------------------------------------------------- authentication

#[tokio::test]
async fn student_routes_require_a_student() {
    let world = world("authz").await;

    // No session at all: 401 on every student route.
    for path in [
        "/api/homework",
        "/api/subjects",
        "/api/notes",
        "/api/progress",
    ] {
        let (status, body, _) = call(&world.app, "GET", path, None, None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}");
        assert_eq!(body["code"], "UNAUTHENTICATED", "{path}");
    }

    // A teacher or admin is authenticated but is not a student, so student routes must
    // refuse rather than silently adopt student semantics.
    assert_ne!(world.teacher, world.admin, "distinct staff accounts");
    for (school_id, password, expected_id) in [
        ("teacher.test", TEACHER_PASSWORD, world.teacher),
        ("admin.test", ADMIN_PASSWORD, world.admin),
    ] {
        let token = sign_in(&world, school_id, password).await;
        let (_, me, _) = call(&world.app, "GET", "/api/auth/me", Some(&token), None).await;
        assert_eq!(
            me["user"]["id"].as_i64(),
            Some(expected_id),
            "{school_id} signed in"
        );
        for path in [
            "/api/homework",
            "/api/subjects",
            "/api/notes",
            "/api/progress",
        ] {
            let (status, body, _) = call(&world.app, "GET", path, Some(&token), None).await;
            assert_eq!(status, StatusCode::FORBIDDEN, "{school_id} on {path}");
            assert_eq!(body["code"], "FORBIDDEN");
        }
    }

    // A forged cookie is not a session.
    let (status, _, _) = call(
        &world.app,
        "GET",
        "/api/homework",
        Some("fabricated-session-token"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_student_with_no_class_is_refused_rather_than_shown_everything() {
    let world = world("no-class").await;
    let token = sign_in(&world, "student.noclass", OTHER_PASSWORD).await;

    // The dangerous answer here would be an empty feed, which a student reads as "no
    // homework today". It is a 403 instead.
    let (status, body, _) = call(&world.app, "GET", "/api/homework", Some(&token), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(body.get("homework").is_none());
    let _ = world.classless;
}

// ---------------------------------------------------------------- subjects

#[tokio::test]
async fn subjects_are_listed_by_name() {
    let world = world("subjects").await;
    let token = sign_in_a(&world).await;

    let (status, body, _) = call(&world.app, "GET", "/api/subjects", Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!([{ "id": world.mathematics, "name": "Mathematics" },
               { "id": world.physics, "name": "Physics" }])
    );

    // A subject added later appears in order.
    subjects::create(&world.db, &mmss_backend::models::NewSubject::new("Art"))
        .await
        .unwrap();
    let (_, body, _) = call(&world.app, "GET", "/api/subjects", Some(&token), None).await;
    let names: Vec<&str> = body
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["Art", "Mathematics", "Physics"]);
}

// ------------------------------------------------------------------- notes

#[tokio::test]
async fn a_student_manages_their_own_notes() {
    let world = world("notes").await;
    let token = sign_in_a(&world).await;
    let homework_id = world.authored;

    // Set a note on an entry. This route is an upsert, so it answers 200 whether it
    // created the note or replaced one; `POST /api/notes` is the pure-create route and
    // answers 201.
    let (status, created, _) = call(
        &world.app,
        "POST",
        &format!("/api/notes/homework/{homework_id}"),
        Some(&token),
        Some(json!({ "body": "bring the register" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(created["homeworkId"].as_i64(), Some(homework_id));
    assert_eq!(created["body"], "bring the register");

    // It shows on the feed.
    let (_, feed, _) = call(&world.app, "GET", "/api/homework", Some(&token), None).await;
    let entry = feed["homework"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["id"].as_i64() == Some(homework_id))
        .unwrap();
    assert_eq!(entry["note"], "bring the register");

    // Posting again replaces rather than duplicating.
    let (status, replaced, _) = call(
        &world.app,
        "POST",
        &format!("/api/notes/homework/{homework_id}"),
        Some(&token),
        Some(json!({ "body": "bring the register and calculator" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(replaced["id"], created["id"], "an edit, not a second note");
    assert_eq!(
        replaced["createdAt"], created["createdAt"],
        "created_at must not move on an edit"
    );
    let (status, notes, _) = call(
        &world.app,
        "GET",
        &format!("/api/notes/homework/{homework_id}"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(notes.as_array().unwrap().len(), 1);

    // Personal notes are a different thing and stay distinguishable.
    let (status, personal, _) = call(
        &world.app,
        "POST",
        "/api/notes",
        Some(&token),
        Some(json!({ "body": "tuition on friday" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(personal["homeworkId"], Value::Null);

    // Both kinds come back from the list, and the personal note is not on the feed.
    let (status, all, _) = call(&world.app, "GET", "/api/notes", Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(all.as_array().unwrap().len(), 2);

    // Update and delete through the REST routes.
    let (status, updated, _) = call(
        &world.app,
        "PATCH",
        &format!("/api/notes/{}", personal["id"].as_i64().unwrap()),
        Some(&token),
        Some(json!({ "body": "tuition moved to saturday" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["body"], "tuition moved to saturday");

    let (status, _, _) = call(
        &world.app,
        "DELETE",
        &format!("/api/notes/{}", personal["id"].as_i64().unwrap()),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, all, _) = call(&world.app, "GET", "/api/notes", Some(&token), None).await;
    assert_eq!(all.as_array().unwrap().len(), 1);

    // Deleting again is a 404, not a server error.
    let (status, _, _) = call(
        &world.app,
        "DELETE",
        &format!("/api/notes/{}", personal["id"].as_i64().unwrap()),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_student_cannot_touch_another_students_notes() {
    let world = world("notes-cross").await;
    let token_a = sign_in_a(&world).await;
    let token_b = sign_in(&world, "student.b", OTHER_PASSWORD).await;

    let (_, a_note, _) = call(
        &world.app,
        "POST",
        "/api/notes",
        Some(&token_a),
        Some(json!({ "body": "private to A" })),
    )
    .await;
    let note_id = a_note["id"].as_i64().unwrap();

    // B cannot read, edit or delete it, and cannot tell that it exists from A's side.
    for (method, path) in [
        ("PATCH", format!("/api/notes/{note_id}")),
        ("DELETE", format!("/api/notes/{note_id}")),
    ] {
        let body = if method == "PATCH" {
            Some(json!({ "body": "hijacked" }))
        } else {
            None
        };
        let (status, _, _) = call(&world.app, method, &path, Some(&token_b), body).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "B {method} {path}");
    }
    // A 404 rather than 403: confirming the id belongs to someone else is itself a
    // disclosure.
    let (missing_status, _, _) = call(
        &world.app,
        "PATCH",
        "/api/notes/999999",
        Some(&token_b),
        Some(json!({ "body": "x" })),
    )
    .await;
    assert_eq!(missing_status, StatusCode::NOT_FOUND);

    // A's note is untouched and still not visible to B.
    let (_, a_list, _) = call(&world.app, "GET", "/api/notes", Some(&token_a), None).await;
    assert_eq!(a_list.as_array().unwrap().len(), 1);
    let (_, b_list, _) = call(&world.app, "GET", "/api/notes", Some(&token_b), None).await;
    assert!(b_list.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn notes_on_homework_are_validated() {
    let world = world("notes-validate").await;
    let token = sign_in_a(&world).await;

    // A note must point at homework that exists and is this student's to see.
    for path in [
        "/api/notes/homework/999999".to_string(),
        format!("/api/notes/homework/{}", world.foreign),
    ] {
        let (status, _, _) = call(
            &world.app,
            "POST",
            &path,
            Some(&token),
            Some(json!({ "body": "nope" })),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{path}");
    }

    // Bodies are bounded and must not be blank.
    for body in ["", "   ", &"x".repeat(4_001)] {
        let (status, _, _) = call(
            &world.app,
            "POST",
            &api_path(world.authored),
            Some(&token),
            Some(json!({ "body": body })),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::BAD_REQUEST,
            "body of {} chars",
            body.len()
        );
    }

    // A malformed body is a 400, and a non-string body is too.
    let (status, _, _) = call(
        &world.app,
        "POST",
        &api_path(world.authored),
        Some(&token),
        Some(json!({ "body": 42 })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _, _) = call(
        &world.app,
        "POST",
        &api_path(world.authored),
        Some(&token),
        Some(json!({ "wrongField": "x" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

fn api_path(homework_id: i64) -> String {
    format!("/api/notes/homework/{homework_id}")
}

// ---------------------------------------------------------------- progress

#[tokio::test]
async fn progress_round_trips_and_is_idempotent() {
    let world = world("progress").await;
    let token = sign_in_a(&world).await;
    let id = world.authored;

    // Never ticked: an answer, not a 404.
    let (status, initial, _) =
        call(&world.app, "GET", &progress_path(id), Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(initial["completed"], false);

    // Tick.
    let (status, ticked, _) = call(
        &world.app,
        "PATCH",
        &progress_path(id),
        Some(&token),
        Some(json!({ "completed": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(ticked["completed"], true);

    // Repeating the same update is safe and changes nothing.
    let (_, again, _) = call(
        &world.app,
        "PATCH",
        &progress_path(id),
        Some(&token),
        Some(json!({ "completed": true })),
    )
    .await;
    assert_eq!(again["completed"], true);

    // It shows on the feed.
    let (_, feed, _) = call(&world.app, "GET", "/api/homework", Some(&token), None).await;
    let entry = feed["homework"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["id"].as_i64() == Some(id))
        .unwrap();
    assert_eq!(entry["completed"], true);

    // Untick.
    let (_, unticked, _) = call(
        &world.app,
        "PATCH",
        &progress_path(id),
        Some(&token),
        Some(json!({ "completed": false })),
    )
    .await;
    assert_eq!(unticked["completed"], false);

    // The list reflects only the rows that exist.
    let (_, list, _) = call(&world.app, "GET", "/api/progress", Some(&token), None).await;
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["completed"], false);
}

#[tokio::test]
async fn progress_is_scoped_to_the_student_and_to_visible_homework() {
    let world = world("progress-cross").await;
    let token_a = sign_in_a(&world).await;
    let token_b = sign_in(&world, "student.b", OTHER_PASSWORD).await;

    call(
        &world.app,
        "PATCH",
        &progress_path(world.authored),
        Some(&token_a),
        Some(json!({ "completed": true })),
    )
    .await;

    // B's own state is untouched by A ticking.
    let (_, b_state, _) = call(
        &world.app,
        "GET",
        &progress_path(world.authored),
        Some(&token_b),
        None,
    )
    .await;
    assert_eq!(b_state["completed"], false);
    let (_, b_list, _) = call(&world.app, "GET", "/api/progress", Some(&token_b), None).await;
    assert!(b_list.as_array().unwrap().is_empty());

    // Neither student can tick homework outside their class.
    // Every account that has an id in the fixture is reachable by those ids, which is
    // what makes the fixture's ids worth asserting.
    let (_, a_body, _) = call(&world.app, "GET", "/api/auth/me", Some(&token_a), None).await;
    assert_eq!(a_body["user"]["id"].as_i64(), Some(world.student_a));
    let (_, b_body, _) = call(&world.app, "GET", "/api/auth/me", Some(&token_b), None).await;
    assert_eq!(b_body["user"]["id"].as_i64(), Some(world.student_b));

    for token in [&token_a, &token_b] {
        let (status, _, _) = call(
            &world.app,
            "PATCH",
            &progress_path(world.foreign),
            Some(token),
            Some(json!({ "completed": true })),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        let (status, _, _) = call(
            &world.app,
            "PATCH",
            &progress_path(999_999),
            Some(token),
            Some(json!({ "completed": true })),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    // A malformed body is a 400.
    let (status, _, _) = call(
        &world.app,
        "PATCH",
        &progress_path(world.authored),
        Some(&token_a),
        Some(json!({ "completed": "yes" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

fn progress_path(homework_id: i64) -> String {
    format!("/api/progress/{homework_id}")
}

// ------------------------------------------------------------- attachments

#[tokio::test]
async fn attachment_metadata_is_exposed_without_file_bytes() {
    let world = world("attachments").await;
    let token = sign_in_a(&world).await;

    let (status, body, _) = call(
        &world.app,
        "GET",
        &format!("/api/homework/{}/attachments", world.authored),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!([{
            "id": world.attachment_id,
            "filename": "worksheet.pdf",
            "mimeType": "application/pdf",
            "sizeBytes": 204_800,
            "storageKey": "homework/2026/10/worksheet.pdf",
            "createdAt": body[0]["createdAt"].clone(),
        }])
    );

    // There is no URL to fetch, by design: no storage layer exists yet. A URL that
    // returned JSON would break the client's attachment views more confusingly than
    // having nothing.
    assert!(body[0].get("url").is_none());
    // And the legacy single-attachment slot is null for the same reason.
    let (_, feed, _) = call(&world.app, "GET", "/api/homework", Some(&token), None).await;
    let entry = feed["homework"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["id"].as_i64() == Some(world.authored))
        .unwrap();
    assert_eq!(entry["attachment"], Value::Null);
    assert_eq!(entry["attachments"].as_array().unwrap().len(), 1);

    // No file bytes anywhere in the database.
    let columns: Vec<String> =
        sqlx::query_scalar("SELECT name FROM pragma_table_info('attachments')")
            .fetch_all(&world.db)
            .await
            .unwrap();
    assert!(
        !columns
            .iter()
            .any(|name| matches!(name.as_str(), "data" | "bytes" | "blob" | "content")),
        "attachments must not carry file content: {columns:?}"
    );
    // The stored metadata row is the whole record: no base64 payload hiding anywhere.
    let row: String =
        sqlx::query_scalar("SELECT group_concat(name) FROM pragma_table_info('attachments')")
            .fetch_one(&world.db)
            .await
            .unwrap();
    assert_eq!(
        row,
        "id,homework_id,filename,mime_type,size_bytes,storage_key,created_at"
    );
}

#[tokio::test]
async fn attachments_of_another_class_are_not_reachable() {
    let world = world("attachments-cross").await;
    let token = sign_in_a(&world).await;

    // Attach an entry that is in the other class.
    let foreign_entry = homework::create(
        &world.db,
        &NewHomework {
            class_id: world.other_class,
            subject_id: world.mathematics,
            author_id: None,
            due_date: "2026-10-06".into(),
            homework_text: Some("private".into()),
            classwork_text: None,
        },
    )
    .await
    .unwrap();
    let foreign_attachment = attachments::create(
        &world.db,
        &NewAttachment {
            homework_id: foreign_entry.id,
            filename: "secret.pdf".into(),
            mime_type: "application/pdf".into(),
            size_bytes: 10,
            storage_key: "secret.pdf".into(),
        },
    )
    .await
    .unwrap();

    let (status, _, _) = call(
        &world.app,
        "GET",
        &format!("/api/homework/{}/attachments", foreign_entry.id),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // And the metadata row is still there for whoever may legitimately see it.
    let still_there = attachments::find_by_id(&world.db, foreign_attachment.id)
        .await
        .unwrap();
    assert!(still_there.is_some());
}

// ------------------------------------------------------------ compat routes

#[tokio::test]
async fn the_legacy_homework_urls_the_client_calls_still_work() {
    let world = world("compat").await;
    let token = sign_in_a(&world).await;
    let id = world.authored;

    // PATCH /api/homework/{id}/status
    let (status, _, _) = call(
        &world.app,
        "PATCH",
        &format!("/api/homework/{id}/status"),
        Some(&token),
        Some(json!({ "completed": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, state, _) = call(&world.app, "GET", &progress_path(id), Some(&token), None).await;
    assert_eq!(state["completed"], true);

    // PATCH /api/homework/{id}/note
    let (status, _, _) = call(
        &world.app,
        "PATCH",
        &format!("/api/homework/{id}/note"),
        Some(&token),
        Some(json!({ "note": "legacy note" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // `null` clears it, as it did before.
    let (status, body, _) = call(
        &world.app,
        "PATCH",
        &format!("/api/homework/{id}/note"),
        Some(&token),
        Some(json!({ "note": null })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["note"], Value::Null);
    let (_, notes, _) = call(
        &world.app,
        "GET",
        &format!("/api/notes/homework/{id}"),
        Some(&token),
        None,
    )
    .await;
    assert!(notes.as_array().unwrap().is_empty());

    // Both aliases are still authenticated and still class-scoped.
    let (status, _, _) = call(
        &world.app,
        "PATCH",
        &format!("/api/homework/{}/status", world.foreign),
        Some(&token),
        Some(json!({ "completed": true })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _, _) = call(
        &world.app,
        "PATCH",
        &format!("/api/homework/{id}/status"),
        None,
        Some(json!({ "completed": true })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// ----------------------------------------------------- end-to-end journey

#[tokio::test]
async fn a_complete_student_journey_over_http() {
    let world = world("journey").await;

    // login
    let (status, login_body, headers) = call(
        &world.app,
        "POST",
        "/api/auth/login",
        None,
        Some(json!({ "studentId": "student.a", "password": STUDENT_PASSWORD })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(login_body["authenticated"], true);
    assert!(headers.contains_key(axum::http::header::SET_COOKIE));
    let token = sign_in(&world, "student.a", STUDENT_PASSWORD).await;

    // /auth/me
    let (_, me, _) = call(&world.app, "GET", "/api/auth/me", Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(me["authenticated"], true);
    assert_eq!(me["user"]["studentId"], "student.a");

    // subjects
    let (status, subjects_body, _) =
        call(&world.app, "GET", "/api/subjects", Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(subjects_body.as_array().unwrap().len(), 2);

    // homework feed
    let (status, feed, _) = call(&world.app, "GET", "/api/homework", Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(feed["count"], 5);

    // filter by subject and by date
    let (_, filtered, _) = call(
        &world.app,
        "GET",
        &format!("/api/homework?subjectId={}&to=2026-10-03", world.physics),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(filtered["count"], 1);

    // read classwork from a filtered feed
    let (_, both, _) = call(
        &world.app,
        "GET",
        "/api/homework?from=2026-10-02&to=2026-10-02",
        Some(&token),
        None,
    )
    .await;
    assert_eq!(both["homework"][0]["classwork"], "Lab note on lenses");

    // read the note, then create / update / delete it
    let id = world.authored;
    let (_, note, _) = call(
        &world.app,
        "POST",
        &format!("/api/notes/homework/{id}"),
        Some(&token),
        Some(json!({ "body": "first" })),
    )
    .await;
    assert_eq!(note["body"], "first");
    let (_, note, _) = call(
        &world.app,
        "PATCH",
        &format!("/api/notes/{}", note["id"].as_i64().unwrap()),
        Some(&token),
        Some(json!({ "body": "second" })),
    )
    .await;
    assert_eq!(note["body"], "second");
    let (status, _, _) = call(
        &world.app,
        "DELETE",
        &format!("/api/notes/{}", note["id"].as_i64().unwrap()),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // mark complete, then read progress
    call(
        &world.app,
        "PATCH",
        &progress_path(id),
        Some(&token),
        Some(json!({ "completed": true })),
    )
    .await;
    let (status, progress_body, _) =
        call(&world.app, "GET", &progress_path(id), Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(progress_body["completed"], true);

    // logout, then everything is refused
    let (status, logout_body, _) =
        call(&world.app, "POST", "/api/auth/logout", Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(logout_body["authenticated"], false);

    let (status, _, _) = call(&world.app, "GET", "/api/homework", Some(&token), None).await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "the revoked cookie must not work"
    );
    let (_, me, _) = call(&world.app, "GET", "/api/auth/me", Some(&token), None).await;
    assert_eq!(me["authenticated"], false);
}

// ------------------------------------------------------------- no leakage

#[tokio::test]
async fn responses_leak_neither_internals_nor_other_users_data() {
    let world = world("leak").await;
    let token = sign_in_a(&world).await;

    let requests: Vec<(String, Option<Value>)> = vec![
        ("/api/homework".into(), None),
        ("/api/subjects".into(), None),
        ("/api/notes".into(), None),
        ("/api/progress".into(), None),
        (format!("/api/homework/{}", world.authored), None),
        (format!("/api/homework/{}", world.foreign), None),
        ("/api/homework?from=nonsense".into(), None),
        ("/api/nope".into(), None),
    ];

    for (path, body) in requests {
        let (_, value, _) = call(&world.app, "GET", &path, Some(&token), body).await;
        let text = value.to_string();
        for leak in [
            "SELECT",
            "sqlite",
            "sqlx",
            "password",
            "argon2",
            "token_hash",
            "password_hash",
            "sessions",
            "Another class",
        ] {
            assert!(
                !text.to_lowercase().contains(&leak.to_lowercase()),
                "{path} leaked {leak}: {text}"
            );
        }
    }
}
