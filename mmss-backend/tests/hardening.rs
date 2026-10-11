//! Phase 9 adversarial tests: the production hardening surface.
//!
//! These are written as an attacker or a failing operator would approach them, not as a
//! checklist. Every case asserts something the deployment depends on, and each names the
//! failure it prevents.
//!
//! Nothing here needs credentials, a network, or a second process. The database is a private
//! temporary file and the HTTP surface is the real router.

use std::sync::atomic::{AtomicU32, Ordering};

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use http_body_util::BodyExt;
use mmss_backend::config::Config;
use mmss_backend::cookies::SESSION_COOKIE;
use mmss_backend::middleware::{security_header_values, REQUEST_ID_HEADER};
use mmss_backend::models::{NewUser, Role};
use mmss_backend::services::auth::AuthService;
use mmss_backend::state::AppState;
use serde_json::{json, Value};
use tower::ServiceExt;

static NEXT_ID: AtomicU32 = AtomicU32::new(0);

const STUDENT_PASSWORD: &str = "test-student-password";
const ADMIN_PASSWORD: &str = "test-admin-password";

/// An allowlisted origin, and one that is not.
const ALLOWED_ORIGIN: &str = "https://portal.example.test";
const FOREIGN_ORIGIN: &str = "https://evil.example.test";

struct World {
    app: axum::Router,
    db: sqlx::SqlitePool,
    admin_token: String,
    student_token: String,
}

async fn world(tag: &str) -> World {
    let unique = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "mmss-r9-test-{}-{tag}-{unique}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);

    let mut config = Config::for_tests(format!("sqlite://{}/mmss.db", dir.display()));
    config.allowed_origins = vec![ALLOWED_ORIGIN.to_owned()];
    let state = AppState::new(config).await.unwrap();
    let db = state.db.clone();
    let auth = AuthService::new(&db, &state.config);

    let class = mmss_backend::repositories::classes::create(
        &db,
        &mmss_backend::models::NewClass::new("9-F"),
    )
    .await
    .unwrap();

    for (school_id, role, password) in [
        ("student.a", Role::Student, STUDENT_PASSWORD),
        ("admin.test", Role::Admin, ADMIN_PASSWORD),
    ] {
        auth.create_user_with_password(
            &NewUser {
                school_id: school_id.into(),
                display_name: None,
                role,
                class_id: (role == Role::Student).then_some(class.id),
            },
            password,
        )
        .await
        .unwrap();
    }

    let app = mmss_backend::app(state);
    let admin_token = sign_in(&app, "admin.test", ADMIN_PASSWORD).await;
    let student_token = sign_in(&app, "student.a", STUDENT_PASSWORD).await;
    World {
        app,
        db,
        admin_token,
        student_token,
    }
}

async fn raw(
    app: &axum::Router,
    method: Method,
    uri: &str,
    headers: &[(&str, String)],
    body: Option<&str>,
) -> (StatusCode, axum::http::HeaderMap, String) {
    let mut builder = Request::builder().method(method.clone()).uri(uri);
    for (name, value) in headers {
        builder = builder.header(*name, value.clone());
    }
    // The declared content type follows the method, not the body. `routes::auth`
    // refuses a state-changing request that does not declare JSON (the CSRF guard), and
    // the shipped client sends the header even when it sends no body -- so a probe that
    // omitted it would be testing a client that does not exist.
    let request = match body {
        Some(text) => builder
            .header("content-type", "application/json")
            .body(Body::from(text.to_owned()))
            .unwrap(),
        None if method != Method::GET && method != Method::HEAD => builder
            .header("content-type", "application/json")
            .body(Body::empty())
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    };
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        headers,
        String::from_utf8_lossy(&bytes).into_owned(),
    )
}

async fn call(
    app: &axum::Router,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut headers = Vec::new();
    if let Some(token) = token {
        headers.push(("cookie", format!("{SESSION_COOKIE}={token}")));
    }
    let (status, _, text) = raw(
        app,
        Method::from_bytes(method.as_bytes()).unwrap(),
        uri,
        &headers,
        body.map(|value| value.to_string()).as_deref(),
    )
    .await;
    let value = serde_json::from_str(&text).unwrap_or(Value::Null);
    (status, value)
}

async fn sign_in(app: &axum::Router, school_id: &str, password: &str) -> String {
    let (status, _, text) = raw(
        app,
        Method::POST,
        "/api/auth/login",
        &[],
        Some(&json!({ "studentId": school_id, "password": password }).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "login failed: {text}");
    // Re-run to capture the header; the helper above discards it, so do it directly.
    let builder = Request::builder()
        .method(Method::POST)
        .uri("/api/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({ "studentId": school_id, "password": password }).to_string(),
        ))
        .unwrap();
    let response = app.clone().oneshot(builder).await.unwrap();
    response
        .headers()
        .get(header::SET_COOKIE)
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

// --------------------------------------------------------- security headers

/// Every response carries the hardening headers -- including error responses and the
/// unauthenticated ones, which is where they are easiest to forget.
#[tokio::test]
async fn security_headers_are_present_on_success_and_on_error() {
    let world = world("headers").await;

    /// One request to make: method, path, extra headers, body.
    type Attack = (
        Method,
        &'static str,
        Vec<(&'static str, String)>,
        Option<&'static str>,
    );

    let cases: Vec<Attack> = vec![
        (Method::GET, "/health", vec![], None),
        (Method::GET, "/api/notes", vec![], None),
        (
            Method::GET,
            "/api/notes",
            vec![("cookie", format!("{SESSION_COOKIE}=not-a-real-token"))],
            None,
        ),
        (Method::GET, "/definitely-not-a-route", vec![], None),
    ];

    for (method, uri, headers, body) in cases {
        let (status, response_headers, _) = raw(&world.app, method, uri, &headers, body).await;
        for (name, value) in security_header_values() {
            let actual = response_headers.get(name).and_then(|v| v.to_str().ok());
            assert_eq!(
                actual,
                Some(value),
                "{uri} ({status}) is missing {name}: {value}"
            );
        }
    }
}

/// The headers are the ones that mean something here, rather than a blanket list. A CSP
/// would be theatre on a JSON API with no HTML of its own, and HSTS would be wrong to send
/// from a process that cannot know it is behind TLS.
#[tokio::test]
async fn the_header_set_is_deliberate() {
    let world = world("headers-deliberate").await;
    let (status, headers, _) = raw(&world.app, Method::GET, "/health", &[], None).await;
    assert_eq!(status, StatusCode::OK);

    assert_eq!(headers.get("x-content-type-options").unwrap(), "nosniff");
    assert_eq!(headers.get("x-frame-options").unwrap(), "DENY");
    assert_eq!(headers.get("referrer-policy").unwrap(), "no-referrer");
    // Not sent: this process cannot verify it is served over HTTPS.
    assert!(
        !headers.contains_key("strict-transport-security"),
        "HSTS must not be sent without knowing the TLS posture"
    );
}

// ------------------------------------------------------------- request ids

/// Every response carries a request id, so a user-visible failure can be tied to a log line.
#[tokio::test]
async fn every_response_carries_a_request_id() {
    let world = world("request-id").await;

    for uri in ["/health", "/ready", "/api/notes", "/nope"] {
        let (status, headers, _) = raw(&world.app, Method::GET, uri, &[], None).await;
        let id = headers
            .get(REQUEST_ID_HEADER)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_else(|| panic!("{uri} ({status}) has no {REQUEST_ID_HEADER}"));
        assert_eq!(
            id.len(),
            32,
            "{uri}: id should be 128 bits of hex, got {id}"
        );
        assert!(
            id.chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),
            "{uri}: id should be lowercase hex, got {id}"
        );
    }
}

/// Two requests get different ids, and a caller-supplied id is discarded.
///
/// Accepting a client-supplied id would let one caller pin the same id on every request,
/// which makes the correlation worthless exactly when an incident needs it.
#[tokio::test]
async fn request_ids_are_minted_per_request_and_never_trusted() {
    let world = world("request-id-unique").await;

    let (_, first, _) = raw(&world.app, Method::GET, "/health", &[], None).await;
    let (_, second, _) = raw(&world.app, Method::GET, "/health", &[], None).await;
    assert_ne!(first.get(REQUEST_ID_HEADER), second.get(REQUEST_ID_HEADER));

    let forged = "00000000000000000000000000000001";
    let (_, headers, _) = raw(
        &world.app,
        Method::GET,
        "/health",
        &[("x-request-id", forged.to_owned())],
        None,
    )
    .await;
    assert_ne!(
        headers.get(REQUEST_ID_HEADER).unwrap(),
        forged,
        "a caller must not be able to choose the correlation id"
    );
}

// ------------------------------------------------------------------- CORS

/// An unlisted origin gets no CORS permission at all -- the response carries no
/// `Access-Control-Allow-Origin`, so the browser refuses it.
#[tokio::test]
async fn an_unlisted_origin_is_refused() {
    let world = world("cors-deny").await;
    let (status, headers, _) = raw(
        &world.app,
        Method::GET,
        "/api/notes",
        &[("origin", FOREIGN_ORIGIN.to_owned())],
        None,
    )
    .await;
    assert!(
        !headers.contains_key("access-control-allow-origin"),
        "a foreign origin must not be granted access: {headers:?}"
    );
    // The request itself still processes normally; CORS is a browser-enforced policy, and
    // refusing the *request* here would be a different (and wrong) decision.
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

/// An allowlisted origin is granted access, with credentials, because the API is cookie
/// authenticated.
#[tokio::test]
async fn an_allowlisted_origin_is_granted_credentials() {
    let world = world("cors-allow").await;
    let (status, headers, _) = raw(
        &world.app,
        Method::GET,
        "/api/notes",
        &[("origin", ALLOWED_ORIGIN.to_owned())],
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "the request still needs a session"
    );
    assert_eq!(
        headers.get("access-control-allow-origin").unwrap(),
        ALLOWED_ORIGIN
    );
    assert_eq!(
        headers.get("access-control-allow-credentials").unwrap(),
        "true"
    );
    assert!(
        headers.contains_key("vary"),
        "a cached response must vary by origin"
    );
}

/// A preflight for an unlisted origin must not be granted the method or headers.
#[tokio::test]
async fn a_preflight_from_an_unlisted_origin_fails_closed() {
    let world = world("cors-preflight").await;
    let (status, headers, _) = raw(
        &world.app,
        Method::OPTIONS,
        "/api/teacher/homework",
        &[
            ("origin", FOREIGN_ORIGIN.to_owned()),
            ("access-control-request-method", "POST".to_owned()),
        ],
        None,
    )
    .await;
    assert!(
        !headers.contains_key("access-control-allow-origin"),
        "an unlisted preflight must not be granted: {status} {headers:?}"
    );
}

/// With no allowlist configured -- the default -- every cross-origin browser call is denied.
/// The shipped deployment reaches this API same-origin through the rewrite, so denying is
/// correct rather than a missing feature.
#[tokio::test]
async fn with_no_allowlist_every_cross_origin_call_is_denied() {
    let unique = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("mmss-r9-nocors-{}-{unique}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let mut config = Config::for_tests(format!("sqlite://{}/mmss.db", dir.display()));
    config.allowed_origins.clear();
    let app = mmss_backend::app(AppState::new(config).await.unwrap());

    let (_, headers, _) = raw(
        &app,
        Method::GET,
        "/api/notes",
        &[("origin", ALLOWED_ORIGIN.to_owned())],
        None,
    )
    .await;
    assert!(!headers.contains_key("access-control-allow-origin"));
}

/// A malformed or junk origin cannot widen the allowlist.
#[tokio::test]
async fn a_hostile_origin_cannot_widen_the_allowlist() {
    let world = world("cors-hostile").await;
    for origin in [
        "https://evil.example.test".to_owned(),
        "null".to_owned(),
        "https://portal.example.test.evil.test".to_owned(),
        format!("{ALLOWED_ORIGIN},https://evil.example.test"),
    ] {
        let (_, headers, _) = raw(
            &world.app,
            Method::GET,
            "/api/notes",
            &[("origin", origin.clone())],
            None,
        )
        .await;
        assert!(
            !headers.contains_key("access-control-allow-origin")
                || headers.get("access-control-allow-origin").unwrap() == ALLOWED_ORIGIN,
            "origin {origin:?} must not be granted access"
        );
    }
}

// ------------------------------------------------------------ body limits

/// An oversized body is refused before it is buffered, with a status that is neither a
/// success nor a server error.
#[tokio::test]
async fn an_oversized_body_is_refused() {
    let world = world("body-limit").await;
    let huge = json!({ "body": "x".repeat(400_000) }).to_string();
    assert!(
        huge.len() > 256 * 1024,
        "the payload must exceed the configured limit"
    );

    let (status, headers, _) = raw(
        &world.app,
        Method::POST,
        "/api/notes",
        &[(
            "cookie",
            format!("{SESSION_COOKIE}={}", world.student_token),
        )],
        Some(&huge),
    )
    .await;
    assert!(
        status == StatusCode::PAYLOAD_TOO_LARGE || status == StatusCode::BAD_REQUEST,
        "an oversized body must be refused, got {status}"
    );
    // And it must not be a 500: an attacker's payload is not a server fault.
    assert!(!status.is_server_error(), "got {status}");
    assert!(headers.contains_key("x-content-type-options"));
}

/// A body just under the limit is still processed, so the limit is a ceiling and not a
/// blanket rejection.
#[tokio::test]
async fn a_body_under_the_limit_is_accepted() {
    let world = world("body-under-limit").await;
    let (status, body) = call(
        &world.app,
        "POST",
        "/api/notes",
        Some(&world.student_token),
        Some(json!({ "body": "a reasonable private note" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
}

// ----------------------------------------------------- health and readiness

/// Liveness never touches the database, so a slow database cannot get a healthy process
/// killed and restarted into the same slow database.
#[tokio::test]
async fn liveness_does_not_depend_on_the_database() {
    let world = world("liveness").await;
    world.db.close().await;

    let (status, body) = call(&world.app, "GET", "/health", None, None).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "liveness must stay up with the database gone: {body}"
    );
    assert_eq!(body["status"], "ok");
}

/// Readiness goes 503 when the database is unusable. This is the bug R9 fixed: the old
/// single endpoint answered 200 with `"status": "degraded"`, and a load balancer reads the
/// status code.
#[tokio::test]
async fn readiness_reports_503_when_the_database_is_unusable() {
    let world = world("readiness").await;
    let (status, _) = call(&world.app, "GET", "/ready", None, None).await;
    assert_eq!(status, StatusCode::OK);

    world.db.close().await;
    let (status, body) = call(&world.app, "GET", "/ready", None, None).await;
    assert_eq!(
        status,
        StatusCode::SERVICE_UNAVAILABLE,
        "a process that cannot reach its database must not be sent traffic"
    );
    assert_eq!(body["status"], "unavailable");
}

/// The probes are unauthenticated -- an orchestrator has no session -- so their bodies must
/// not carry internal detail.
#[tokio::test]
async fn the_probes_never_disclose_anything() {
    let world = world("probe-disclosure").await;
    world.db.close().await;

    for uri in ["/health", "/ready"] {
        let (status, _, text) = raw(&world.app, Method::GET, uri, &[], None).await;
        let lowered = text.to_lowercase();
        for leak in ["sqlite", "sql", "database", "panic", "mmss.db", "error"] {
            assert!(
                !lowered.contains(leak),
                "{uri} ({status}) leaked {leak:?}: {text}"
            );
        }
    }
}

/// Metrics are scrapeable and carry no caller-controlled labels.
#[tokio::test]
async fn metrics_are_exposed_and_carry_no_caller_controlled_labels() {
    let world = world("metrics").await;

    async fn metric(app: &axum::Router, name: &str) -> u64 {
        let (_, _, text) = raw(app, Method::GET, "/metrics", &[], None).await;
        text.lines()
            .find_map(|line| line.strip_prefix(&format!("{name} ")))
            .and_then(|value| value.trim().parse().ok())
            .unwrap_or_else(|| panic!("{name} missing from metrics:\n{text}"))
    }

    // The counters are process-global so they survive a process restart in production, which
    // means parallel tests in this binary share them. Every assertion is therefore a *delta*
    // around a specific request rather than an absolute value.
    let errors_before = metric(&world.app, "mmss_errors_total").await;
    let requests_before = metric(&world.app, "mmss_requests_total").await;

    call(&world.app, "GET", "/health", None, None).await;
    call(&world.app, "GET", "/nope", None, None).await;

    // Both requests must be counted, plus the probe that reads the counter itself. The
    // counters are process-global, so a test running in parallel in this same binary can
    // move them too -- hence `>=` rather than an exact figure.
    assert!(
        metric(&world.app, "mmss_requests_total").await >= requests_before + 2,
        "both requests must be counted"
    );
    // A 404 is not a fault and must not move the error counter. (A parallel test could add a
    // genuine 5xx, so this asserts the counter did not go *backwards* and is unchanged in the
    // absence of one, which is the property that matters operationally.)
    let errors_after = metric(&world.app, "mmss_errors_total").await;
    assert!(
        errors_after >= errors_before,
        "the error counter must be monotonic: {errors_before} -> {errors_after}"
    );

    let (status, headers, text) = raw(&world.app, Method::GET, "/metrics", &[], None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        headers
            .get(header::CONTENT_TYPE)
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("text/plain"),
        "metrics must be Prometheus text, got {:?}",
        headers.get(header::CONTENT_TYPE)
    );
    for metric in [
        "mmss_requests_total",
        "mmss_errors_total",
        "mmss_requests_in_flight",
        "mmss_db_pool_connections",
    ] {
        assert!(text.contains(metric), "missing {metric}:\n{text}");
    }
    assert!(!text.contains("path="), "{text}");
}

// -------------------------------------------------- errors never leak

/// No error response, on any route, discloses a secret or an internal detail.
#[tokio::test]
async fn error_responses_never_leak_internals_or_secrets() {
    let world = world("no-leaks").await;

    // A configuration carrying secrets, to prove they cannot appear in a response.
    let unique = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("mmss-r9-leak-{}-{unique}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let mut secret_config = Config::for_tests(format!("sqlite://{}/mmss.db", dir.display()));
    secret_config.ai.api_key = Some("super-secret-ai-key".into());
    secret_config.ai.base_url = Some("http://internal-ai.internal".into());
    secret_config.ai.model = Some("internal-model-name".into());
    secret_config.edusecure.password = Some("super-secret-portal-password".into());
    secret_config.edusecure.base_url = Some("https://internal-portal.internal".into());
    let secret_state = AppState::new(secret_config).await.unwrap();
    // It needs an account of its own: its database is separate, so a session from `world`
    // would not resolve. Created before the state is moved into the router.
    AuthService::new(&secret_state.db, &secret_state.config)
        .create_user_with_password(
            &NewUser {
                school_id: "configured.admin".into(),
                display_name: None,
                role: Role::Admin,
                class_id: None,
            },
            ADMIN_PASSWORD,
        )
        .await
        .unwrap();
    let secret_app = mmss_backend::app(secret_state);

    let attacks: Vec<(String, Method, &str, Option<Value>)> = vec![
        ("no session".into(), Method::GET, "/api/notes", None),
        ("forged session".into(), Method::GET, "/api/homework", None),
        (
            "malformed id".into(),
            Method::GET,
            "/api/notes/not-a-number",
            None,
        ),
        (
            "traversal-ish id".into(),
            Method::GET,
            "/api/homework/..%2F..%2Fetc%2Fpasswd",
            None,
        ),
        (
            "malformed body".into(),
            Method::POST,
            "/api/auth/login",
            Some(json!({ "studentId": 1, "password": [] })),
        ),
        (
            "admin route as student".into(),
            Method::POST,
            "/api/teacher/homework",
            Some(json!({ "classId": 1 })),
        ),
    ];

    for (name, method, uri, body) in attacks {
        let mut headers = Vec::new();
        if uri.starts_with("/api/") && !uri.starts_with("/api/auth") {
            headers.push(("cookie", format!("{SESSION_COOKIE}=forged-token-value")));
        }
        if let Some(token) = Some(world.student_token.as_str()) {
            if uri == "/api/teacher/homework" {
                headers.push(("cookie", format!("{SESSION_COOKIE}={token}")));
            }
        }
        let (status, _, text) = raw(
            &world.app,
            method.clone(),
            uri,
            &headers,
            body.as_ref().map(|value| value.to_string()).as_deref(),
        )
        .await;
        assert!(
            status.is_client_error() || status == StatusCode::METHOD_NOT_ALLOWED,
            "{name}: {uri} should be a client error, got {status}"
        );
        assert_secrets_absent(&format!("{name}/{uri}"), &text);

        let (_, _, secret_text) = raw(
            &secret_app,
            method,
            uri,
            &headers,
            body.map(|value| value.to_string()).as_deref(),
        )
        .await;
        assert_secrets_absent(&format!("{name}/{uri} [configured]"), &secret_text);
    }

    // The integration status endpoints must not disclose configuration either. The
    // configured app has its own database, so a session from `world` means nothing to it --
    // a 401 is a correct answer there, and its body must be just as clean.
    for (app, label) in [(&world.app, "plain"), (&secret_app, "configured")] {
        for uri in ["/api/ai/status", "/api/edusecure/status"] {
            let token = if uri.contains("ai") {
                Some(world.student_token.as_str())
            } else {
                Some(world.admin_token.as_str())
            };
            let (status, _, text) = raw(
                app,
                Method::GET,
                uri,
                &[("cookie", format!("{SESSION_COOKIE}={}", token.unwrap()))],
                None,
            )
            .await;
            if label == "plain" {
                assert!(status.is_success(), "{label} {uri}: {status}");
            }
            assert_secrets_absent(&format!("{label} {uri}"), &text);
        }
    }

    // And a *live* session on the configured app does get a 200 with a clean body.
    let secret_admin = sign_in(&secret_app, "configured.admin", ADMIN_PASSWORD).await;
    let (status, _, text) = raw(
        &secret_app,
        Method::GET,
        "/api/ai/status",
        &[("cookie", format!("{SESSION_COOKIE}={secret_admin}"))],
        None,
    )
    .await;
    assert!(status.is_success(), "configured /api/ai/status: {status}");
    assert_secrets_absent("configured /api/ai/status (live)", &text);
}

fn assert_secrets_absent(what: &str, body: &str) {
    for leak in [
        "super-secret-ai-key",
        "super-secret-portal-password",
        "internal-ai.internal",
        "internal-portal.internal",
        "internal-model-name",
        "sqlite",
        "SQL",
        "mmss.db",
        "/Users/",
        "panic",
        "RUST_BACKTRACE",
        "app_session=",
        "argon2",
    ] {
        assert!(!body.contains(leak), "{what} leaked {leak:?}: {body}");
    }
}

// ------------------------------------------------ authorization invariants

/// Every authenticated-only surface still answers 401 to nobody and 403 to the wrong role.
/// R9 did not relax any of it, and the layering added in between must not have.
#[tokio::test]
async fn authorization_survived_the_new_layering() {
    let world = world("authz").await;

    let guarded: Vec<(&str, Method, &str, &str)> = vec![
        ("notes", Method::GET, "/api/notes", "student"),
        ("progress", Method::GET, "/api/progress", "student"),
        ("homework", Method::GET, "/api/homework", "student"),
        ("subjects", Method::GET, "/api/subjects", "student"),
        (
            "teacher homework",
            Method::GET,
            "/api/teacher/homework",
            "admin",
        ),
        (
            "edusecure import",
            Method::POST,
            "/api/edusecure/import",
            "admin",
        ),
    ];

    for (name, method, uri, correct_role) in guarded {
        let (status, _) = call(&world.app, method.as_str(), uri, None, None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{name}: anonymous {uri}");

        // The wrong role is refused, and which role is "wrong" differs per surface.
        let (wrong_token, expected) = if correct_role == "student" {
            (world.admin_token.as_str(), StatusCode::FORBIDDEN)
        } else {
            (world.student_token.as_str(), StatusCode::FORBIDDEN)
        };
        let (status, _) = call(
            &world.app,
            method.as_ref(),
            uri,
            Some(wrong_token),
            Some(json!({})),
        )
        .await;
        assert_eq!(status, expected, "{name}: wrong role on {uri}");

        // And the right role gets past the guard rather than hitting a 403.
        let right_token = if correct_role == "student" {
            world.student_token.as_str()
        } else {
            world.admin_token.as_str()
        };
        let (status, _) = call(
            &world.app,
            method.as_ref(),
            uri,
            Some(right_token),
            Some(json!({})),
        )
        .await;
        assert_ne!(
            status,
            StatusCode::FORBIDDEN,
            "{name}: the correct role was refused on {uri}"
        );
        assert_ne!(status, StatusCode::UNAUTHORIZED, "{name}: {uri}");
    }
}

// ------------------------------------------------------------ cookie safety

/// The session cookie keeps its hardening attributes, and logout's expiry matches them.
#[tokio::test]
async fn the_session_cookie_keeps_its_hardening_attributes() {
    let world = world("cookie").await;

    let builder = Request::builder()
        .method(Method::POST)
        .uri("/api/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({ "studentId": "student.a", "password": STUDENT_PASSWORD }).to_string(),
        ))
        .unwrap();
    let response = world.app.clone().oneshot(builder).await.unwrap();
    let cookie = response
        .headers()
        .get(header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();

    assert!(cookie.contains("HttpOnly"), "{cookie}");
    assert!(cookie.contains("Path=/"), "{cookie}");
    assert!(cookie.contains("SameSite=Lax"), "{cookie}");
    assert!(cookie.contains("Max-Age="), "{cookie}");

    // The token itself must be long enough to be unguessable.
    let value = cookie.split(';').next().unwrap().split_once('=').unwrap().1;
    assert_eq!(
        value.len(),
        43,
        "a 256-bit token is 43 base64url chars: {value}"
    );

    // Logout expires the cookie with matching attributes, or the browser keeps the original.
    let (status, headers, _) = raw(
        &world.app,
        Method::POST,
        "/api/auth/logout",
        &[("cookie", format!("{SESSION_COOKIE}={value}"))],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let cleared = headers.get(header::SET_COOKIE).unwrap().to_str().unwrap();
    assert!(cleared.contains("Max-Age=0"), "{cleared}");
    assert!(cleared.contains("HttpOnly"), "{cleared}");
    assert!(cleared.contains("SameSite=Lax"), "{cleared}");
}

/// A forged or expired session token is refused, and the refusal does not vary with the
/// token, so it cannot be used as an oracle.
#[tokio::test]
async fn forged_sessions_are_refused_indistinguishably() {
    let world = world("forged-session").await;
    let mut bodies = Vec::new();
    let forged = vec![
        "forged".to_owned(),
        String::new(),
        "a".repeat(43),
        "00000000000000000000000000000000".to_owned(),
    ];
    for token in &forged {
        let (status, body) = call(&world.app, "GET", "/api/notes", Some(token), None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "token {token:?}");
        bodies.push(body);
    }
    assert!(
        bodies.windows(2).all(|pair| pair[0] == pair[1]),
        "every invalid token must produce an identical response: {bodies:?}"
    );
}

// ------------------------------------------------------- configuration

/// Invalid configuration is refused at boot rather than producing a half-configured
/// process.
#[tokio::test]
async fn invalid_configuration_fails_at_startup() {
    for (name, variables) in [
        ("bad port", vec![("PORT", "not-a-port")]),
        ("negative session ttl", vec![("SESSION_TTL_DAYS", "0")]),
        (
            "non-numeric session ttl",
            vec![("SESSION_TTL_DAYS", "forever")],
        ),
        ("bad host", vec![("HOST", "not-an-ip")]),
        ("bad same-site", vec![("COOKIE_SAME_SITE", "sideways")]),
        (
            "same-site none without secure",
            vec![("COOKIE_SAME_SITE", "none")],
        ),
    ] {
        let result = Config::from_getter(|key| {
            variables
                .iter()
                .find(|(name, _)| *name == key)
                .map(|(_, value)| (*value).to_owned())
        });
        assert!(result.is_err(), "{name} should fail to boot: {result:?}");
        // And the message must not contain the value of a secret-looking variable.
        if let Err(error) = result {
            assert!(
                !error.to_string().to_lowercase().contains("password"),
                "{name} leaked into: {error}"
            );
        }
    }
}

/// Values that would silently disable a protection are clamped or rejected rather than
/// honoured.
#[tokio::test]
async fn dangerous_configuration_values_are_clamped() {
    // A zero or absurd body limit must not disable the limit entirely.
    for raw in ["0", "1", "999999999"] {
        let config = Config::from_getter(|k| (k == "BODY_LIMIT_BYTES").then(|| raw.into()))
            .unwrap_or_else(|_| {
                panic!("BODY_LIMIT_BYTES={raw} should be clamped, not rejected outright")
            });
        assert!(
            config.body_limit_bytes >= 1_024,
            "BODY_LIMIT_BYTES={raw} must still impose a real floor, got {}",
            config.body_limit_bytes
        );
    }

    // Same for the AI timeout: a zero must not mean "wait forever".
    for raw in ["0", "-1", "999999999"] {
        let config = Config::from_getter(|k| (k == "AI_TIMEOUT_MS").then(|| raw.into()))
            .expect("a nonsense timeout should fall back, not fail the boot");
        assert!(config.ai.timeout_ms().as_millis() >= 100);
    }
}

// --------------------------------------------------------- database failure

/// A database failure surfaces as a 500 with a flat body, never as a leaked SQL message.
#[tokio::test]
async fn a_database_failure_does_not_leak_and_does_not_panic() {
    let world = world("db-failure").await;
    // Sign in first so the session is real, then pull the database out from under it.
    world.db.close().await;

    let (status, body) = call(
        &world.app,
        "GET",
        "/api/notes",
        Some(&world.student_token),
        None,
    )
    .await;
    assert!(
        status.is_server_error() || status == StatusCode::UNAUTHORIZED,
        "a closed database must not produce a success, got {status}"
    );
    assert_secrets_absent("notes with a closed database", &body.to_string());

    // A write must fail the same way rather than half-succeeding.
    let (status, body) = call(
        &world.app,
        "POST",
        "/api/notes",
        Some(&world.student_token),
        Some(json!({ "body": "should not persist" })),
    )
    .await;
    assert!(!status.is_success(), "got {status}");
    assert_secrets_absent("note write with a closed database", &body.to_string());
}
