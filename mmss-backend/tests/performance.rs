//! Performance sanity check against a realistic fixture.
//!
//! This is a smoke test with a ceiling, not a benchmark suite. It exists so that a
//! schema or query change that makes a student request obviously slow fails loudly in CI
//! instead of being noticed by a student. It deliberately does not compare against a
//! recorded baseline, because a baseline on shared CI hardware is noise.
//!
//! Fixture size is chosen to be comfortably larger than a real class: a school term of
//! daily homework across every subject, which is the shape the data actually has.
//!
//! What is measured is the *handler*, so it includes session validation and JSON
//! serialisation, not just the SQL.

use std::time::{Duration, Instant};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use mmss_backend::config::Config;
use mmss_backend::cookies::SESSION_COOKIE;
use mmss_backend::models::{NewAttachment, NewClass, NewHomework, NewSubject, NewUser, Role};
use mmss_backend::repositories::{attachments, classes, homework, subjects, teacher_classes};
use mmss_backend::services::auth::AuthService;
use mmss_backend::state::AppState;
use serde_json::json;
use sqlx::Row;
use tower::ServiceExt;

const STUDENT_PASSWORD: &str = "perf-test-password";
const TEACHER_PASSWORD: &str = "perf-teacher-password";
const TERMS: usize = 90;
const SUBJECTS: usize = 14;
const PER_SUBJECT_PER_DAY: usize = 2;

/// Nothing here should take anything like this long against a local SQLite file. The
/// numbers are loose on purpose: a slow shared CI box should not fail the suite, but a
/// missing index or an accidental N+1 will blow straight through.
const BUDGET: Duration = Duration::from_millis(400);

struct Fixture {
    app: axum::Router,
    db: sqlx::SqlitePool,
    /// The config the app was started with, so a caller can build an `AuthService`
    /// against the same hashing parameters rather than inventing one.
    config: Config,
    token: String,
    class_id: i64,
    subject_ids: Vec<i64>,
    date_range: String,
}

/// A term of homework for one class: `TERMS` school days, `SUBJECTS` subjects, several
/// entries per subject per day, plus notes, ticks and attachment metadata throughout.
async fn build(tag: &str) -> Fixture {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("mmss-perf-{}-{tag}-{unique}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let state = AppState::new(Config::for_tests(format!(
        "sqlite://{}/mmss.db",
        dir.display()
    )))
    .await
    .unwrap();
    let db = state.db.clone();
    let auth = AuthService::new(&db, &state.config);

    let class = classes::create(&db, &NewClass::new("9-F")).await.unwrap();
    let subject_ids: Vec<i64> = futures_pool(&db, SUBJECTS).await;

    let student = auth
        .create_user_with_password(
            &NewUser {
                school_id: "perf.student".into(),
                display_name: Some("Perf Student".into()),
                role: Role::Student,
                class_id: Some(class.id),
            },
            STUDENT_PASSWORD,
        )
        .await
        .unwrap();

    let mut entry_count = 0;
    for day in 0..TERMS {
        // School days only, so the fixture is not weighted towards weekends.
        let date = format!("2026-04-{:02}", (day % 28) + 1);
        for (index, subject_id) in subject_ids.iter().enumerate() {
            for n in 0..PER_SUBJECT_PER_DAY {
                let entry = homework::create(
                    &db,
                    &NewHomework {
                        class_id: class.id,
                        subject_id: *subject_id,
                        author_id: None,
                        due_date: date.clone(),
                        homework_text: Some(format!(
                            "Set {day}-{index}-{n}: exercise {} to {}",
                            n * 7 + 1,
                            n + 3
                        )),
                        classwork_text: if n == 0 {
                            Some(format!("Work through the notes on page {}", n + 1))
                        } else {
                            None
                        },
                    },
                )
                .await
                .unwrap();
                entry_count += 1;

                // Realistic side data: a third of entries carry an attachment, a third
                // are ticked, a few have notes.
                if entry_count % 3 == 0 {
                    attachments::create(
                        &db,
                        &NewAttachment {
                            homework_id: entry.id,
                            filename: format!("worksheet-{entry_count}.pdf"),
                            mime_type: "application/pdf".into(),
                            size_bytes: 120_000,
                            storage_key: format!("homework/2026/04/{entry_count}.pdf"),
                        },
                    )
                    .await
                    .unwrap();
                }
                if entry_count % 3 == 1 {
                    mmss_backend::repositories::progress::set_completed(
                        &db,
                        student.user_id,
                        entry.id,
                        true,
                    )
                    .await
                    .unwrap();
                }
                if entry_count % 50 == 0 {
                    mmss_backend::repositories::notes::create(
                        &db,
                        &mmss_backend::models::NewNote {
                            user_id: student.user_id,
                            homework_id: Some(entry.id),
                            body: format!("note on entry {entry_count}"),
                        },
                    )
                    .await
                    .unwrap();
                }
            }
        }
    }

    let config = state.config.clone();
    let app = mmss_backend::app(state);
    let token = login(&app).await;
    Fixture {
        app,
        db,
        config,
        token,
        class_id: class.id,
        subject_ids,
        date_range: "from=2026-04-01&to=2026-04-10".into(),
    }
}

async fn futures_pool(db: &sqlx::SqlitePool, count: usize) -> Vec<i64> {
    const NAMES: [&str; SUBJECTS] = [
        "Mathematics",
        "Physics",
        "Chemistry",
        "Biology",
        "English",
        "Hindi",
        "Punjabi",
        "History",
        "Geography",
        "Economics",
        "Political Science",
        "Social Science",
        "Computers",
        "Physical Edu.",
    ];
    let mut ids = Vec::with_capacity(count);
    for name in NAMES.iter().take(count) {
        ids.push(
            subjects::create(db, &NewSubject::new(*name))
                .await
                .unwrap()
                .id,
        );
    }
    ids
}

async fn login(app: &axum::Router) -> String {
    let response = app
        .clone()
        .oneshot(
            Request::post("/api/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "studentId": "perf.student",
                        "password": STUDENT_PASSWORD,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    response
        .headers()
        .get(axum::http::header::SET_COOKIE)
        .unwrap()
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

/// Times `rounds` sequential requests and returns the median, which is far less noisy
/// on shared hardware than a mean and is what a student actually experiences.
async fn time(app: &axum::Router, path: &str, token: &str, rounds: u32) -> (Duration, u64) {
    let mut samples = Vec::with_capacity(rounds as usize);
    let mut bytes = 0;
    for _ in 0..rounds {
        let started = Instant::now();
        let response = app
            .clone()
            .oneshot(
                Request::get(path)
                    .header("cookie", format!("{SESSION_COOKIE}={token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::OK,
            "{path} answered {}",
            response.status()
        );
        // The body must actually be read, or the timing would skip serialisation.
        bytes = response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .len() as u64;
        samples.push(started.elapsed());
    }
    samples.sort();
    (samples[samples.len() / 2], bytes)
}

/// Each of these is a request a student makes on a screen. The budget is generous; the
/// point is to catch a missing index or a per-entry query, not to police microseconds.
#[tokio::test]
async fn student_endpoints_stay_within_a_generous_budget() {
    let fixture = build("endpoints").await;

    let paths = [
        ("GET /api/homework", "/api/homework"),
        (
            "GET /api/homework (filtered)",
            &format!("/api/homework?{}", fixture.date_range),
        ),
        (
            "GET /api/homework (by subject)",
            &format!("/api/homework?subjectId={}", fixture.subject_ids[0]),
        ),
        ("GET /api/subjects", "/api/subjects"),
        ("GET /api/notes", "/api/notes"),
        ("GET /api/progress", "/api/progress"),
    ];

    println!(
        "fixture: {TERMS} school days x {SUBJECTS} subjects x {PER_SUBJECT_PER_DAY} entries = {} entries",
        TERMS * SUBJECTS * PER_SUBJECT_PER_DAY
    );

    let mut report = Vec::new();
    for (label, path) in paths {
        let (median, bytes) = time(&fixture.app, path, &fixture.token, 11).await;
        println!("  {label:<34} median {median:>10.3?}  ({bytes:>7} bytes)");
        assert!(
            median < BUDGET,
            "{label} took {median:?}, over the {BUDGET:?} budget for {path}"
        );
        report.push((label, median, bytes));
    }

    // Sanity: the unfiltered feed really did return the whole term, so this is not a
    // fast test of an empty query.
    let (_, unfiltered_bytes) = time(&fixture.app, "/api/homework", &fixture.token, 3).await;
    let (_, ten_days) = time(
        &fixture.app,
        &format!("/api/homework?{}", fixture.date_range),
        &fixture.token,
        3,
    )
    .await;
    assert!(
        unfiltered_bytes > ten_days,
        "the full feed ({unfiltered_bytes} bytes) should dwarf a 10-day slice ({ten_days} bytes)"
    );
    println!("\nfull feed {unfiltered_bytes} bytes vs 10-day slice {ten_days} bytes");

    // Query plan for the feed: the class+day index must serve it, or these numbers hide
    // a table scan that only a much bigger school would expose.
    //
    // `EXPLAIN QUERY PLAN` returns rows of (id, parent, notused, detail), so this maps the
    // detail column rather than pulling the row into a tuple.
    let steps: Vec<String> = sqlx::query(
        "EXPLAIN QUERY PLAN
         SELECT id FROM homework WHERE class_id = ?1 ORDER BY due_date DESC, id DESC",
    )
    .bind(1i64)
    .fetch_all(&fixture.db)
    .await
    .unwrap_or_default()
    .into_iter()
    .filter_map(|row| row.try_get::<String, _>(3).ok())
    .collect();
    let plan = steps.join(" | ");
    println!("feed plan: {plan}");
    assert!(
        plan.contains("idx_homework_class_due"),
        "the feed must use idx_homework_class_due, not scan the table: {plan}"
    );
    assert!(
        !plan.contains("SCAN homework"),
        "the feed must not scan the homework table: {plan}"
    );

    let count = report.len();
    assert_eq!(count, 6, "every measured endpoint must be exercised");
}

/// The teacher management endpoints against the same realistic fixture.
///
/// Writes are timed too, which the student suite cannot do: a create with
/// attachments opens a transaction, and an accidental per-row insert outside it
/// would still be fast on a small page. The budget is loose for the same reason --
/// this catches a missing index or an N+1, not a slow machine.
#[tokio::test]
async fn teacher_endpoints_stay_within_a_generous_budget() {
    let fixture = build("teacher").await;
    let db = fixture.db.clone();

    // A teacher assigned to the same class, plus one extra class so the listing's
    // "several classes at once" path is exercised rather than assumed.
    let auth = AuthService::new(&db, &fixture.config);
    let teacher = auth
        .create_user_with_password(
            &NewUser {
                school_id: "perf.teacher".into(),
                display_name: Some("Perf Teacher".into()),
                role: Role::Teacher,
                class_id: None,
            },
            TEACHER_PASSWORD,
        )
        .await
        .unwrap();
    let other_class = classes::create(&db, &NewClass::new("9-A")).await.unwrap();
    teacher_classes::assign(&db, teacher.user_id, fixture.class_id)
        .await
        .unwrap();
    teacher_classes::assign(&db, teacher.user_id, other_class.id)
        .await
        .unwrap();

    let token = sign_in_as(&fixture.app, "perf.teacher", TEACHER_PASSWORD).await;
    println!(
        "teacher fixture: {TERMS} school days x {SUBJECTS} subjects x {PER_SUBJECT_PER_DAY} entries, 2 assigned classes",
    );

    // Reads.
    for (label, path) in [
        ("GET /api/teacher/homework", "/api/teacher/homework"),
        (
            "GET /api/teacher/homework (filtered)",
            &format!("/api/teacher/homework?{}", fixture.date_range),
        ),
        (
            "GET /api/teacher/homework (by subject)",
            &format!("/api/teacher/homework?subjectId={}", fixture.subject_ids[0]),
        ),
        (
            "GET /api/teacher/homework (limit)",
            "/api/teacher/homework?limit=50",
        ),
    ] {
        let (median, bytes) = time(&fixture.app, path, &token, 11).await;
        println!("  {label:<40} median {median:>10.3?}  ({bytes:>7} bytes)");
        assert!(
            median < BUDGET,
            "{label} took {median:?}, over the {BUDGET:?} budget for {path}"
        );
    }

    // Writes. The same generous budget; these are one-off actions per school day,
    // but a create that regressed to per-row inserts would show up here.
    let create_body = json!({
        "classId": fixture.class_id,
        "subjectId": fixture.subject_ids[0],
        "dueDate": "2026-04-15",
        "homework": "Exercise 4.1 to 4.6",
        "classwork": "Work through the notes on page 42",
    })
    .to_string();

    let mut create_samples = Vec::new();
    let mut created_id = None;
    for _ in 0..11 {
        let started = Instant::now();
        let response = fixture
            .app
            .clone()
            .oneshot(
                Request::post("/api/teacher/homework")
                    .header("cookie", format!("{SESSION_COOKIE}={token}"))
                    .header("content-type", "application/json")
                    .body(Body::from(create_body.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        created_id = serde_json::from_slice::<serde_json::Value>(&bytes)
            .ok()
            .and_then(|v| v["id"].as_i64());
        create_samples.push(started.elapsed());
    }
    create_samples.sort();
    let create_median = create_samples[create_samples.len() / 2];
    println!(
        "  {:<40} median {create_median:>10.3?}",
        "POST /api/teacher/homework"
    );
    assert!(create_median < BUDGET, "create took {create_median:?}");
    let id = created_id.expect("the created entry must have an id");

    // One create carrying attachment metadata, so the transaction path is timed
    // rather than assumed.
    let with_attachment = json!({
        "classId": fixture.class_id,
        "subjectId": fixture.subject_ids[0],
        "dueDate": "2026-04-15",
        "homework": "With a worksheet",
        "attachments": [{
            "filename": "worksheet.pdf",
            "mimeType": "application/pdf",
            "sizeBytes": 120_000,
            "storageKey": "homework/2026/04/perf-worksheet.pdf",
        }],
    })
    .to_string();
    let started = Instant::now();
    let response = fixture
        .app
        .clone()
        .oneshot(
            Request::post("/api/teacher/homework")
                .header("cookie", format!("{SESSION_COOKIE}={token}"))
                .header("content-type", "application/json")
                .body(Body::from(with_attachment))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    response.into_body().collect().await.unwrap();
    let attach_median = started.elapsed();
    println!(
        "  {:<40} median {attach_median:>10.3?}",
        "POST (with an attachment)"
    );
    assert!(
        attach_median < BUDGET,
        "create with an attachment took {attach_median:?}"
    );

    // Update.
    let mut update_samples = Vec::new();
    for _ in 0..11 {
        let started = Instant::now();
        let response = fixture
            .app
            .clone()
            .oneshot(
                Request::patch(format!("/api/teacher/homework/{id}"))
                    .header("cookie", format!("{SESSION_COOKIE}={token}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({ "classwork": "Exercise 4.2" }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        response.into_body().collect().await.unwrap();
        update_samples.push(started.elapsed());
    }
    update_samples.sort();
    let update_median = update_samples[update_samples.len() / 2];
    println!(
        "  {:<40} median {update_median:>10.3?}",
        "PATCH /api/teacher/homework/{id}"
    );
    assert!(update_median < BUDGET, "update took {update_median:?}");

    // Delete, measured once: the entry is gone afterwards.
    let started = Instant::now();
    let response = fixture
        .app
        .clone()
        .oneshot(
            Request::delete(format!("/api/teacher/homework/{id}"))
                .header("cookie", format!("{SESSION_COOKIE}={token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    response.into_body().collect().await.unwrap();
    let delete_median = started.elapsed();
    println!(
        "  {:<40} median {delete_median:>10.3?}",
        "DELETE /api/teacher/homework/{id}"
    );
    assert!(delete_median < BUDGET, "delete took {delete_median:?}");

    // Query plans. The teacher's listing is `class_id IN (...)` rather than a single
    // equality, which the same index serves -- worth asserting rather than assuming,
    // since an IN list can tempt SQLite into a scan on some shapes.
    let steps: Vec<String> = sqlx::query(
        "EXPLAIN QUERY PLAN
         SELECT id FROM homework WHERE class_id IN (1, 2) ORDER BY due_date DESC, id DESC",
    )
    .fetch_all(&db)
    .await
    .unwrap_or_default()
    .into_iter()
    .filter_map(|row| row.try_get::<String, _>(3).ok())
    .collect();
    let plan = steps.join(" | ");
    println!("teacher list plan: {plan}");
    assert!(
        plan.contains("idx_homework_class_due"),
        "the teacher listing must use idx_homework_class_due: {plan}"
    );
    // Recorded rather than asserted away: an `IN (...)` of two classes gives SQLite an
    // equality probe per class, so it sorts the union with a temp B-tree rather than
    // reading one index range end to end. That is the right trade at a teacher's
    // timetable width -- the row count is unchanged and it avoids the index scan a
    // UNION ALL of separate index ranges would need. It would become worth revisiting
    // only if a teacher were assigned a large number of sections, which no school
    // does.
    assert!(
        !plan.contains("SCAN homework"),
        "the teacher listing must not scan the homework table: {plan}"
    );

    // The assignment lookup behind the listing is a single indexed probe per teacher,
    // and the composite primary key covers it.
    let steps: Vec<String> = sqlx::query(
        "EXPLAIN QUERY PLAN
         SELECT class_id FROM teacher_classes WHERE teacher_id = ?1 ORDER BY class_id",
    )
    .bind(teacher.user_id)
    .fetch_all(&db)
    .await
    .unwrap_or_default()
    .into_iter()
    .filter_map(|row| row.try_get::<String, _>(3).ok())
    .collect();
    let plan = steps.join(" | ");
    println!("assignment lookup plan: {plan}");
    assert!(
        !plan.contains("SCAN teacher_classes"),
        "the assignment lookup must be indexed: {plan}"
    );
}

/// Signs in as a named account and returns its session cookie.
async fn sign_in_as(app: &axum::Router, school_id: &str, password: &str) -> String {
    let response = app
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
    assert_eq!(response.status(), StatusCode::OK);
    response
        .headers()
        .get(axum::http::header::SET_COOKIE)
        .unwrap()
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
