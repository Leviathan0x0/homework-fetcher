//! Phase 7 tests for the EduSecure boundary.
//!
//! Every test here runs with **no EduSecure credentials and no network**. The client is a
//! trait, so the tests supply their own implementations: one that succeeds, one that fails
//! in each way the service distinguishes, and the real `DisabledClient`.
//!
//! The single most important property under test is the one the phase exists for: **a
//! failure on the other side never damages the local record.** MMSS64 owns homework;
//! EduSecure is a copy destination. Every failure test asserts the `homework` row is still
//! there, unchanged, and still readable through the R4 student API afterwards.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use mmss_backend::config::Config;
use mmss_backend::cookies::SESSION_COOKIE;
use mmss_backend::models::{NewHomework, NewUser, Role};
use mmss_backend::repositories::{classes, homework, subjects, teacher_classes};
use mmss_backend::services::auth::AuthService;
use mmss_backend::services::edusecure::{
    parse_announcement_html, parse_portal_date, split_diary_body, DisabledClient, EduSecureClient,
    EduSecureService, PortalError, PublishFuture,
};
use mmss_backend::state::AppState;
use serde_json::{json, Value};
use tower::ServiceExt;

static NEXT_ID: AtomicU32 = AtomicU32::new(0);

const STUDENT_PASSWORD: &str = "test-student-password";
const TEACHER_PASSWORD: &str = "test-teacher-password";
const ADMIN_PASSWORD: &str = "test-admin-password";

/// A portal page shaped like the old `Announcement.aspx?Type=Homework` grid.
///
/// Uses the real control id, the real merged `<p>` body with `Homework:` / `Classwork:`
/// markers, and a `<small>` holding a display-string date -- the three things R7 has to
/// read and the two things it has to undo.
const ANNOUNCEMENT_PAGE: &str = r#"
<html><body>
<table id="ctl00_ContentPlaceHolder1_grdDashContents">
<tr>
  <td><span id="ctl00_ContentPlaceHolder1_grdDashContents_ctl02_lbltype">School Diary</span></td>
  <td><small>Oct 5, 2026</small></td>
  <td><p><b>Homework:</b> Complete exercises 1-10.</p></td>
</tr>
<tr>
  <td><span id="ctl00_ContentPlaceHolder1_grdDashContents_ctl03_lbltype">School Diary</span></td>
  <td><small>Oct 6, 2026</small></td>
  <td><p><b>Homework:</b> Read pages 40-52.<br/><b>Classwork:</b> Exercise 6.1</p>
      <a id="ctl00_ContentPlaceHolder1_grdDashContents_ctl03_HyperLink1"
         href="/ParentApp/Download?id=99">worksheet.pdf</a>
  </td>
</tr>
</table>
</body></html>
"#;

// ---------------------------------------------------------------- fake clients

/// A fake that records what it was asked to publish and answers with `outcome`.
struct FakeClient {
    outcome: Result<Option<String>, PortalError>,
    /// Every entry the service handed us, as `(subject, homework)`.
    seen: Mutex<Vec<(String, Option<String>)>>,
    calls: AtomicU32,
}

impl FakeClient {
    fn ok() -> Arc<Self> {
        Arc::new(Self {
            outcome: Ok(Some("PORTAL-42".into())),
            seen: Mutex::new(Vec::new()),
            calls: AtomicU32::new(0),
        })
    }

    fn failing(error: PortalError) -> Arc<Self> {
        Arc::new(Self {
            outcome: Err(error),
            seen: Mutex::new(Vec::new()),
            calls: AtomicU32::new(0),
        })
    }

    fn calls(&self) -> u32 {
        self.calls.load(Ordering::SeqCst)
    }

    fn seen(&self) -> Vec<(String, Option<String>)> {
        self.seen.lock().unwrap().clone()
    }
}

impl EduSecureClient for FakeClient {
    fn publish<'a>(
        &'a self,
        entry: &'a mmss_backend::models::Homework,
        class_name: &'a str,
        subject_name: &'a str,
    ) -> PublishFuture<'a> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.seen
            .lock()
            .unwrap()
            .push((subject_name.to_owned(), entry.homework_text.clone()));
        // The class name is resolved for the caller; assert it is the real one.
        assert!(!class_name.is_empty(), "the client is given a class name");
        let outcome = self.outcome.clone();
        Box::pin(async move { outcome })
    }
}

// ---------------------------------------------------------------------- world

struct World {
    app: axum::Router,
    db: sqlx::SqlitePool,
    class_id: i64,
    subject_id: i64,
    /// Teacher-written, in the student's class. This is the entry that must stay
    /// authoritative no matter what the portal does.
    authored: i64,
}

/// `enabled` models whether credentials are configured.
async fn world(tag: &str, enabled: bool) -> World {
    let unique = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "mmss-r7-test-{}-{tag}-{unique}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    let mut config = Config::for_tests(format!("sqlite://{}/mmss.db", dir.display()));
    if enabled {
        // Present but never used: the tests prove the whole app runs with the integration
        // configured and no credentials actually reaching anything.
        config.edusecure.base_url = Some("https://portal.invalid/ParentApp".into());
        config.edusecure.username = Some("svc-account".into());
        config.edusecure.password = Some("not-a-real-secret".into());
    }
    let state = AppState::new(config).await.unwrap();
    let db = state.db.clone();
    let auth = AuthService::new(&db, &state.config);

    let class = classes::create(&db, &mmss_backend::models::NewClass::new("9-F"))
        .await
        .unwrap();
    let subject = subjects::create(&db, &mmss_backend::models::NewSubject::new("Mathematics"))
        .await
        .unwrap();

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
    teacher_classes::assign(&db, teacher, class.id)
        .await
        .unwrap();

    let student = auth
        .create_user_with_password(
            &NewUser {
                school_id: "student.a".into(),
                display_name: Some("Student A".into()),
                role: Role::Student,
                class_id: Some(class.id),
            },
            STUDENT_PASSWORD,
        )
        .await
        .unwrap()
        .user_id;
    assert!(student > 0, "the student fixture must be created");

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

    // Deliberately *not* one of the rows in `ANNOUNCEMENT_PAGE`, so the import tests
    // measure importing rather than deduplication. Dedup against existing local content --
    // including teacher-written content -- has its own test below.
    let authored = homework::create(
        &db,
        &NewHomework {
            class_id: class.id,
            subject_id: subject.id,
            author_id: Some(teacher),
            due_date: "2026-10-09".into(),
            homework_text: Some("Quadratic equations".into()),
            classwork_text: None,
        },
    )
    .await
    .unwrap()
    .id;

    World {
        app: mmss_backend::app(state),
        db,
        class_id: class.id,
        subject_id: subject.id,
        authored,
    }
}

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

async fn sign_in(world: &World, school_id: &str, password: &str) -> String {
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
    assert_eq!(
        status,
        StatusCode::OK,
        "login failed: {}",
        String::from_utf8_lossy(&bytes)
    );
    headers
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

/// The service under test, with an injected client.
fn service<'a>(
    world: &'a World,
    client: Arc<dyn EduSecureClient>,
    enabled: bool,
) -> EduSecureService<'a> {
    EduSecureService::new(&world.db, client, enabled)
}

/// A snapshot of the local row, for asserting that a portal failure changed nothing.
async fn local_entry(world: &World, id: i64) -> Option<mmss_backend::models::Homework> {
    homework::find_by_id(&world.db, id).await.unwrap()
}

// ------------------------------------------------- disabled / no credentials

/// With no credentials the integration is off, the status endpoint says so without
/// echoing anything, and the rest of the app is completely unaffected.
#[tokio::test]
async fn without_credentials_the_integration_is_off_and_the_app_works() {
    let world = world("disabled", false).await;
    let admin = sign_in(&world, "admin.test", ADMIN_PASSWORD).await;

    let (status, body) = call(
        &world.app,
        "GET",
        "/api/edusecure/status",
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["enabled"], false);

    // The status view must not leak a URL, a username or anything resembling one.
    let rendered = body.to_string();
    for secret in ["portal.invalid", "svc-account", "EDUSECURE_PASSWORD"] {
        assert!(
            !rendered.contains(secret),
            "status leaked {secret}: {rendered}"
        );
    }

    // Publishing is refused clearly, not as a 404 and not as a server error.
    let (status, body) = call(
        &world.app,
        "POST",
        &format!("/api/edusecure/homework/{}/publication", world.authored),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{body}");
    assert_eq!(body["code"], "EDUSECURE_UNAVAILABLE");

    // And the homework is untouched and still served to the student.
    assert!(local_entry(&world, world.authored).await.is_some());
}

/// The disabled client is the one that answers `Disabled`, so the off path and the
/// failing path run the same code.
#[tokio::test]
async fn the_disabled_client_reports_disabled() {
    let world = world("disabled-client", false).await;
    let service = service(&world, Arc::new(DisabledClient), false);
    assert!(!service.enabled());

    let error = service.publish(world.authored).await.unwrap_err();
    assert_eq!(error.status(), StatusCode::SERVICE_UNAVAILABLE);
    // The attempt is still recorded, so an operator can see it was tried.
    let recorded: String =
        sqlx::query_scalar("SELECT status FROM edusecure_publications WHERE homework_id = ?1")
            .bind(world.authored)
            .fetch_one(&world.db)
            .await
            .unwrap();
    assert_eq!(recorded, "failed");
}

// ---------------------------------------------------- successful publication

#[tokio::test]
async fn a_successful_publication_is_recorded_with_the_portals_id() {
    let world = world("publish-ok", true).await;
    let client = FakeClient::ok();
    let service = service(&world, client.clone(), true);

    let view = service.publish(world.authored).await.unwrap();
    assert_eq!(
        view.status,
        mmss_backend::models::PublicationStatus::Published
    );
    assert_eq!(view.external_id.as_deref(), Some("PORTAL-42"));
    assert_eq!(view.attempts, 1);
    assert!(view.last_error.is_none());
    assert!(client.seen().contains(&(
        "Mathematics".to_owned(),
        Some("Quadratic equations".to_owned())
    )));

    // The local record is unchanged, including its authorship.
    let entry = local_entry(&world, world.authored).await.unwrap();
    assert!(entry.author_id.is_some());
    assert_eq!(entry.homework_text.as_deref(), Some("Quadratic equations"));
}

// ------------------------------------------------------ duplicate publication

/// Publishing the same entry twice must not push it twice.
#[tokio::test]
async fn a_second_publication_is_a_no_op() {
    let world = world("duplicate", true).await;
    let client = FakeClient::ok();
    let service = service(&world, client.clone(), true);

    let first = service.publish(world.authored).await.unwrap();
    let second = service.publish(world.authored).await.unwrap();

    assert_eq!(first.homework_id, second.homework_id);
    assert_eq!(
        second.status,
        mmss_backend::models::PublicationStatus::Published
    );
    assert_eq!(
        client.calls(),
        1,
        "the portal must be called once, not once per request"
    );
    // And exactly one ledger row, which is what the primary key guarantees.
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM edusecure_publications")
        .fetch_one(&world.db)
        .await
        .unwrap();
    assert_eq!(rows, 1);
}

/// A retry after a *failure* is allowed, and counts as a second attempt. Duplicate
/// prevention is about not publishing twice, not about refusing to try again.
#[tokio::test]
async fn a_failed_publication_can_be_retried() {
    let world = world("retry", true).await;
    let failing = service(&world, FakeClient::failing(PortalError::Unreachable), true);
    assert!(failing.publish(world.authored).await.is_err());

    let succeeding = service(&world, FakeClient::ok(), true);
    let view = succeeding.publish(world.authored).await.unwrap();
    assert_eq!(
        view.status,
        mmss_backend::models::PublicationStatus::Published
    );
    assert_eq!(view.attempts, 2, "the failed attempt must still be counted");
    assert!(view.last_error.is_none(), "a success clears the old error");
}

// ------------------------------------------- failure is non-destructive

/// The core guarantee: every failure mode leaves the local record byte-identical and the
/// student API still serving it.
#[tokio::test]
async fn no_portal_failure_damages_the_local_record() {
    for error in [
        PortalError::Unreachable,
        PortalError::Unauthenticated,
        PortalError::Malformed,
        PortalError::Rejected,
        PortalError::Unsupported,
        PortalError::Disabled,
    ] {
        let world = world("failure", true).await;
        let before = local_entry(&world, world.authored).await.unwrap();
        let student = sign_in(&world, "student.a", STUDENT_PASSWORD).await;

        let service = service(&world, FakeClient::failing(error.clone()), true);
        let api_error = service.publish(world.authored).await.unwrap_err();

        // A portal problem is a bad gateway; being switched off is a 503. Either way it is
        // never a 500 and never a success.
        assert!(
            matches!(
                api_error.status(),
                StatusCode::BAD_GATEWAY | StatusCode::SERVICE_UNAVAILABLE
            ),
            "{error:?} produced {}",
            api_error.status()
        );

        // The local row is exactly as it was.
        let after = local_entry(&world, world.authored).await.unwrap();
        assert_eq!(before, after, "{error:?} changed the source of truth");

        // The attempt is recorded, with a message safe to show.
        let (status, error_text): (String, Option<String>) = sqlx::query_as(
            "SELECT status, last_error FROM edusecure_publications WHERE homework_id = ?1",
        )
        .bind(world.authored)
        .fetch_one(&world.db)
        .await
        .unwrap();
        assert_eq!(status, "failed");
        let text = error_text.expect("a failure must leave a reason");
        assert!(!text.contains("sqlite"), "{text}");
        assert!(text.chars().count() <= 500);

        // And the student still sees the homework through the R4 API.
        let (status, feed) = call(&world.app, "GET", "/api/homework", Some(&student), None).await;
        assert_eq!(status, StatusCode::OK);
        let ids: Vec<i64> = feed["homework"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["id"].as_i64().unwrap())
            .collect();
        assert!(ids.contains(&world.authored), "{error:?} hid the entry");
    }
}

/// A failure recorded for an entry disappears with it, and never blocks deletion.
#[tokio::test]
async fn a_failed_publication_does_not_block_deleting_the_homework() {
    let world = world("delete-after-failure", true).await;
    let teacher = sign_in(&world, "teacher.test", TEACHER_PASSWORD).await;
    let service = service(&world, FakeClient::failing(PortalError::Unreachable), true);
    service.publish(world.authored).await.unwrap_err();

    let (status, body) = call(
        &world.app,
        "DELETE",
        &format!("/api/teacher/homework/{}", world.authored),
        Some(&teacher),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // The ledger row went with it, by cascade.
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM edusecure_publications")
        .fetch_one(&world.db)
        .await
        .unwrap();
    assert_eq!(rows, 0);
}

// ------------------------------------------------- malformed upstream input

/// Anything that is not the page we expect is refused rather than silently importing
/// nothing. This is the difference between "the portal has no homework" and "we failed to
/// read the portal", which must never look alike during a migration.
#[test]
fn a_page_that_is_not_an_announcement_grid_is_refused() {
    for html in [
        "",
        "<html><body>Service unavailable</body></html>",
        // The old code inferred an expired session from these same three markers.
        "<html><body><form action=\"Login.aspx\"><input name=\"txtusername\"/></form></body></html>",
        "<html><body>loginWrapper</body></html>",
        "<html><body><table><tr><td>something else entirely</td></tr></table></body></html>",
    ] {
        let result = parse_announcement_html(html);
        assert_eq!(
            result,
            Err(PortalError::Malformed),
            "{html:?} must be refused, not parsed as an empty week"
        );
    }
}

#[test]
fn a_well_formed_page_parses_into_rows_and_splits_the_merged_body() {
    let rows = parse_announcement_html(ANNOUNCEMENT_PAGE).unwrap();
    assert_eq!(rows.len(), 2, "{rows:?}");

    // Display-string date converted, homework-only row.
    assert_eq!(rows[0].due_date, "2026-10-05");
    assert_eq!(
        rows[0].homework_text.as_deref(),
        Some("Complete exercises 1-10.")
    );
    assert_eq!(rows[0].classwork_text, None);
    assert_eq!(rows[0].attachment_url, None);

    // Both halves, split from one merged paragraph, with the attachment recorded as
    // metadata only -- nothing downloads it.
    assert_eq!(rows[1].due_date, "2026-10-06");
    assert_eq!(rows[1].homework_text.as_deref(), Some("Read pages 40-52."));
    assert_eq!(rows[1].classwork_text.as_deref(), Some("Exercise 6.1"));
    assert_eq!(
        rows[1].attachment_url.as_deref(),
        Some("/ParentApp/Download?id=99")
    );
}

#[test]
fn a_grid_with_unusable_rows_yields_nothing_rather_than_guessing() {
    let page = r#"<table id="grdDashContents">
        <tr><td><small>not a date</small></td><td><p>Some text</p></td></tr>
        <tr><td><small>Oct 5, 2026</small></td><td><p></p></td></tr>
    </table>"#;
    let rows = parse_announcement_html(page).unwrap();
    assert!(rows.is_empty(), "{rows:?}");
}

#[test]
fn portal_dates_are_accepted_in_the_forms_the_portal_has_used() {
    assert_eq!(
        parse_portal_date("Oct 5, 2026").as_deref(),
        Some("2026-10-05")
    );
    assert_eq!(
        parse_portal_date("  Jul 23, 2026 ").as_deref(),
        Some("2026-07-23")
    );
    assert_eq!(
        parse_portal_date("December 31, 2026").as_deref(),
        Some("2026-12-31")
    );
    // Day-first, in case a portal revision switches.
    assert_eq!(
        parse_portal_date("23 Jul 2026").as_deref(),
        Some("2026-07-23")
    );
    // ISO passes straight through.
    assert_eq!(
        parse_portal_date("2026-07-23").as_deref(),
        Some("2026-07-23")
    );
    // Leap day is real; a non-leap one is not.
    assert_eq!(
        parse_portal_date("Feb 29, 2024").as_deref(),
        Some("2024-02-29")
    );
    assert_eq!(parse_portal_date("Feb 29, 2026"), None);

    for bad in [
        "",
        "tomorrow",
        "next Monday",
        "Oct 2026",
        "5/10/26",
        "Oct 32, 2026",
    ] {
        assert_eq!(parse_portal_date(bad), None, "{bad:?} must be refused");
    }
}

#[test]
fn the_merged_body_splits_on_markers_without_inventing_content() {
    let (hw, cw) = split_diary_body("Homework: Q1-5\nClasswork: Ex 6.1");
    assert_eq!(hw.as_deref(), Some("Q1-5"));
    assert_eq!(cw.as_deref(), Some("Ex 6.1"));

    // No markers at all: it is all homework, which is how the old single column behaved.
    let (hw, cw) = split_diary_body("Just a note");
    assert_eq!(hw.as_deref(), Some("Just a note"));
    assert_eq!(cw, None);

    // Classwork only.
    let (hw, cw) = split_diary_body("Classwork: Lab report");
    assert_eq!(hw, None);
    assert_eq!(cw.as_deref(), Some("Lab report"));

    // Interior whitespace survives; only the ends are trimmed.
    let (hw, _) = split_diary_body("Homework: line one\n\nline two");
    assert_eq!(hw.as_deref(), Some("line one\n\nline two"));

    // A word merely starting with "homework" is not a marker.
    let (hw, cw) = split_diary_body("Homework sheet attached");
    assert_eq!(cw, None);
    assert_eq!(hw.as_deref(), Some("Homework sheet attached"));
}

// ------------------------------------------------------------------- import

/// Importing a portal page writes real rows, and re-importing the same page does not
/// duplicate them.
#[tokio::test]
async fn importing_a_page_is_idempotent_and_keeps_the_two_halves_apart() {
    let world = world("import", true).await;
    let admin = sign_in(&world, "admin.test", ADMIN_PASSWORD).await;
    let body = json!({
        "classId": world.class_id,
        "subjectId": world.subject_id,
        "html": ANNOUNCEMENT_PAGE,
    });

    let (status, first) = call(
        &world.app,
        "POST",
        "/api/edusecure/import",
        Some(&admin),
        Some(body.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first}");
    assert_eq!(first["imported"], 2);
    assert_eq!(first["skipped"], 0);

    let (status, second) = call(
        &world.app,
        "POST",
        "/api/edusecure/import",
        Some(&admin),
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{second}");
    assert_eq!(second["imported"], 0, "a re-import must add nothing");
    assert_eq!(second["skipped"], 2);

    // The rows are ordinary class-level homework, visible to the student, with the two
    // halves separate and no invented author.
    let student = sign_in(&world, "student.a", STUDENT_PASSWORD).await;
    let (status, feed) = call(&world.app, "GET", "/api/homework", Some(&student), None).await;
    assert_eq!(status, StatusCode::OK);
    let items = feed["homework"].as_array().unwrap();
    let imported: Vec<&Value> = items
        .iter()
        .filter(|item| item["author"].is_null())
        .collect();
    assert_eq!(imported.len(), 2, "{items:?}");

    let both = imported
        .iter()
        .find(|item| item["classwork"].is_string())
        .expect("a row with both halves");
    assert_eq!(both["homework"], "Read pages 40-52.");
    assert_eq!(both["classwork"], "Exercise 6.1");
    assert_eq!(both["date"], "2026-10-06");
}

/// Importing a page whose rows are already here skips them -- including rows that a
/// *teacher* created locally. This is what stops the transition from doubling a class's
/// homework, and it is the reason dedup is keyed on content rather than on authorship.
#[tokio::test]
async fn an_import_skips_rows_that_already_exist_whoever_wrote_them() {
    let world = world("import-dedup", true).await;
    let admin = sign_in(&world, "admin.test", ADMIN_PASSWORD).await;

    // A page whose single row is byte-identical to the seeded teacher entry.
    let page = r#"<table id="grdDashContents"><tr>
             <td><small>Oct 9, 2026</small></td>
             <td><p><b>Homework:</b> Quadratic equations</p></td>
           </tr></table>"#;
    let (status, result) = call(
        &world.app,
        "POST",
        "/api/edusecure/import",
        Some(&admin),
        Some(json!({
            "classId": world.class_id,
            "subjectId": world.subject_id,
            "html": page,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["imported"], 0);
    assert_eq!(result["skipped"], 1);

    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM homework")
        .fetch_one(&world.db)
        .await
        .unwrap();
    assert_eq!(rows, 1, "the teacher's entry must not be duplicated");

    // And the existing entry kept its author: an import must not rewrite local history.
    let entry = homework::find_by_id(&world.db, world.authored)
        .await
        .unwrap();
    assert!(
        entry.unwrap().author_id.is_some(),
        "dedup must not strip the author"
    );
}

/// A page with no usable rows is a 400, and writes nothing.
#[tokio::test]
async fn an_empty_page_is_refused_and_writes_nothing() {
    let world = world("import-empty", true).await;
    let admin = sign_in(&world, "admin.test", ADMIN_PASSWORD).await;

    let (status, body) = call(
        &world.app,
        "POST",
        "/api/edusecure/import",
        Some(&admin),
        Some(json!({
            "classId": world.class_id,
            "subjectId": world.subject_id,
            "html": "<html><body><table id=\"grdDashContents\"></table></body></html>",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");

    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM homework")
        .fetch_one(&world.db)
        .await
        .unwrap();
    assert_eq!(rows, 1, "only the pre-existing teacher entry");
}

/// An unreadable page, a bad class and a bad subject are all 400s, and none of them
/// writes anything.
#[tokio::test]
async fn bad_imports_are_refused_before_anything_is_written() {
    let world = world("import-bad", true).await;
    let admin = sign_in(&world, "admin.test", ADMIN_PASSWORD).await;

    for (body, what) in [
        (
            json!({ "classId": 9999, "subjectId": world.subject_id, "html": ANNOUNCEMENT_PAGE }),
            "a class that does not exist",
        ),
        (
            json!({ "classId": world.class_id, "subjectId": 9999, "html": ANNOUNCEMENT_PAGE }),
            "a subject that does not exist",
        ),
        (
            json!({ "classId": world.class_id, "subjectId": world.subject_id, "html": "nope" }),
            "a page that is not an announcement grid",
        ),
        (
            json!({ "classId": world.class_id, "subjectId": world.subject_id }),
            "a missing html field",
        ),
    ] {
        let (status, out) = call(
            &world.app,
            "POST",
            "/api/edusecure/import",
            Some(&admin),
            Some(body),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::BAD_REQUEST,
            "{what} must be a 400: {out}"
        );
    }

    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM homework")
        .fetch_one(&world.db)
        .await
        .unwrap();
    assert_eq!(rows, 1, "no rejected import may leave a row behind");
}

// ------------------------------------------------------------ route guards

/// Every EduSecure route is administrator-only, and the status route is public because a
/// deployment needs to be able to ask.
#[tokio::test]
async fn edusecure_routes_require_an_administrator() {
    let world = world("guards", true).await;
    let teacher = sign_in(&world, "teacher.test", TEACHER_PASSWORD).await;
    let student = sign_in(&world, "student.a", STUDENT_PASSWORD).await;
    let hw = world.authored.to_string();

    let guarded = [
        (
            "GET",
            format!("/api/edusecure/homework/{hw}/publication"),
            None,
        ),
        (
            "POST",
            format!("/api/edusecure/homework/{hw}/publication"),
            None,
        ),
        (
            "POST",
            "/api/edusecure/import".to_owned(),
            Some(json!({
                "classId": world.class_id,
                "subjectId": world.subject_id,
                "html": ANNOUNCEMENT_PAGE,
            })),
        ),
    ];

    for (method, path, body) in guarded {
        let (status, out) = call(&world.app, method, &path, None, body.clone()).await;
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "anonymous {method} {path}: {out}"
        );

        for token in [teacher.as_str(), student.as_str()] {
            let (status, out) = call(&world.app, method, &path, Some(token), body.clone()).await;
            assert_eq!(
                status,
                StatusCode::FORBIDDEN,
                "{token} {method} {path}: {out}"
            );
        }
    }

    // Status is readable by any signed-in user, and by nobody unauthenticated.
    let (status, _) = call(&world.app, "GET", "/api/edusecure/status", None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = call(
        &world.app,
        "GET",
        "/api/edusecure/status",
        Some(&student),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn a_malformed_publication_id_is_a_clean_400() {
    let world = world("bad-id", true).await;
    let admin = sign_in(&world, "admin.test", ADMIN_PASSWORD).await;
    for bad in ["abc", "-1", "0", "1.5"] {
        let (status, _) = call(
            &world.app,
            "GET",
            &format!("/api/edusecure/homework/{bad}/publication"),
            Some(&admin),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad:?}");
    }
    // A well-formed id that does not exist is a 404, not a 400.
    let (status, _) = call(
        &world.app,
        "GET",
        "/api/edusecure/homework/9999/publication",
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ---------------------------------- the student API is independent of EduSecure

/// The headline: the student API behaves identically whether or not the integration exists,
/// configured or failing. MMSS64 is the source of truth precisely because the portal is
/// not load-bearing for reading.
#[tokio::test]
async fn the_student_api_does_not_depend_on_edusecure() {
    for enabled in [false, true] {
        let world = world("student-independent", enabled).await;
        let student = sign_in(&world, "student.a", STUDENT_PASSWORD).await;

        let (status, feed) = call(&world.app, "GET", "/api/homework", Some(&student), None).await;
        assert_eq!(status, StatusCode::OK, "enabled={enabled}");
        let item = feed["homework"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"].as_i64() == Some(world.authored))
            .unwrap_or_else(|| panic!("teacher entry missing, enabled={enabled}"));
        assert_eq!(item["homework"], "Quadratic equations");
        assert_eq!(item["author"]["displayName"], "Test Teacher");

        // Notes and progress on it work the same way.
        let (status, _) = call(
            &world.app,
            "PATCH",
            &format!("/api/progress/{}", world.authored),
            Some(&student),
            Some(json!({ "completed": true })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }
}
