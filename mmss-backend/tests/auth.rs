//! Integration tests for authentication, sessions, cookies and authorization.
//!
//! Everything runs against the real router, the real `AppState` startup path (so
//! migrations really run) and a private temporary SQLite file per test. The
//! development database under `data/` is never touched, and no credential in this
//! file is a real school credential.

use std::sync::atomic::{AtomicU32, Ordering};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use mmss_backend::auth::{AdminUser, AuthenticatedUser, StudentUser, TeacherUser};
use mmss_backend::config::{Config, CookieConfig, SameSite};
use mmss_backend::cookies::{hash_token, SESSION_COOKIE};
use mmss_backend::models::{NewUser, Role};
use mmss_backend::repositories::sessions as session_repo;
use mmss_backend::services::auth::{AuthError, AuthService};
use mmss_backend::state::AppState;
use tower::ServiceExt;

static NEXT_ID: AtomicU32 = AtomicU32::new(0);

/// Passwords here are obvious test literals, chosen so that a grep for a real school
/// credential in this file finds nothing.
const STUDENT_PASSWORD: &str = "test-student-password";
const TEACHER_PASSWORD: &str = "test-teacher-password";
const ADMIN_PASSWORD: &str = "test-admin-password";
const WRONG_PASSWORD: &str = "not-the-password";

fn temp_db_url(tag: &str) -> String {
    let unique = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "mmss-auth-test-{}-{tag}-{unique}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    format!("sqlite://{}/mmss.db", dir.display())
}

async fn fresh_state(tag: &str) -> AppState {
    AppState::new(Config::for_tests(temp_db_url(tag)))
        .await
        .expect("startup against an empty directory should succeed")
}

/// A student, a teacher and an admin, each with a password.
struct Accounts {
    student_id: i64,
    teacher_id: i64,
    admin_id: i64,
    class_id: i64,
}

async fn accounts(state: &AppState) -> Accounts {
    use mmss_backend::models::NewClass;
    use mmss_backend::repositories::classes;

    let db = &state.db;
    let config = &state.config;
    let class = classes::create(db, &NewClass::new("9-F")).await.unwrap();
    let auth = AuthService::new(db, config);

    let student = auth
        .create_user_with_password(
            &NewUser {
                school_id: "student.test".into(),
                display_name: Some("Test Student".into()),
                role: Role::Student,
                class_id: Some(class.id),
            },
            STUDENT_PASSWORD,
        )
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
        .unwrap();
    let admin = auth
        .create_user_with_password(
            &NewUser {
                school_id: "admin.test".into(),
                display_name: Some("Test Admin".into()),
                role: Role::Admin,
                class_id: None,
            },
            ADMIN_PASSWORD,
        )
        .await
        .unwrap();

    Accounts {
        student_id: student.user_id,
        teacher_id: teacher.user_id,
        admin_id: admin.user_id,
        class_id: class.id,
    }
}

fn json_request(method: &str, path: &str, body: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json")
        .body(Body::from(body.to_owned()))
        .unwrap()
}

async fn body_json(response: axum::response::Response) -> serde_json::Value {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).expect("response body must be JSON")
}

/// Signs in and returns the session cookie exactly as the browser would receive it.
async fn login(app: &Router, school_id: &str, password: &str) -> String {
    let response = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/auth/login",
            &format!("{{\"studentId\": \"{school_id}\", \"password\": \"{password}\"}}"),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK, "login should succeed");
    cookie_header(&response)
}

fn cookie_header(response: &axum::response::Response) -> String {
    response
        .headers()
        .get(axum::http::header::SET_COOKIE)
        .expect("login must set a cookie")
        .to_str()
        .unwrap()
        .to_owned()
}

fn cookie_value(set_cookie: &str) -> &str {
    set_cookie
        .split(';')
        .next()
        .and_then(|pair| pair.split_once('='))
        .map(|(_, value)| value)
        .unwrap_or_default()
}

// ------------------------------------------------------------------- login

#[tokio::test]
async fn valid_credentials_sign_the_user_in() {
    let state = fresh_state("login-ok").await;
    let accounts = accounts(&state).await;
    let app = mmss_backend::app(state);

    let response = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/auth/login",
            &format!("{{\"studentId\":\"student.test\",\"password\":\"{STUDENT_PASSWORD}\"}}"),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let set_cookie = cookie_header(&response);
    let body = body_json(response).await;

    assert_eq!(body["authenticated"], true);
    let user = &body["user"];
    assert_eq!(user["id"], accounts.student_id);
    assert_eq!(user["studentId"], "student.test");
    assert_eq!(user["displayName"], "Test Student");
    assert_eq!(user["classId"], accounts.class_id);
    assert_eq!(user["role"], "student");
    assert_eq!(user["isAdmin"], false);
    assert_eq!(user["isTeacher"], false);
    // The token is also in the body, as the old client expects, and no credential or
    // hash is anywhere in it.
    assert!(body["token"].as_str().is_some_and(|t| !t.is_empty()));
    let serialised = body.to_string();
    assert!(!serialised.contains(STUDENT_PASSWORD));
    assert!(!serialised.contains("$argon2"));
    assert!(
        cookie_value(&set_cookie).len() == 43,
        "opaque 256-bit token"
    );
}

#[tokio::test]
async fn a_wrong_password_and_an_unknown_school_id_are_indistinguishable() {
    let state = fresh_state("login-fail").await;
    accounts(&state).await;
    let db = state.db.clone();
    let app = mmss_backend::app(state);

    let wrong_password = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/auth/login",
            &format!("{{\"studentId\":\"student.test\",\"password\":\"{WRONG_PASSWORD}\"}}"),
        ))
        .await
        .unwrap();
    assert_eq!(wrong_password.status(), StatusCode::UNAUTHORIZED);
    let wrong_password_body = body_json(wrong_password).await;

    let unknown_id = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/auth/login",
            &format!("{{\"studentId\":\"nobody.test\",\"password\":\"{WRONG_PASSWORD}\"}}"),
        ))
        .await
        .unwrap();
    assert_eq!(unknown_id.status(), StatusCode::UNAUTHORIZED);
    let unknown_id_body = body_json(unknown_id).await;

    // Same status, same body. Login cannot be used to enumerate school IDs.
    assert_eq!(wrong_password_body, unknown_id_body);
    assert_eq!(wrong_password_body["authenticated"], false);
    assert_eq!(
        wrong_password_body["error"],
        "Invalid school ID or password."
    );
    // Nothing about the account, and no session was created.
    let sessions: i64 = sqlx::query_scalar("SELECT count(*) FROM sessions")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(sessions, 0, "a failed login must not leave a session");
}

#[tokio::test]
async fn an_account_with_no_local_credential_is_refused_like_a_wrong_password() {
    let state = fresh_state("login-nocredential").await;
    use mmss_backend::repositories::users;
    // A real account that this deployment holds no password for: the shape a
    // school-portal-only account will have.
    let account = users::create(
        &state.db,
        &NewUser {
            school_id: "portal.only".into(),
            display_name: None,
            role: Role::Student,
            class_id: None,
        },
    )
    .await
    .unwrap();

    let error = AuthService::new(&state.db, &state.config)
        .authenticate("portal.only", "any password at all")
        .await
        .unwrap_err();
    assert!(matches!(error, AuthError::InvalidCredentials));
    assert!(!error.to_string().contains("portal.only"));
    let _ = account;
}

#[tokio::test]
async fn missing_credentials_are_a_400_naming_the_field() {
    let state = fresh_state("login-missing").await;
    accounts(&state).await;
    let app = mmss_backend::app(state);

    for (body, expected) in [
        (
            r#"{"studentId":"  ","password":"something"}"#,
            "School ID is required.",
        ),
        (
            r#"{"studentId":"student.test","password":""}"#,
            "Password is required.",
        ),
    ] {
        let response = app
            .clone()
            .oneshot(json_request("POST", "/auth/login", body))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "for {body}");
        let json = body_json(response).await;
        assert_eq!(json["authenticated"], false);
        assert_eq!(json["error"], expected);
    }
}

#[tokio::test]
async fn a_malformed_request_is_a_400_not_a_server_error() {
    let state = fresh_state("login-malformed").await;
    let app = mmss_backend::app(state);

    // Not JSON at all.
    let response = app
        .clone()
        .oneshot(json_request("POST", "/auth/login", "this is not json"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    // Valid JSON, wrong shape.
    let response = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/auth/login",
            r#"{"unexpected":true}"#,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    // Empty body.
    let response = app
        .clone()
        .oneshot(json_request("POST", "/auth/login", ""))
        .await
        .unwrap();
    assert!(response.status().is_client_error());
}

// ---------------------------------------------------------------- sessions

#[tokio::test]
async fn a_valid_session_resolves_to_the_right_user() {
    let state = fresh_state("session-valid").await;
    let accounts = accounts(&state).await;
    let db = &state.db;
    let auth = AuthService::new(db, &state.config);

    let issued = auth.create_session(accounts.student_id).await.unwrap();
    let principal = auth
        .validate_session(&issued.token)
        .await
        .unwrap()
        .expect("a live session must resolve");
    assert_eq!(principal.user_id, accounts.student_id);
    assert_eq!(principal.school_id, "student.test");
    assert_eq!(principal.display_name.as_deref(), Some("Test Student"));
    assert_eq!(principal.class_id, Some(accounts.class_id));
    assert_eq!(principal.role, Role::Student);

    // Two users, two sessions: a session is tied to the account that made it.
    let teacher = auth.create_session(accounts.teacher_id).await.unwrap();
    assert_ne!(issued.token, teacher.token);
    assert_eq!(
        auth.validate_session(&teacher.token)
            .await
            .unwrap()
            .unwrap()
            .user_id,
        accounts.teacher_id
    );
}

#[tokio::test]
async fn an_invalid_or_absent_token_resolves_to_nothing() {
    let state = fresh_state("session-invalid").await;
    let accounts = accounts(&state).await;
    let auth = AuthService::new(&state.db, &state.config);

    // Well-formed but never issued.
    let never_issued = mmss_backend::cookies::new_session_token();
    assert!(auth
        .validate_session(&never_issued)
        .await
        .unwrap()
        .is_none());

    // Issued for one user, then that user's session deleted: the token is still
    // cryptographically perfect and still refused.
    let issued = auth.create_session(accounts.student_id).await.unwrap();
    assert!(auth
        .validate_session(&issued.token)
        .await
        .unwrap()
        .is_some());
    assert!(auth.logout(&issued.token).await.unwrap());
    assert!(auth
        .validate_session(&issued.token)
        .await
        .unwrap()
        .is_none());

    // Nonsense and empty.
    for token in [
        "",
        "not-a-token",
        "'; DROP TABLE sessions; --",
        &"a".repeat(43),
    ] {
        assert!(
            auth.validate_session(token).await.unwrap().is_none(),
            "{token:?} must not authenticate"
        );
    }
    // The injection attempt above is a string, not SQL: the table is intact.
    let sessions: i64 = sqlx::query_scalar("SELECT count(*) FROM sessions")
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(sessions, 0);
}

#[tokio::test]
async fn an_expired_session_is_refused_and_removed() {
    let state = fresh_state("session-expired").await;
    let accounts = accounts(&state).await;
    let db = &state.db;

    // A row that expired an hour ago, written the way a real session would be.
    let token = mmss_backend::cookies::new_session_token();
    session_repo::create(
        db,
        &hash_token(&token),
        accounts.student_id,
        mmss_backend::clock::now_ms() - 3_600_000,
    )
    .await
    .unwrap();

    let auth = AuthService::new(db, &state.config);
    assert!(
        auth.validate_session(&token).await.unwrap().is_none(),
        "an expired session must not grant access"
    );
    // And it is cleaned up, so a client that keeps presenting it stops costing a
    // lookup.
    let remaining: i64 = sqlx::query_scalar("SELECT count(*) FROM sessions")
        .fetch_one(db)
        .await
        .unwrap();
    assert_eq!(remaining, 0);
}

#[tokio::test]
async fn a_session_expires_when_its_configured_lifetime_is_up() {
    let tag = "session-ttl";
    let url = temp_db_url(tag);
    // A lifetime already in the past, so the session is born expired.
    let config = Config {
        session_ttl_ms: -1_000,
        ..Config::for_tests(url)
    };
    let state = AppState::new(config).await.unwrap();
    let accounts = accounts(&state).await;

    let auth = AuthService::new(&state.db, &state.config);
    let issued = auth.create_session(accounts.student_id).await.unwrap();
    assert!(auth
        .validate_session(&issued.token)
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn logout_revokes_the_session_server_side() {
    let state = fresh_state("session-logout").await;
    accounts(&state).await;
    let app = mmss_backend::app(state);

    let set_cookie = login(&app, "student.test", STUDENT_PASSWORD).await;
    let token = cookie_value(&set_cookie).to_owned();

    // Signed in.
    let me = app
        .clone()
        .oneshot(
            Request::get("/auth/me")
                .header("cookie", format!("{SESSION_COOKIE}={token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(body_json(me).await["authenticated"], true);

    // Log out over HTTP, keeping the cookie exactly as a browser would.
    let logout = app
        .clone()
        .oneshot(
            Request::post("/auth/logout")
                .header("cookie", format!("{SESSION_COOKIE}={token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(logout.status(), StatusCode::OK);
    assert_eq!(body_json(logout).await["success"], true);

    // The very same cookie is now worthless. This is the part that matters: the
    // session was revoked server-side, not merely un-sent by the browser.
    let after = app
        .clone()
        .oneshot(
            Request::get("/auth/me")
                .header("cookie", format!("{SESSION_COOKIE}={token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(body_json(after).await["authenticated"], false);
}

#[tokio::test]
async fn repeated_logout_and_logout_without_a_session_are_safe() {
    let state = fresh_state("logout-repeat").await;
    accounts(&state).await;
    let app = mmss_backend::app(state);

    // No cookie at all.
    let response = app
        .clone()
        .oneshot(Request::post("/auth/logout").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_json(response).await["success"], true);

    // A cookie that was never a session.
    let response = app
        .clone()
        .oneshot(
            Request::post("/auth/logout")
                .header("cookie", format!("{SESSION_COOKIE}=never-issued"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // Log out twice with a real session.
    let set_cookie = login(&app, "student.test", STUDENT_PASSWORD).await;
    let token = cookie_value(&set_cookie).to_owned();
    for _ in 0..2 {
        let response = app
            .clone()
            .oneshot(
                Request::post("/auth/logout")
                    .header("cookie", format!("{SESSION_COOKIE}={token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::OK,
            "logout must be idempotent"
        );
    }
}

#[tokio::test]
async fn every_session_a_user_holds_can_be_revoked_at_once() {
    let state = fresh_state("session-revoke-all").await;
    let accounts = accounts(&state).await;
    let auth = AuthService::new(&state.db, &state.config);

    let laptop = auth.create_session(accounts.student_id).await.unwrap();
    let phone = auth.create_session(accounts.student_id).await.unwrap();
    let teacher_session = auth.create_session(accounts.teacher_id).await.unwrap();

    assert_eq!(
        auth.revoke_all_sessions(accounts.student_id).await.unwrap(),
        2
    );
    assert!(auth
        .validate_session(&laptop.token)
        .await
        .unwrap()
        .is_none());
    assert!(auth.validate_session(&phone.token).await.unwrap().is_none());
    // Another account is untouched.
    assert!(auth
        .validate_session(&teacher_session.token)
        .await
        .unwrap()
        .is_some());
}

#[tokio::test]
async fn the_stored_token_is_a_digest_and_not_the_cookie_value() {
    let state = fresh_state("session-at-rest").await;
    let accounts = accounts(&state).await;
    let auth = AuthService::new(&state.db, &state.config);

    let issued = auth.create_session(accounts.student_id).await.unwrap();
    let stored: String = sqlx::query_scalar("SELECT token_hash FROM sessions")
        .fetch_one(&state.db)
        .await
        .unwrap();

    assert_ne!(stored, issued.token, "the cookie value must not be stored");
    assert_eq!(stored, hash_token(&issued.token));
    // A dump of the sessions table therefore contains no usable cookie.
    assert!(!stored.contains(&issued.token));
}

// ----------------------------------------------------------------- cookies

#[tokio::test]
async fn the_session_cookie_carries_the_required_attributes() {
    let state = fresh_state("cookie-attrs").await;
    accounts(&state).await;
    let app = mmss_backend::app(state);

    let set_cookie = login(&app, "student.test", STUDENT_PASSWORD).await;
    let header = set_cookie.to_ascii_lowercase();

    assert!(set_cookie.starts_with(&format!("{SESSION_COOKIE}=")));
    assert!(header.contains("httponly"), "HttpOnly is required");
    assert!(
        header.contains("path=/"),
        "the cookie must scope to the whole app"
    );
    assert!(header.contains("samesite=lax"));
    assert!(
        header.contains("max-age=2592000"),
        "Max-Age must match the 30-day session lifetime: {set_cookie}"
    );
    // Development is plain HTTP, so Secure is deliberately absent; a production
    // deployment turns it on, which the next test checks.
    assert!(!header.contains("secure"));
}

#[tokio::test]
async fn cookie_flags_follow_the_configuration() {
    let state = fresh_state("cookie-secure").await;
    accounts(&state).await;
    let secure_state = AppState::new(Config {
        cookie: CookieConfig {
            secure: true,
            same_site: SameSite::None,
        },
        ..Config::for_tests(temp_db_url("cookie-secure-prod"))
    })
    .await
    .unwrap();
    // The account lives in the other database, so this check is about the cookie
    // string only.
    let _ = &state;

    let config = secure_state.config.cookie.clone();
    let header = mmss_backend::cookies::session_cookie("a-token", 60, &config)
        .to_str()
        .unwrap()
        .to_ascii_lowercase();
    assert!(
        header.contains("secure"),
        "production must be Secure: {header}"
    );
    assert!(header.contains("samesite=none"), "{header}");
    assert!(header.contains("httponly"), "{header}");
}

#[tokio::test]
async fn logout_expires_the_cookie_with_matching_attributes() {
    let state = fresh_state("cookie-clear").await;
    accounts(&state).await;
    let app = mmss_backend::app(state);
    let set_cookie = login(&app, "student.test", STUDENT_PASSWORD).await;
    let token = cookie_value(&set_cookie).to_owned();

    let response = app
        .clone()
        .oneshot(
            Request::post("/auth/logout")
                .header("cookie", format!("{SESSION_COOKIE}={token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let cleared = cookie_header(&response).to_ascii_lowercase();
    assert!(
        cleared.contains("max-age=0"),
        "the cookie must be expired: {cleared}"
    );
    assert!(cleared.contains("httponly"));
    assert!(cleared.contains("path=/"));
    // The attributes have to match the ones it was set with, or the browser keeps
    // the original cookie and the user is never actually signed out.
    assert!(cleared.contains("samesite=lax"), "{cleared}");
}

// ------------------------------------------------------------- /auth/me

#[tokio::test]
async fn me_returns_the_account_for_a_live_session() {
    let state = fresh_state("me-ok").await;
    let accounts = accounts(&state).await;
    let app = mmss_backend::app(state);
    let set_cookie = login(&app, "student.test", STUDENT_PASSWORD).await;
    let token = cookie_value(&set_cookie).to_owned();

    let response = app
        .clone()
        .oneshot(
            Request::get("/auth/me")
                .header("cookie", format!("{SESSION_COOKIE}={token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // 200 for both outcomes: the existing client checks `res.ok` before reading the
    // body, so a 401 here would read as a server fault instead of "signed out".
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_json(response).await;
    assert_eq!(body["authenticated"], true);
    assert_eq!(body["user"]["id"], accounts.student_id);
    assert_eq!(body["user"]["studentId"], "student.test");
    assert_eq!(body["user"]["role"], "student");
    // No password, no hash, no session id, and no internal key beyond the account id
    // the client already needs. (classId is a legitimate part of the account view, so
    // it is asserted above rather than forbidden here.)
    let serialised = body.to_string();
    for forbidden in [
        "password",
        "$argon2",
        "token",
        SESSION_COOKIE,
        "createdAt",
        "expiresAt",
    ] {
        assert!(
            !serialised.contains(forbidden),
            "/auth/me leaked {forbidden}: {serialised}"
        );
    }
}

#[tokio::test]
async fn me_rejects_missing_invalid_and_expired_sessions() {
    let state = fresh_state("me-reject").await;
    let accounts = accounts(&state).await;
    let db = state.db.clone();
    let app = mmss_backend::app(state);

    // No cookie.
    let response = app
        .clone()
        .oneshot(Request::get("/auth/me").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_json(response).await["authenticated"], false);

    // A cookie that is not a session.
    let response = app
        .clone()
        .oneshot(
            Request::get("/auth/me")
                .header("cookie", format!("{SESSION_COOKIE}=fabricated"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(body_json(response).await["authenticated"], false);

    // A real session that has since expired.
    let expired = mmss_backend::cookies::new_session_token();
    session_repo::create(
        &db,
        &hash_token(&expired),
        accounts.student_id,
        mmss_backend::clock::now_ms() - 1,
    )
    .await
    .unwrap();
    let response = app
        .clone()
        .oneshot(
            Request::get("/auth/me")
                .header("cookie", format!("{SESSION_COOKIE}={expired}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = body_json(response).await;
    assert_eq!(body["authenticated"], false);
    assert!(
        body.get("user").is_none(),
        "an expired session must leak no user data"
    );
}

// -------------------------------------------------------- authorization

/// A router with the real middleware stack and one route per role requirement, so the
/// extractors are exercised the way a later phase will use them.
fn guarded_app(state: &AppState) -> Router {
    async fn any(user: AuthenticatedUser) -> axum::Json<serde_json::Value> {
        axum::Json(serde_json::json!({
            "user_id": user.user_id(),
            "role": user.role(),
            "class_id": user.class_id(),
            "display_name": user.display_name(),
        }))
    }
    async fn students(_: StudentUser) -> &'static str {
        "students"
    }
    async fn teachers(teacher: TeacherUser) -> axum::Json<serde_json::Value> {
        axum::Json(serde_json::json!({ "user_id": teacher.0.user_id(), "role": "teacher" }))
    }
    async fn admins(admin: AdminUser) -> axum::Json<serde_json::Value> {
        axum::Json(serde_json::json!({ "user_id": admin.0.user_id(), "role": "admin" }))
    }

    Router::new()
        .route("/any-area", axum::routing::get(any))
        .route("/student-area", axum::routing::get(students))
        .route("/teacher-area", axum::routing::get(teachers))
        .route("/admin-area", axum::routing::get(admins))
        .with_state(state.clone())
}

async fn get_with_cookie(
    app: &Router,
    path: &str,
    token: Option<&str>,
) -> axum::response::Response {
    let request = Request::builder()
        .uri(path)
        .header(
            "cookie",
            token
                .map(|token| format!("{SESSION_COOKIE}={token}"))
                .unwrap_or_default(),
        )
        .body(Body::empty())
        .unwrap();
    app.clone().oneshot(request).await.unwrap()
}

#[tokio::test]
async fn each_role_reaches_its_own_area_and_is_refused_the_others() {
    let state = fresh_state("authz-roles").await;
    let app = mmss_backend::app(state.clone());
    let guarded = guarded_app(&state);
    let accounts = accounts(&state).await;

    let student = cookie_value(&login(&app, "student.test", STUDENT_PASSWORD).await).to_owned();
    let teacher = cookie_value(&login(&app, "teacher.test", TEACHER_PASSWORD).await).to_owned();
    let admin = cookie_value(&login(&app, "admin.test", ADMIN_PASSWORD).await).to_owned();

    // A student: their own area works, and the principal carries their class.
    let response = get_with_cookie(&guarded, "/student-area", Some(&student)).await;
    assert_eq!(response.status(), StatusCode::OK);

    let response = get_with_cookie(&guarded, "/any-area", Some(&student)).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_json(response).await;
    assert_eq!(body["user_id"], accounts.student_id);
    assert_eq!(body["role"], "student");
    assert_eq!(body["class_id"], accounts.class_id);
    assert_eq!(body["display_name"], "Test Student");

    for path in ["/teacher-area", "/admin-area"] {
        let response = get_with_cookie(&guarded, path, Some(&student)).await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{path}");
        assert_eq!(body_json(response).await["code"], "FORBIDDEN");
    }

    // A teacher: their own area, and the admin area refused.
    let response = get_with_cookie(&guarded, "/teacher-area", Some(&teacher)).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_json(response).await;
    assert_eq!(body["role"], "teacher");
    assert_eq!(
        body["user_id"], accounts.teacher_id,
        "the principal must be the signed-in teacher"
    );
    assert_eq!(
        get_with_cookie(&guarded, "/student-area", Some(&teacher))
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        get_with_cookie(&guarded, "/admin-area", Some(&teacher))
            .await
            .status(),
        StatusCode::FORBIDDEN
    );

    // An administrator reaches the admin area and nothing claims to be more than it is.
    let response = get_with_cookie(&guarded, "/admin-area", Some(&admin)).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_json(response).await;
    assert_eq!(body["role"], "admin");
    assert_eq!(body["user_id"], accounts.admin_id);
    for path in ["/student-area", "/teacher-area"] {
        assert_eq!(
            get_with_cookie(&guarded, path, Some(&admin)).await.status(),
            StatusCode::FORBIDDEN,
            "{path}"
        );
    }
}

#[tokio::test]
async fn unauthenticated_access_to_a_guarded_area_is_rejected() {
    let state = fresh_state("authz-anon").await;
    let guarded = guarded_app(&state);

    for path in ["/any-area", "/student-area", "/teacher-area", "/admin-area"] {
        // No cookie.
        let response = get_with_cookie(&guarded, path, None).await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{path}");
        let body = body_json(response).await;
        assert_eq!(body["code"], "UNAUTHENTICATED");
        assert!(body.get("user").is_none());

        // A cookie that is not a session.
        let response = get_with_cookie(&guarded, path, Some("fabricated")).await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{path}");
    }
}

#[tokio::test]
async fn a_revoked_session_loses_guarded_access_immediately() {
    let state = fresh_state("authz-revoked").await;
    accounts(&state).await;
    let app = mmss_backend::app(state.clone());
    let guarded = guarded_app(&state);

    let set_cookie = login(&app, "teacher.test", TEACHER_PASSWORD).await;
    let token = cookie_value(&set_cookie).to_owned();
    assert_eq!(
        get_with_cookie(&guarded, "/teacher-area", Some(&token))
            .await
            .status(),
        StatusCode::OK
    );

    // Revoke it server-side, then replay the very same cookie.
    AuthService::new(&state.db, &state.config)
        .logout(&token)
        .await
        .unwrap();
    let response = get_with_cookie(&guarded, "/teacher-area", Some(&token)).await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

// -------------------------------------------------------- user lookup

#[tokio::test]
async fn school_id_lookup_is_exact_but_authentication_accepts_any_case() {
    let state = fresh_state("lookup-case").await;
    use mmss_backend::repositories::users;
    accounts(&state).await;
    let auth = AuthService::new(&state.db, &state.config);

    // The stored identifier keeps the spelling the account was created with.
    let exact = users::find_by_school_id(&state.db, "student.test")
        .await
        .unwrap();
    assert!(exact.is_some());
    assert!(users::find_by_school_id(&state.db, "STUDENT.TEST")
        .await
        .unwrap()
        .is_none());
    assert!(users::find_by_school_id(&state.db, "  student.test")
        .await
        .unwrap()
        .is_none());

    // Authentication is case-insensitive, as it was in the old login, and never
    // rewrites what is stored.
    for typed in [
        "student.test",
        "STUDENT.TEST",
        "Student.Test",
        " student.test ",
    ] {
        let principal = auth
            .authenticate(&AuthService::normalize_school_id(typed), STUDENT_PASSWORD)
            .await
            .expect("a student who mistypes the case must still get in");
        assert_eq!(
            principal.school_id, "student.test",
            "stored id must not change"
        );
    }
    let unchanged = users::find_by_school_id(&state.db, "student.test")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(unchanged.school_id, "student.test");
}

#[tokio::test]
async fn a_school_email_address_still_signs_in() {
    let state = fresh_state("lookup-email").await;
    accounts(&state).await;
    let app = mmss_backend::app(state);

    let response = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/auth/login",
            &format!(
                "{{\"studentId\":\"student.test@manavmangalschool.com\",\"password\":\"{STUDENT_PASSWORD}\"}}"
            ),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    // The account is still reported under its own identifier, not the email.
    assert_eq!(
        body_json(response).await["user"]["studentId"],
        "student.test"
    );
}

#[tokio::test]
async fn the_internal_user_id_is_not_the_school_id() {
    let state = fresh_state("lookup-ids").await;
    let accounts = accounts(&state).await;

    // A session resolves to the internal integer key...
    let auth = AuthService::new(&state.db, &state.config);
    let issued = auth.create_session(accounts.student_id).await.unwrap();
    let principal = auth.validate_session(&issued.token).await.unwrap().unwrap();
    assert_eq!(principal.user_id, accounts.student_id);
    assert_eq!(principal.school_id, "student.test");

    // ...and the session token encodes neither of them: no school ID in the clear,
    // and no delimiter that would suggest a `payload.signature` pair.
    assert!(!issued.token.contains("student.test"));
    assert!(
        !issued.token.contains('.'),
        "the token is opaque, not an encoded payload: {}",
        issued.token
    );
}

// ------------------------------------------------------------- lifecycle

#[tokio::test]
async fn a_session_survives_a_restart() {
    let tag = "restart";
    let url = temp_db_url(tag);

    let first = AppState::new(Config::for_tests(url.clone())).await.unwrap();
    let accounts = accounts(&first).await;
    let app = mmss_backend::app(first);
    let set_cookie = login(&app, "student.test", STUDENT_PASSWORD).await;
    let token = cookie_value(&set_cookie).to_owned();
    drop(app);

    // A second process against the same database file. The session is a SQLite row,
    // not process memory, so it is still valid -- which is the point of persisting
    // sessions, and the reason the 30-day lifetime is worth having.
    let second = AppState::new(Config::for_tests(url)).await.unwrap();
    let response = get_with_cookie(&mmss_backend::app(second), "/auth/me", Some(&token)).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_json(response).await;
    assert_eq!(body["authenticated"], true);
    assert_eq!(body["user"]["id"], accounts.student_id);
}

#[tokio::test]
async fn a_provisioned_administrator_can_sign_in() {
    let state = fresh_state("bootstrap").await;
    use mmss_backend::bootstrap;

    // A deployment with no administrator configured has no administrator at all,
    // which is the same state the old system describes as "admin login is refused".
    assert_eq!(
        bootstrap::ensure_admin(&state.db, &state.config)
            .await
            .unwrap(),
        None
    );
    let before: i64 = sqlx::query_scalar("SELECT count(*) FROM users")
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(before, 0);

    // With a password configured, the account exists and can authenticate. The
    // password is set through the environment so the code path under test is the one
    // `main` runs.
    let password = "bootstrap-test-password";
    // SAFETY: single-threaded within this test; the variable is read by
    // `ensure_admin` on the next line and removed straight after.
    unsafe { std::env::set_var("ADMIN_PASSWORD", password) };
    let user_id = bootstrap::ensure_admin(&state.db, &state.config)
        .await
        .unwrap()
        .expect("a configured password provisions the account");
    unsafe { std::env::remove_var("ADMIN_PASSWORD") };

    let user = mmss_backend::repositories::users::find_by_id(&state.db, user_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(user.role, Role::Admin);
    assert_eq!(user.school_id, "admin_mmss");

    let app = mmss_backend::app(state);
    let response = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/auth/login",
            &format!("{{\"studentId\":\"admin_mmss\",\"password\":\"{password}\"}}"),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_json(response).await;
    assert_eq!(body["user"]["role"], "admin");
    assert_eq!(body["user"]["isAdmin"], true);
}

#[tokio::test]
async fn the_login_surface_does_not_leak_internals() {
    let state = fresh_state("no-leak").await;
    accounts(&state).await;
    let app = mmss_backend::app(state);

    // Every refusal path, collected: none may name a table, a column, a SQL fragment
    // or a hash.
    let refusals = [
        (
            "unknown id",
            r#"{"studentId":"nobody.test","password":"x"}"#,
        ),
        (
            "wrong password",
            r#"{"studentId":"student.test","password":"x"}"#,
        ),
        (
            "empty password",
            r#"{"studentId":"student.test","password":""}"#,
        ),
        ("malformed", "not json at all"),
    ];
    for (label, body) in refusals {
        let response = app
            .clone()
            .oneshot(json_request("POST", "/auth/login", body))
            .await
            .unwrap();
        let text = String::from_utf8(
            response
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes()
                .to_vec(),
        )
        .unwrap();
        for leak in [
            "SELECT",
            "sqlite",
            "users",
            "credentials",
            "argon2",
            "sqlx",
            "panicked",
        ] {
            assert!(
                !text.to_lowercase().contains(&leak.to_lowercase()),
                "{label} leaked {leak}: {text}"
            );
        }
    }
}
