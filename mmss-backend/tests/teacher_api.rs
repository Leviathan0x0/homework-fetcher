//! Integration tests for the teacher API, over the real Axum router with the real
//! session system.
//!
//! Every request signs in through `POST /api/auth/login` and carries the real cookie.
//! A principal is never injected directly, because the interesting failures in this
//! layer are exactly the ones where a forged `authorId`, `teacherId` or `role` in a
//! request body disagrees with the session -- and a test that bypasses login cannot
//! see that disagreement.
//!
//! Each test gets a private temporary SQLite file created through the normal startup
//! path, so migrations really run. No real school credential appears anywhere.
//!
//! Fixtures: teacher A (assigned to class A), teacher B (assigned to class B), an
//! admin, a student of class A, two classes and two subjects. Teacher-class
//! assignments come from `repositories::teacher_classes::assign`, which is the
//! documented dev path until the deferred admin management CRUD exists.

use std::sync::atomic::{AtomicU32, Ordering};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use mmss_backend::config::Config;
use mmss_backend::cookies::SESSION_COOKIE;
use mmss_backend::models::{NewAttachment, NewHomework, NewUser, Role};
use mmss_backend::repositories::{attachments, homework, subjects, teacher_classes};
use mmss_backend::services::auth::AuthService;
use mmss_backend::state::AppState;
use serde_json::{json, Value};
use tower::ServiceExt;

static NEXT_ID: AtomicU32 = AtomicU32::new(0);

const TEACHER_A_PASSWORD: &str = "test-teacher-a-password";
const TEACHER_B_PASSWORD: &str = "test-teacher-b-password";
const TEACHER_C_PASSWORD: &str = "test-teacher-c-password";
const ADMIN_PASSWORD: &str = "test-admin-password";
const STUDENT_PASSWORD: &str = "test-student-password";

/// One fixture entry, written directly rather than through the API, so the tests
/// start from a known history.
async fn entry(
    db: &sqlx::SqlitePool,
    class_id: i64,
    subject_id: i64,
    author_id: Option<i64>,
    due_date: &str,
    homework_text: Option<&str>,
    classwork_text: Option<&str>,
) -> i64 {
    homework::create(
        db,
        &NewHomework {
            class_id,
            subject_id,
            author_id,
            due_date: due_date.to_owned(),
            homework_text: homework_text.map(str::to_owned),
            classwork_text: classwork_text.map(str::to_owned),
        },
    )
    .await
    .unwrap()
    .id
}

struct World {
    app: axum::Router,
    db: sqlx::SqlitePool,
    /// The class teacher A teaches and the student belongs to.
    class_a: i64,
    /// The class teacher B teaches.
    class_b: i64,
    subject_a: i64,
    subject_b: i64,
    teacher_a: i64,
    teacher_b: i64,
    admin: i64,
    student: i64,
    /// One entry in `class_a`, written by teacher A.
    by_a: i64,
    /// One entry in `class_a`, written by teacher B (a colleague covering the class).
    by_b: i64,
    /// One entry in `class_b`, written by teacher B.
    foreign: i64,
    /// An entry in `class_a` with no author, as a portal import would leave it.
    anonymous: i64,
    attachment_id: i64,
}

async fn world(tag: &str) -> World {
    let unique = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "mmss-teacher-test-{}-{tag}-{unique}",
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

    let class_a = mmss_backend::repositories::classes::create(
        &db,
        &mmss_backend::models::NewClass::new("9-F"),
    )
    .await
    .unwrap();
    let class_b = mmss_backend::repositories::classes::create(
        &db,
        &mmss_backend::models::NewClass::new("9-A"),
    )
    .await
    .unwrap();
    let subject_a = subjects::create(&db, &mmss_backend::models::NewSubject::new("Mathematics"))
        .await
        .unwrap();
    let subject_b = subjects::create(&db, &mmss_backend::models::NewSubject::new("Physics"))
        .await
        .unwrap();

    let teacher_a = auth
        .create_user_with_password(
            &NewUser {
                school_id: "teacher.a".into(),
                display_name: Some("Teacher A".into()),
                role: Role::Teacher,
                class_id: None,
            },
            TEACHER_A_PASSWORD,
        )
        .await
        .unwrap()
        .user_id;
    let teacher_b = auth
        .create_user_with_password(
            &NewUser {
                school_id: "teacher.b".into(),
                display_name: Some("Teacher B".into()),
                role: Role::Teacher,
                class_id: None,
            },
            TEACHER_B_PASSWORD,
        )
        .await
        .unwrap()
        .user_id;
    let admin = auth
        .create_user_with_password(
            &NewUser {
                school_id: "admin.test".into(),
                display_name: Some("Admin".into()),
                role: Role::Admin,
                class_id: None,
            },
            ADMIN_PASSWORD,
        )
        .await
        .unwrap()
        .user_id;
    let student = auth
        .create_user_with_password(
            &NewUser {
                school_id: "student.test".into(),
                display_name: Some("Student".into()),
                role: Role::Student,
                class_id: Some(class_a.id),
            },
            STUDENT_PASSWORD,
        )
        .await
        .unwrap()
        .user_id;

    // The assignments that define what each teacher may manage.
    teacher_classes::assign(&db, teacher_a, class_a.id)
        .await
        .unwrap();
    teacher_classes::assign(&db, teacher_b, class_b.id)
        .await
        .unwrap();

    let by_a = entry(
        &db,
        class_a.id,
        subject_a.id,
        Some(teacher_a),
        "2026-10-01",
        Some("Quadratic equations"),
        None,
    )
    .await;
    // Teacher B is not assigned to class A, so this is the "colleague's entry" case:
    // readable by teacher A only because A teaches the class, never editable by A.
    let by_b = entry(
        &db,
        class_a.id,
        subject_b.id,
        Some(teacher_b),
        "2026-10-02",
        Some("Refraction problems"),
        Some("Lab note on lenses"),
    )
    .await;
    let foreign = entry(
        &db,
        class_b.id,
        subject_a.id,
        Some(teacher_b),
        "2026-10-03",
        Some("Another class's homework"),
        None,
    )
    .await;
    let anonymous = entry(
        &db,
        class_a.id,
        subject_a.id,
        None,
        "2026-10-04",
        Some("Diary entry imported from a portal"),
        None,
    )
    .await;

    let attachment_id = attachments::create(
        &db,
        &NewAttachment {
            homework_id: by_a,
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
        class_a: class_a.id,
        class_b: class_b.id,
        subject_a: subject_a.id,
        subject_b: subject_b.id,
        teacher_a,
        teacher_b,
        admin,
        student,
        by_a,
        by_b,
        foreign,
        anonymous,
        attachment_id,
    }
}

// ------------------------------------------------------------------ helpers

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

/// Signs in over HTTP and returns the session cookie value, parsed out of the one
/// `Set-Cookie` header the response carries.
async fn sign_in(world: &World, school_id: &str, password: &str) -> String {
    let response = world
        .app
        .clone()
        .oneshot(
            Request::post("/api/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "studentId": school_id, "password": password }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "login failed for {school_id}"
    );
    response
        .headers()
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

async fn teacher_a(world: &World) -> String {
    sign_in(world, "teacher.a", TEACHER_A_PASSWORD).await
}

async fn teacher_b(world: &World) -> String {
    sign_in(world, "teacher.b", TEACHER_B_PASSWORD).await
}

async fn admin(world: &World) -> String {
    sign_in(world, "admin.test", ADMIN_PASSWORD).await
}

async fn student(world: &World) -> String {
    sign_in(world, "student.test", STUDENT_PASSWORD).await
}

/// A valid create body, with `overrides` merged over it.
fn create_body(world: &World, overrides: Value) -> Value {
    let mut body = json!({
        "classId": world.class_a,
        "subjectId": world.subject_a,
        "dueDate": "2026-10-06",
        "homework": "Read pages 10-20",
    })
    .as_object()
    .unwrap()
    .clone();
    for (key, value) in overrides.as_object().unwrap() {
        body.insert(key.clone(), value.clone());
    }
    Value::Object(body)
}

async fn create(world: &World, token: &str, overrides: Value) -> (StatusCode, Value) {
    call(
        &world.app,
        "POST",
        "/api/teacher/homework",
        Some(token),
        Some(create_body(world, overrides)),
    )
    .await
}

// ------------------------------------------------------------- authorization

#[tokio::test]
async fn the_authorization_matrix_holds() {
    let world = world("matrix").await;
    let a = teacher_a(&world).await;
    let b = teacher_b(&world).await;
    let adm = admin(&world).await;
    let stu = student(&world).await;

    // anonymous -> 401 on every verb
    for method in ["GET", "POST", "PATCH", "DELETE"] {
        let path = if method == "GET" {
            "/api/teacher/homework".to_string()
        } else if method == "DELETE" || method == "PATCH" {
            format!("/api/teacher/homework/{}", world.by_a)
        } else {
            "/api/teacher/homework".to_string()
        };
        let body = if method == "POST" || method == "PATCH" {
            Some(create_body(&world, json!({})))
        } else {
            None
        };
        let (status, _) = call(&world.app, method, &path, None, body).await;
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "{method} {path} as anonymous"
        );
    }

    // student -> 403, not 401: the session is real, the role is not permitted.
    for method in ["GET", "POST", "PATCH", "DELETE"] {
        let path = if method == "GET" || method == "POST" {
            "/api/teacher/homework".to_string()
        } else {
            format!("/api/teacher/homework/{}", world.by_a)
        };
        let body = if method == "POST" || method == "PATCH" {
            Some(create_body(&world, json!({})))
        } else {
            None
        };
        let (status, _) = call(&world.app, method, &path, Some(&stu), body).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "{method} {path} as a student"
        );
    }

    // teacher A -> class A allowed
    let (status, _) = call(&world.app, "GET", "/api/teacher/homework", Some(&a), None).await;
    assert_eq!(status, StatusCode::OK);

    // teacher A -> class B forbidden, on create and on list
    let (status, body) = create(&world, &a, json!({ "classId": world.class_b })).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let (status, body) = call(
        &world.app,
        "GET",
        &format!("/api/teacher/homework?classId={}", world.class_b),
        Some(&a),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    // teacher A -> own homework allowed. DELETE is exercised on a throwaway entry so
    // the fixture ids below stay valid for the remaining assertions.
    for method in ["GET", "PATCH"] {
        let path = format!("/api/teacher/homework/{}", world.by_a);
        let body = if method == "PATCH" {
            Some(json!({ "homework": "Quadratic equations, corrected" }))
        } else {
            None
        };
        let (status, response) = call(&world.app, method, &path, Some(&a), body).await;
        assert_eq!(status, StatusCode::OK, "{method} own homework: {response}");
    }

    let disposable = entry(
        &world.db,
        world.class_a,
        world.subject_a,
        Some(world.teacher_a),
        "2026-10-05",
        Some("To be deleted"),
        None,
    )
    .await;
    let (status, response) = call(
        &world.app,
        "DELETE",
        &format!("/api/teacher/homework/{disposable}"),
        Some(&a),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "delete own homework: {response}");
    assert!(homework::find_by_id(&world.db, disposable)
        .await
        .unwrap()
        .is_none());

    // teacher A -> teacher B's homework forbidden for every write verb
    for method in ["PATCH", "DELETE"] {
        let path = format!("/api/teacher/homework/{}", world.by_b);
        let body = if method == "PATCH" {
            Some(json!({ "homework": "hijacked" }))
        } else {
            None
        };
        let (status, response) = call(&world.app, method, &path, Some(&a), body).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "{method} another's homework: {response}"
        );
    }
    // ...and it is still readable, because a colleague's entry in a class they teach
    // is exactly what a covering teacher needs to see.
    let (status, _) = call(
        &world.app,
        "GET",
        &format!("/api/teacher/homework/{}", world.by_b),
        Some(&a),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // teacher B -> class A homework is a 404 on read: it is not in B's world at all.
    let (status, _) = call(
        &world.app,
        "GET",
        &format!("/api/teacher/homework/{}", world.by_a),
        Some(&b),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // admin -> any homework allowed
    for id in [world.by_a, world.by_b, world.foreign, world.anonymous] {
        let (status, response) = call(
            &world.app,
            "GET",
            &format!("/api/teacher/homework/{id}"),
            Some(&adm),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "admin reading {id}: {response}");
    }
    let (status, _) = create(&world, &adm, json!({ "classId": world.class_b })).await;
    assert_eq!(status, StatusCode::CREATED, "an admin may target any class");
}

#[tokio::test]
async fn a_forged_author_or_teacher_id_never_wins() {
    let world = world("forged").await;
    let a = teacher_a(&world).await;
    let b = teacher_b(&world).await;

    // A claims to be B, and to be an admin, on create.
    let (status, body) = create(
        &world,
        &a,
        json!({
            "authorId": world.teacher_b,
            "teacherId": world.teacher_b,
            "role": "admin",
            "homework": "Chapter 4 questions",
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(
        body["author"]["id"].as_i64(),
        Some(world.teacher_a),
        "author_id must come from the session, never the body"
    );
    assert_eq!(body["author"]["displayName"], "Teacher A");

    let stored = homework::find_by_id(&world.db, body["id"].as_i64().unwrap())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.author_id, Some(world.teacher_a));
    assert_eq!(stored.class_id, world.class_a);

    // A PATCH may not reassign authorship either -- there is no such field, and a
    // forged one does not create it.
    let (status, body) = call(
        &world.app,
        "PATCH",
        &format!("/api/teacher/homework/{}", body["id"].as_i64().unwrap()),
        Some(&a),
        Some(json!({ "authorId": world.teacher_b, "classwork": "Exercise 4.2" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let after = homework::find_by_id(&world.db, body["id"].as_i64().unwrap())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(after.author_id, Some(world.teacher_a));

    // And a forged `classId` on B's session is refused: naming a class is not being
    // assigned to it.
    let (status, _) = create(&world, &b, json!({ "classId": world.class_a })).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn a_teacher_with_no_assignments_sees_nothing_and_creates_nothing() {
    let world = world("unassigned").await;
    // A teacher with no rows in `teacher_classes` at all. The dangerous reading of
    // "no classes" is "no restriction"; the correct one is "no access".
    AuthService::new(&world.db, &Config::for_tests("sqlite::memory:"))
        .create_user_with_password(
            &NewUser {
                school_id: "teacher.c".into(),
                display_name: None,
                role: Role::Teacher,
                class_id: None,
            },
            TEACHER_C_PASSWORD,
        )
        .await
        .unwrap();
    let token = sign_in(&world, "teacher.c", TEACHER_C_PASSWORD).await;

    let (status, body) = call(
        &world.app,
        "GET",
        "/api/teacher/homework",
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["count"], 0,
        "an unassigned teacher sees no class's homework"
    );
    assert_eq!(body["items"], json!([]));

    for class in [world.class_a, world.class_b] {
        let (status, body) = create(&world, &token, json!({ "classId": class })).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    }
}

// ------------------------------------------------------------------ creation

#[tokio::test]
async fn creating_valid_homework_returns_the_full_entry() {
    let world = world("create").await;
    let a = teacher_a(&world).await;

    let (status, body) = create(&world, &a, json!({})).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["classId"].as_i64(), Some(world.class_a));
    assert_eq!(body["subjectId"].as_i64(), Some(world.subject_a));
    assert_eq!(body["dueDate"], "2026-10-06");
    assert_eq!(body["homework"], "Read pages 10-20");
    assert_eq!(body["classwork"], Value::Null);
    assert_eq!(body["subject"], "Mathematics");
    assert_eq!(body["className"], "9-F");
    assert_eq!(body["author"]["displayName"], "Teacher A");
    assert_eq!(body["attachments"], json!([]), "absent is [], never null");
    // Timestamps are epoch milliseconds, the R2 convention, not an ISO string.
    assert!(body["createdAt"].as_i64().unwrap() > 1_600_000_000_000);
    assert_eq!(body["createdAt"], body["updatedAt"]);

    // It really is in SQLite, with the author recorded from the session.
    let stored = homework::find_by_id(&world.db, body["id"].as_i64().unwrap())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.author_id, Some(world.teacher_a));
    assert_eq!(stored.homework_text.as_deref(), Some("Read pages 10-20"));
    assert_eq!(stored.classwork_text, None);
}

#[tokio::test]
async fn both_halves_may_be_written_alone_or_together() {
    let world = world("halves").await;
    let a = teacher_a(&world).await;

    // homework only
    let (status, body) = create(
        &world,
        &a,
        json!({ "homework": "Exercise 6.1", "classwork": Value::Null }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["homework"], "Exercise 6.1");
    assert_eq!(body["classwork"], Value::Null);

    // classwork only
    let (status, body) = create(
        &world,
        &a,
        json!({ "homework": Value::Null, "classwork": "Exercise 6.2" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["homework"], Value::Null);
    assert_eq!(body["classwork"], "Exercise 6.2");

    // both
    let (status, body) = create(
        &world,
        &a,
        json!({ "homework": "Chapter 7", "classwork": "Exercise 6.3" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["homework"], "Chapter 7");
    assert_eq!(body["classwork"], "Exercise 6.3");
}

#[tokio::test]
async fn an_entry_with_neither_half_is_refused() {
    let world = world("blank").await;
    let a = teacher_a(&world).await;

    for overrides in [
        json!({ "homework": Value::Null, "classwork": Value::Null }),
        json!({ "homework": "", "classwork": "" }),
        json!({ "homework": "   ", "classwork": "\t\n  " }),
        // Both halves absent entirely.
        json!({ "homework": Value::Null, "classwork": Value::Null }),
    ] {
        let (status, body) = create(&world, &a, overrides.clone()).await;
        assert_eq!(
            status,
            StatusCode::BAD_REQUEST,
            "{overrides} must be refused: {body}"
        );
    }

    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM homework")
        .fetch_one(&world.db)
        .await
        .unwrap();
    assert_eq!(
        count, 4,
        "only the four fixtures exist; no rejected row was written"
    );
}

#[tokio::test]
async fn invalid_references_and_dates_are_refused_with_a_400() {
    let world = world("invalid").await;
    let a = teacher_a(&world).await;

    for overrides in [
        json!({ "classId": 999_999 }),
        json!({ "subjectId": 999_999 }),
        json!({ "dueDate": "Jul 23, 2026" }),
        json!({ "dueDate": "today" }),
        json!({ "dueDate": "2026-02-30" }),
        json!({ "dueDate": "2026-7-5" }),
        json!({ "dueDate": "" }),
        json!({ "homework": &"x".repeat(20_001) }),
    ] {
        let (status, body) = create(&world, &a, overrides.clone()).await;
        assert_eq!(
            status,
            StatusCode::BAD_REQUEST,
            "{overrides} must be refused: {body}"
        );
        assert!(
            !body["error"].as_str().unwrap_or_default().contains("SQL"),
            "no internal detail may leak: {body}"
        );
    }

    // A missing required field is also a 400.
    let (status, _) = call(
        &world.app,
        "POST",
        "/api/teacher/homework",
        Some(&a),
        Some(json!({ "subjectId": world.subject_a, "dueDate": "2026-10-06" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_malformed_body_is_a_clean_400() {
    let world = world("malformed").await;
    let a = teacher_a(&world).await;

    let response = world
        .app
        .clone()
        .oneshot(
            Request::post("/api/teacher/homework")
                .header("cookie", format!("{SESSION_COOKIE}={a}"))
                .header("content-type", "application/json")
                .body(Body::from("{not json"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    // The parser's own message is an internal detail; the caller gets a written one.
    assert_eq!(body["code"], "BAD_REQUEST");
    assert!(!body["error"].as_str().unwrap().contains("expected value"));
}

#[tokio::test]
async fn interior_whitespace_survives_and_only_the_ends_are_trimmed() {
    let world = world("interior").await;
    let a = teacher_a(&world).await;

    let typed = "  Q1.  Read  pages\n10-20\n\n\tQ2.  Exercises 3 and 4.  ";
    let (status, body) = create(&world, &a, json!({ "homework": typed })).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(
        body["homework"], "Q1.  Read  pages\n10-20\n\n\tQ2.  Exercises 3 and 4.",
        "ends trimmed, interior untouched"
    );

    let stored = homework::find_by_id(&world.db, body["id"].as_i64().unwrap())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.homework_text.as_deref(), body["homework"].as_str());
}

// ------------------------------------------------------------------- listing

#[tokio::test]
async fn a_listing_is_scoped_to_the_classes_a_teacher_teaches() {
    let world = world("listing-scope").await;
    let a = teacher_a(&world).await;
    let b = teacher_b(&world).await;
    let adm = admin(&world).await;

    let (status, body) = call(&world.app, "GET", "/api/teacher/homework", Some(&a), None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let ids: Vec<i64> = body["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_i64().unwrap())
        .collect();
    assert_eq!(ids.len(), body["count"].as_u64().unwrap() as usize);
    // Class A has four entries: A's own, the colleague's, the anonymous one, and the
    // fixture's attachment. Class B's entry must not appear.
    assert!(ids.contains(&world.by_a) && ids.contains(&world.by_b));
    assert!(ids.contains(&world.anonymous));
    assert!(
        !ids.contains(&world.foreign),
        "another class's homework must not appear"
    );

    // Teacher B sees only class B.
    let (_, body) = call(&world.app, "GET", "/api/teacher/homework", Some(&b), None).await;
    let ids: Vec<i64> = body["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_i64().unwrap())
        .collect();
    assert_eq!(ids, vec![world.foreign]);

    // An admin sees the whole school.
    let (_, body) = call(&world.app, "GET", "/api/teacher/homework", Some(&adm), None).await;
    assert_eq!(body["count"], 4);
}

#[tokio::test]
async fn listing_filters_narrow_the_result() {
    let world = world("listing-filters").await;
    let a = teacher_a(&world).await;

    // By class: teacher A is assigned only to class A.
    let (status, body) = call(
        &world.app,
        "GET",
        &format!("/api/teacher/homework?classId={}", world.class_a),
        Some(&a),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["count"], 3);

    // By subject.
    let (_, body) = call(
        &world.app,
        "GET",
        &format!("/api/teacher/homework?subjectId={}", world.subject_b),
        Some(&a),
        None,
    )
    .await;
    assert_eq!(body["count"], 1);
    assert_eq!(body["items"][0]["subject"], "Physics");

    // By an inclusive date range.
    let (_, body) = call(
        &world.app,
        "GET",
        "/api/teacher/homework?from=2026-10-01&to=2026-10-02",
        Some(&a),
        None,
    )
    .await;
    assert_eq!(body["count"], 2);

    // By limit.
    let (_, body) = call(
        &world.app,
        "GET",
        "/api/teacher/homework?limit=2",
        Some(&a),
        None,
    )
    .await;
    assert_eq!(body["count"], 2);

    // A subject the school has but this class has nothing for is empty, not an error.
    let extra = subjects::create(&world.db, &mmss_backend::models::NewSubject::new("Latin"))
        .await
        .unwrap();
    let (status, body) = call(
        &world.app,
        "GET",
        &format!("/api/teacher/homework?subjectId={}", extra.id),
        Some(&a),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 0);
    assert_eq!(body["items"], json!([]), "empty is [], never null");
}

#[tokio::test]
async fn listing_order_is_deterministic_newest_day_first() {
    let world = world("listing-order").await;
    let a = teacher_a(&world).await;

    let dates = |body: &Value| -> Vec<String> {
        body["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["dueDate"].as_str().unwrap().to_owned())
            .collect()
    };

    let (_, first) = call(&world.app, "GET", "/api/teacher/homework", Some(&a), None).await;
    let ordered = dates(&first);
    let mut expected = ordered.clone();
    expected.sort();
    expected.reverse();
    assert_eq!(ordered, expected, "newest school day first");

    // Repeated requests must not reshuffle.
    let (_, second) = call(&world.app, "GET", "/api/teacher/homework", Some(&a), None).await;
    assert_eq!(dates(&second), ordered);

    // Entries sharing a day are broken by id, descending, so the order is total.
    let (_, same_day) = call(
        &world.app,
        "GET",
        "/api/teacher/homework?from=2026-10-06&to=2026-10-06",
        Some(&a),
        None,
    )
    .await;
    let mut ids: Vec<i64> = Vec::new();
    for _ in 0..3 {
        let (status, created) = create(&world, &a, json!({ "dueDate": "2026-10-06" })).await;
        assert_eq!(status, StatusCode::CREATED);
        ids.push(created["id"].as_i64().unwrap());
    }
    let (_, body) = call(
        &world.app,
        "GET",
        "/api/teacher/homework?from=2026-10-06&to=2026-10-06",
        Some(&a),
        None,
    )
    .await;
    let listed: Vec<i64> = body["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_i64().unwrap())
        .collect();
    let mut descending = ids.clone();
    descending.sort_unstable();
    descending.reverse();
    assert_eq!(listed, descending, "ties break by id descending");
    assert_eq!(same_day["count"], 0);
}

#[tokio::test]
async fn malformed_listing_filters_are_refused_rather_than_widened() {
    let world = world("listing-bad-filters").await;
    let a = teacher_a(&world).await;

    for query in [
        "?from=Jul%2023,%202026",
        "?from=today",
        "?from=2026-02-30",
        "?to=23%2F07%2F2026",
        "?subjectId=abc",
        "?subjectId=0",
        "?limit=0",
        "?limit=-1",
        "?limit=99999",
        "?from=2026-10-06&to=2026-10-01",
    ] {
        let (status, body) = call(
            &world.app,
            "GET",
            &format!("/api/teacher/homework{query}"),
            Some(&a),
            None,
        )
        .await;
        assert_eq!(
            status,
            StatusCode::BAD_REQUEST,
            "{query} must be refused: {body}"
        );
    }
}

// --------------------------------------------------------------------- patch

#[tokio::test]
async fn an_omitted_field_is_untouched() {
    let world = world("patch-partial").await;
    let a = teacher_a(&world).await;

    let (status, body) = call(
        &world.app,
        "PATCH",
        &format!("/api/teacher/homework/{}", world.by_a),
        Some(&a),
        Some(json!({ "classwork": "Exercise 6.1" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    assert_eq!(body["classwork"], "Exercise 6.1");
    assert_eq!(
        body["homework"], "Quadratic equations",
        "omitted must survive"
    );
    assert_eq!(body["dueDate"], "2026-10-01");
    assert_eq!(body["subjectId"].as_i64(), Some(world.subject_a));
    assert_eq!(body["classId"].as_i64(), Some(world.class_a));
    assert_eq!(body["author"]["id"].as_i64(), Some(world.teacher_a));
    assert_eq!(
        body["attachments"][0]["id"].as_i64(),
        Some(world.attachment_id)
    );
}

#[tokio::test]
async fn updated_at_moves_and_created_at_does_not() {
    let world = world("patch-timestamps").await;
    let a = teacher_a(&world).await;

    let (_, before) = call(
        &world.app,
        "GET",
        &format!("/api/teacher/homework/{}", world.by_a),
        Some(&a),
        None,
    )
    .await;
    let created_at = before["createdAt"].as_i64().unwrap();
    let updated_at = before["updatedAt"].as_i64().unwrap();

    // Timestamps are millisecond resolution, so a fast patch can land in the same
    // millisecond as the create. Waiting past a millisecond is what makes the
    // assertion about `updated_at` moving meaningful rather than flaky.
    tokio::time::sleep(std::time::Duration::from_millis(5)).await;

    let (status, body) = call(
        &world.app,
        "PATCH",
        &format!("/api/teacher/homework/{}", world.by_a),
        Some(&a),
        Some(json!({ "dueDate": "2026-10-09" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(
        body["updatedAt"].as_i64().unwrap() > updated_at,
        "updated_at must advance on a successful mutation"
    );
    assert_eq!(
        body["createdAt"].as_i64(),
        Some(created_at),
        "created_at is immutable"
    );
}

#[tokio::test]
async fn clearing_one_half_leaves_the_other_intact_and_a_full_clear_is_refused() {
    let world = world("patch-clear").await;
    let a = teacher_a(&world).await;
    let adm = admin(&world).await;

    // An entry with both halves, so clearing one half has something to spare.
    let (status, both) = call(
        &world.app,
        "PATCH",
        &format!("/api/teacher/homework/{}", world.by_b),
        Some(&adm),
        Some(json!({ "homework": "Refraction problems" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{both}");

    // Explicit null clears that half and leaves the other exactly as it was.
    let (status, body) = call(
        &world.app,
        "PATCH",
        &format!("/api/teacher/homework/{}", world.by_b),
        Some(&adm),
        Some(json!({ "homework": Value::Null })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["homework"], Value::Null);
    assert_eq!(body["classwork"], "Lab note on lenses");

    // The reverse direction too, so the R2 CHECK cannot trip by accident.
    let (status, body) = call(
        &world.app,
        "PATCH",
        &format!("/api/teacher/homework/{}", world.by_b),
        Some(&adm),
        Some(json!({ "classwork": Value::Null, "homework": "Kept" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["classwork"], Value::Null);
    assert_eq!(body["homework"], "Kept");

    // Clearing the last remaining half would trip the R2 CHECK. It must be a 400
    // naming the problem, not a 500 from a constraint violation.
    let (status, body) = call(
        &world.app,
        "PATCH",
        &format!("/api/teacher/homework/{}", world.by_b),
        Some(&adm),
        Some(json!({ "homework": Value::Null })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(
        !body["error"].as_str().unwrap_or_default().contains("CHECK"),
        "no constraint text may leak: {body}"
    );

    // And the entry is untouched by the refused request.
    let stored = homework::find_by_id(&world.db, world.by_b)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.homework_text.as_deref(), Some("Kept"));
    let _ = a;
}

#[tokio::test]
async fn patch_validates_everything_it_touches() {
    let world = world("patch-validate").await;
    let a = teacher_a(&world).await;

    for overrides in [
        json!({ "dueDate": "Jul 23, 2026" }),
        json!({ "dueDate": "2026-02-30" }),
        json!({ "subjectId": 999_999 }),
        json!({ "classId": 999_999 }),
        json!({ "homework": Value::Null, "classwork": Value::Null }),
        json!({ "homework": "   " }),
        json!({ "homework": &"x".repeat(20_001) }),
        json!({ "dueDate": Value::Null }),
        json!({ "subjectId": Value::Null }),
        json!({ "classId": Value::Null }),
    ] {
        let (status, body) = call(
            &world.app,
            "PATCH",
            &format!("/api/teacher/homework/{}", world.by_a),
            Some(&a),
            Some(overrides.clone()),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::BAD_REQUEST,
            "{overrides} must be refused: {body}"
        );
    }

    // Nothing was written by any of those.
    let stored = homework::find_by_id(&world.db, world.by_a)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.homework_text.as_deref(), Some("Quadratic equations"));
    assert_eq!(stored.due_date, "2026-10-01");
    assert_eq!(stored.class_id, world.class_a);
    assert_eq!(stored.subject_id, world.subject_a);

    // A malformed body is a clean 400.
    let response = world
        .app
        .clone()
        .oneshot(
            Request::patch(format!("/api/teacher/homework/{}", world.by_a))
                .header("cookie", format!("{SESSION_COOKIE}={a}"))
                .header("content-type", "application/json")
                .body(Body::from("{oops"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_teacher_may_move_their_own_entry_only_into_a_class_they_teach() {
    let world = world("patch-move").await;
    let a = teacher_a(&world).await;
    let b = teacher_b(&world).await;

    // A is not assigned to class B, so the move is refused.
    let (status, body) = call(
        &world.app,
        "PATCH",
        &format!("/api/teacher/homework/{}", world.by_a),
        Some(&a),
        Some(json!({ "classId": world.class_b })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    // After being assigned, the same move succeeds.
    teacher_classes::assign(&world.db, world.teacher_a, world.class_b)
        .await
        .unwrap();
    let (status, body) = call(
        &world.app,
        "PATCH",
        &format!("/api/teacher/homework/{}", world.by_a),
        Some(&a),
        Some(json!({ "classId": world.class_b, "homework": "Moved and edited" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["classId"].as_i64(), Some(world.class_b));
    assert_eq!(body["homework"], "Moved and edited");
    assert!(body["updatedAt"].as_i64().unwrap() > body["createdAt"].as_i64().unwrap());

    // B cannot touch it: B is not the author.
    let (status, _) = call(
        &world.app,
        "PATCH",
        &format!("/api/teacher/homework/{}", world.by_a),
        Some(&b),
        Some(json!({ "homework": "B was here" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn patching_something_that_does_not_exist_is_a_404() {
    let world = world("patch-404").await;
    let a = teacher_a(&world).await;

    let (status, _) = call(
        &world.app,
        "PATCH",
        "/api/teacher/homework/999999",
        Some(&a),
        Some(json!({ "homework": "x" })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// -------------------------------------------------------------------- delete

#[tokio::test]
async fn deleting_own_homework_cascades_and_is_then_a_404() {
    let world = world("delete").await;
    let a = teacher_a(&world).await;

    // Side rows that must go with the entry, and confirm the cascades really fire.
    mmss_backend::repositories::notes::create(
        &world.db,
        &mmss_backend::models::NewNote {
            user_id: world.student,
            homework_id: Some(world.by_a),
            body: "bring register".into(),
        },
    )
    .await
    .unwrap();
    mmss_backend::repositories::progress::set_completed(&world.db, world.student, world.by_a, true)
        .await
        .unwrap();

    let fixture_attachments: i64 =
        sqlx::query_scalar("SELECT count(*) FROM attachments WHERE homework_id = ?1")
            .bind(world.by_a)
            .fetch_one(&world.db)
            .await
            .unwrap();
    assert_eq!(fixture_attachments, 1, "the fixture attachment is in place");

    let (status, body) = call(
        &world.app,
        "DELETE",
        &format!("/api/teacher/homework/{}", world.by_a),
        Some(&a),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body, json!({ "success": true }));

    // Gone from SQLite, and every dependent row went with it.
    assert!(homework::find_by_id(&world.db, world.by_a)
        .await
        .unwrap()
        .is_none());
    let remaining: Vec<(String, i64)> = sqlx::query_as(
        "SELECT 'attachments', count(*) FROM attachments WHERE homework_id = ?1
         UNION ALL SELECT 'notes', count(*) FROM notes WHERE homework_id = ?1
         UNION ALL SELECT 'progress', count(*) FROM homework_progress WHERE homework_id = ?1",
    )
    .bind(world.by_a)
    .fetch_all(&world.db)
    .await
    .unwrap();
    for (table, rows) in remaining {
        assert_eq!(rows, 0, "{table} rows must have cascaded");
    }

    // Reading and deleting it again are both 404.
    let (status, _) = call(
        &world.app,
        "GET",
        &format!("/api/teacher/homework/{}", world.by_a),
        Some(&a),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = call(
        &world.app,
        "DELETE",
        &format!("/api/teacher/homework/{}", world.by_a),
        Some(&a),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn an_admin_may_delete_any_homework_including_another_teachers() {
    let world = world("delete-admin").await;
    let adm = admin(&world).await;

    let (status, body) = call(
        &world.app,
        "DELETE",
        &format!("/api/teacher/homework/{}", world.by_a),
        Some(&adm),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(homework::find_by_id(&world.db, world.by_a)
        .await
        .unwrap()
        .is_none());
    // A colleague's entry is equally removable.
    let (status, _) = call(
        &world.app,
        "DELETE",
        &format!("/api/teacher/homework/{}", world.by_b),
        Some(&adm),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn deleting_nothing_leaves_no_partial_state() {
    let world = world("delete-none").await;
    let a = teacher_a(&world).await;

    let before: i64 = sqlx::query_scalar("SELECT count(*) FROM homework")
        .fetch_one(&world.db)
        .await
        .unwrap();
    let (status, _) = call(
        &world.app,
        "DELETE",
        "/api/teacher/homework/999999",
        Some(&a),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let after: i64 = sqlx::query_scalar("SELECT count(*) FROM homework")
        .fetch_one(&world.db)
        .await
        .unwrap();
    assert_eq!(after, before);
}

// ---------------------------------------------------------------- attachments

#[tokio::test]
async fn attachment_metadata_is_stored_and_readable() {
    let world = world("attachments").await;
    let a = teacher_a(&world).await;

    let (status, body) = create(
        &world,
        &a,
        json!({
            "homework": "Worksheets attached",
            "attachments": [
                {
                    "filename": "worksheet.pdf",
                    "mimeType": "application/pdf",
                    "sizeBytes": 204_800,
                    "storageKey": "homework/2026/10/worksheet.pdf",
                },
                {
                    "filename": "answers.png",
                    "mimeType": "image/png",
                    "sizeBytes": 51_200,
                    "storageKey": "homework/2026/10/answers.png",
                },
            ],
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let attachments = body["attachments"].as_array().unwrap();
    assert_eq!(attachments.len(), 2);
    assert_eq!(attachments[0]["filename"], "worksheet.pdf");
    assert_eq!(attachments[0]["mimeType"], "application/pdf");
    assert_eq!(attachments[0]["sizeBytes"], 204_800);
    assert_eq!(
        attachments[0]["storageKey"],
        "homework/2026/10/worksheet.pdf"
    );
    assert!(attachments[0]["id"].as_i64().unwrap() > 0);
    // No URL: this API serves no bytes, so it must not advertise one.
    assert!(attachments[0].get("url").is_none());

    let id = body["id"].as_i64().unwrap();
    let stored = attachments::list_by_homework(&world.db, id).await.unwrap();
    assert_eq!(stored.len(), 2);
    assert_eq!(stored[0].filename, "worksheet.pdf");
}

#[tokio::test]
async fn invalid_attachment_metadata_is_refused() {
    let world = world("attachments-bad").await;
    let a = teacher_a(&world).await;

    for attachment in [
        json!({ "filename": "  ", "mimeType": "application/pdf", "sizeBytes": 10, "storageKey": "k" }),
        json!({ "filename": "f.pdf", "mimeType": "", "sizeBytes": 10, "storageKey": "k" }),
        json!({ "filename": "f.pdf", "mimeType": "application/pdf", "sizeBytes": 10, "storageKey": "   " }),
        json!({ "filename": "f.pdf", "mimeType": "application/pdf", "sizeBytes": -1, "storageKey": "k" }),
        json!({ "filename": "f.pdf", "mimeType": "application/pdf", "sizeBytes": 70 * 1024 * 1024, "storageKey": "k" }),
        // A missing field is a malformed body, not a default.
        json!({ "filename": "f.pdf", "mimeType": "application/pdf", "sizeBytes": 10 }),
    ] {
        let (status, body) =
            create(&world, &a, json!({ "attachments": [attachment.clone()] })).await;
        assert_eq!(
            status,
            StatusCode::BAD_REQUEST,
            "{attachment} must be refused: {body}"
        );
    }

    // More files than a request should declare.
    let many: Vec<Value> = (0..21)
        .map(|i| {
            json!({
                "filename": format!("f{i}.pdf"),
                "mimeType": "application/pdf",
                "sizeBytes": 10,
                "storageKey": format!("k{i}"),
            })
        })
        .collect();
    let (status, body) = create(&world, &a, json!({ "attachments": many })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
}

#[tokio::test]
async fn the_attachments_table_stores_metadata_and_never_file_bytes() {
    let world = world("attachments-schema").await;

    // `PRAGMA table_info` returns six columns whose first is the integer `cid`, so
    // selecting the whole row would not decode into a String. The table-valued form
    // lets just `name` be selected.
    let columns: Vec<String> =
        sqlx::query_scalar("SELECT name FROM pragma_table_info('attachments')")
            .fetch_all(&world.db)
            .await
            .unwrap();
    for expected in [
        "id",
        "homework_id",
        "filename",
        "mime_type",
        "size_bytes",
        "storage_key",
        "created_at",
    ] {
        assert!(
            columns.contains(&expected.to_string()),
            "missing {expected}"
        );
    }
    // No bytes column. `BLOB` is what one would look like; there is none, and no
    // storage_key that resolves to a local file either.
    assert!(
        !columns.iter().any(|name| {
            let lower = name.to_ascii_lowercase();
            lower.contains("blob") || lower.contains("content") || lower.contains("data")
        }),
        "file bytes must never live in SQLite: {columns:?}"
    );
}

// -------------------------------------------------------- transaction boundary

#[tokio::test]
async fn a_failed_multi_row_create_leaves_no_partial_state() {
    let world = world("rollback").await;
    let a = teacher_a(&world).await;

    let before: Vec<i64> = sqlx::query_scalar("SELECT id FROM homework ORDER BY id")
        .fetch_all(&world.db)
        .await
        .unwrap();
    let attachments_before: i64 = sqlx::query_scalar("SELECT count(*) FROM attachments")
        .fetch_one(&world.db)
        .await
        .unwrap();

    // A create whose *second* attachment row cannot be written: the storage key
    // collides with an existing row's, which the schema refuses by way of the
    // foreign key on `homework_id` after the first insert has already succeeded.
    // Forced directly against a transaction so the failure lands mid-write.
    let mut tx = world.db.begin().await.unwrap();
    let entry = homework::create(
        &mut *tx,
        &NewHomework {
            class_id: world.class_a,
            subject_id: world.subject_a,
            author_id: Some(world.teacher_a),
            due_date: "2026-10-07".into(),
            homework_text: Some("Should not survive".into()),
            classwork_text: None,
        },
    )
    .await
    .unwrap();
    attachments::create(
        &mut *tx,
        &NewAttachment {
            homework_id: entry.id,
            filename: "ok.pdf".into(),
            mime_type: "application/pdf".into(),
            size_bytes: 10,
            storage_key: "k".into(),
        },
    )
    .await
    .unwrap();
    // This one violates the R2 CHECK (`size_bytes >= 0`), so it fails.
    let failed = attachments::create(
        &mut *tx,
        &NewAttachment {
            homework_id: entry.id,
            filename: "bad.pdf".into(),
            mime_type: "application/pdf".into(),
            size_bytes: -1,
            storage_key: "k2".into(),
        },
    )
    .await;
    assert!(failed.is_err(), "a negative size must fail the CHECK");
    // Dropping without committing rolls the whole thing back, exactly as the service
    // does when an attachment in the middle of the list fails.
    drop(tx);

    let after: Vec<i64> = sqlx::query_scalar("SELECT id FROM homework ORDER BY id")
        .fetch_all(&world.db)
        .await
        .unwrap();
    assert_eq!(
        after, before,
        "the entry must not survive a rolled-back create"
    );
    let attachments_after: i64 = sqlx::query_scalar("SELECT count(*) FROM attachments")
        .fetch_one(&world.db)
        .await
        .unwrap();
    assert_eq!(
        attachments_after, attachments_before,
        "and neither may its attachments"
    );

    // The service itself refuses a bad attachment before writing anything, so the
    // count is unchanged either way.
    let (status, _) = create(
        &world,
        &a,
        json!({
            "attachments": [{
                "filename": "ok.pdf", "mimeType": "application/pdf",
                "sizeBytes": 10, "storageKey": "k",
            }],
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

// ------------------------------------------------- teacher <-> student sharing

#[tokio::test]
async fn a_student_reads_the_same_record_the_teacher_wrote() {
    let world = world("shared").await;
    let a = teacher_a(&world).await;
    let stu = student(&world).await;

    // The teacher writes through the new API.
    let (status, created) = create(
        &world,
        &a,
        json!({
            "classId": world.class_a,
            "subjectId": world.subject_b,
            "dueDate": "2026-10-08",
            "homework": "Refraction problems",
            "classwork": "Lab note on lenses",
            "attachments": [{
                "filename": "worksheet.pdf",
                "mimeType": "application/pdf",
                "sizeBytes": 204_800,
                "storageKey": "homework/2026/10/shared.pdf",
            }],
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let id = created["id"].as_i64().unwrap();

    // The student reads the SAME row through the frozen R4 endpoint. One record, no
    // duplication: the feed and the management list are two views of one table.
    let (status, feed) = call(&world.app, "GET", "/api/homework", Some(&stu), None).await;
    assert_eq!(status, StatusCode::OK, "{feed}");
    let entry = feed["homework"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["id"].as_i64() == Some(id))
        .expect("the student's feed must contain the teacher's new entry");

    assert_eq!(entry["subjectId"].as_i64(), Some(world.subject_b));
    assert_eq!(entry["subject"], "Physics");
    assert_eq!(entry["classId"].as_i64(), Some(world.class_a));
    assert_eq!(entry["date"], "2026-10-08");
    assert_eq!(entry["displayDate"], "Oct 8, 2026");
    assert_eq!(entry["homework"], created["homework"]);
    assert_eq!(entry["classwork"], created["classwork"]);
    assert_eq!(
        entry["author"]["id"].as_i64(),
        created["author"]["id"].as_i64()
    );
    assert_eq!(entry["author"]["displayName"], "Teacher A");
    assert_eq!(entry["attachments"], created["attachments"]);

    // And the single-row student endpoint agrees.
    let (status, single) = call(
        &world.app,
        "GET",
        &format!("/api/homework/{id}"),
        Some(&stu),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{single}");
    assert_eq!(single["homework"], created["homework"]);
    assert_eq!(single["attachments"], created["attachments"]);

    // Exactly one row in SQLite -- the two APIs are not storing anything twice.
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM homework WHERE id = ?1")
        .bind(id)
        .fetch_one(&world.db)
        .await
        .unwrap();
    assert_eq!(rows, 1);
    let attachment_rows: i64 =
        sqlx::query_scalar("SELECT count(*) FROM attachments WHERE homework_id = ?1")
            .bind(id)
            .fetch_one(&world.db)
            .await
            .unwrap();
    assert_eq!(attachment_rows, 1);
}

// ---------------------------------------------------------- schema invariants

#[tokio::test]
async fn teacher_class_assignments_are_unique_and_cascade() {
    let world = world("assign").await;

    // The composite primary key makes a duplicate impossible.
    assert!(
        !teacher_classes::assign(&world.db, world.teacher_a, world.class_a)
            .await
            .unwrap()
    );
    let rows: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM teacher_classes WHERE teacher_id = ?1 AND class_id = ?2",
    )
    .bind(world.teacher_a)
    .bind(world.class_a)
    .fetch_one(&world.db)
    .await
    .unwrap();
    assert_eq!(rows, 1);

    // `teaches` is the authorization question and it agrees with the row.
    assert!(
        teacher_classes::teaches(&world.db, world.teacher_a, world.class_a)
            .await
            .unwrap()
    );
    assert!(
        !teacher_classes::teaches(&world.db, world.teacher_a, world.class_b)
            .await
            .unwrap()
    );
    assert_eq!(
        teacher_classes::list_for_teacher(&world.db, world.teacher_a)
            .await
            .unwrap(),
        vec![world.class_a]
    );

    // Deleting the teacher cascades the assignment.
    mmss_backend::repositories::users::delete(&world.db, world.teacher_a)
        .await
        .unwrap();
    let remaining: i64 =
        sqlx::query_scalar("SELECT count(*) FROM teacher_classes WHERE teacher_id = ?1")
            .bind(world.teacher_a)
            .fetch_one(&world.db)
            .await
            .unwrap();
    assert_eq!(remaining, 0);
}

#[tokio::test]
async fn the_role_teacher_invariant_on_teacher_classes_is_enforced() {
    let world = world("role-invariant").await;

    // The documented dev path refuses a student and an admin in the teacher_id
    // column. A SQLite CHECK cannot reference `users`, so this is a trigger -- the
    // migration says so, and this test is what makes that claim true rather than
    // asserted.
    for not_a_teacher in [world.student, world.admin] {
        let result = teacher_classes::assign(&world.db, not_a_teacher, world.class_b).await;
        assert!(
            result.is_err(),
            "role=teacher must be enforced; user {not_a_teacher} was accepted"
        );
    }

    // An unknown teacher_id is refused by the foreign key, not silently inserted.
    assert!(teacher_classes::assign(&world.db, 999_999, world.class_b)
        .await
        .is_err());

    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM teacher_classes")
        .fetch_one(&world.db)
        .await
        .unwrap();
    assert_eq!(rows, 2, "only the two fixture assignments exist");

    // A genuine teacher is accepted.
    assert!(
        teacher_classes::assign(&world.db, world.teacher_b, world.class_a)
            .await
            .unwrap()
    );
}

// ------------------------------------------------------------- e2e over HTTP

#[tokio::test]
async fn the_teacher_journey_works_over_http() {
    let world = world("journey").await;

    // 1. login
    let token = teacher_a(&world).await;

    // 2. list
    let (status, _) = call(
        &world.app,
        "GET",
        "/api/teacher/homework",
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // 3. create
    let (status, created) = create(&world, &token, json!({})).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let id = created["id"].as_i64().unwrap();

    // 4. read
    let (status, read) = call(
        &world.app,
        "GET",
        &format!("/api/teacher/homework/{id}"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{read}");
    assert_eq!(read["homework"], "Read pages 10-20");

    // 5. PATCH only the classwork field
    let (status, patched) = call(
        &world.app,
        "PATCH",
        &format!("/api/teacher/homework/{id}"),
        Some(&token),
        Some(json!({ "classwork": "Exercise 6.1" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{patched}");
    assert_eq!(patched["classwork"], "Exercise 6.1");
    assert_eq!(
        patched["homework"], "Read pages 10-20",
        "the homework text must survive a classwork-only edit"
    );

    // 6. read again
    let (status, read_again) = call(
        &world.app,
        "GET",
        &format!("/api/teacher/homework/{id}"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(read_again["classwork"], "Exercise 6.1");
    assert_eq!(read_again["homework"], "Read pages 10-20");

    // 7. delete
    let (status, _) = call(
        &world.app,
        "DELETE",
        &format!("/api/teacher/homework/{id}"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // 8. now a 404
    let (status, _) = call(
        &world.app,
        "GET",
        &format!("/api/teacher/homework/{id}"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // 9. logout, after which the same request is a 401
    let (status, _) = call(&world.app, "POST", "/api/auth/logout", Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = call(
        &world.app,
        "GET",
        "/api/teacher/homework",
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
