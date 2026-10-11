//! Account security: device sessions, and the two passwords.
//!
//! Everything runs against the real router, a real `AppState` startup (so migrations
//! really run) and a private temporary SQLite file per test. No production database is
//! opened and no credential here is a real school credential.
//!
//! # One split worth knowing about
//!
//! Most of these tests drive the HTTP surface. The ones that need a *portal* to answer
//! -- legacy sign-in, password setup, credential update -- drive
//! [`AccountSecurityService`] directly with a fake client, because the portal client is
//! constructed from configuration inside the router and there is no seam for swapping
//! it there. That is a deliberate consequence of the portal not being implemented yet
//! (see the module docs in `services::account_security`), not a shortcut around a
//! harder test.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use mmss_backend::config::Config;
use mmss_backend::cookies::hash_token;
use mmss_backend::devices::DeviceInfo;
use mmss_backend::models::{NewUser, Role};
use mmss_backend::services::account_security::{AccountSecurityService, SecurityError};
use mmss_backend::services::edusecure::{
    EduSecureClient, PortalError, PublishFuture, VerifyFuture,
};
use mmss_backend::state::AppState;
use tower::ServiceExt;

static NEXT_ID: AtomicU32 = AtomicU32::new(0);

/// Obvious test literals, chosen so a grep for a real school credential in this file
/// finds nothing.
const MMSS_PASSWORD: &str = "mmss-test-password";
const EDUSECURE_PASSWORD: &str = "portal-test-password";
const WRONG_PASSWORD: &str = "not-the-password";
const NEW_MMSS_PASSWORD: &str = "mmss-test-password-2";

// --------------------------------------------------------------- test portal

/// A stand-in for the school portal.
///
/// Models the two properties the real login flow has and the security tests care
/// about: it accepts exactly one credential, and it can be told to be unreachable so a
/// transport failure is never mistaken for a wrong password.
#[derive(Default)]
struct FakePortal {
    /// The one (school_id, password) pair this portal accepts.
    accepts: std::sync::Mutex<Option<(String, String)>>,
    /// When set, every call fails with `Unreachable` instead of answering.
    unreachable: std::sync::atomic::AtomicBool,
    /// Every pair it was asked about, so a test can assert the MMSS64 password never
    /// crossed the boundary.
    seen: std::sync::Mutex<Vec<(String, String)>>,
}

impl FakePortal {
    fn accepting(school_id: &str, password: &str) -> Arc<Self> {
        let portal = Self::default();
        *portal.accepts.lock().unwrap() = Some((school_id.to_owned(), password.to_owned()));
        Arc::new(portal)
    }

    fn seen(&self) -> Vec<(String, String)> {
        self.seen.lock().unwrap().clone()
    }

    /// True when nothing this portal was asked about was the MMSS64 password.
    fn never_saw(&self, secret: &str) -> bool {
        !self.seen().iter().any(|(_, password)| password == secret)
    }
}

impl EduSecureClient for FakePortal {
    fn publish<'a>(
        &'a self,
        _entry: &'a mmss_backend::models::Homework,
        _class_name: &'a str,
        _subject_name: &'a str,
    ) -> PublishFuture<'a> {
        Box::pin(async { Err(PortalError::Unsupported) })
    }

    fn verify_credentials<'a>(&'a self, school_id: &'a str, password: &'a str) -> VerifyFuture<'a> {
        // Recorded before anything else so the assertion holds even on the paths that
        // fail -- "was this value ever handed to the portal" must be answerable.
        self.seen
            .lock()
            .unwrap()
            .push((school_id.to_owned(), password.to_owned()));

        if self.unreachable.load(Ordering::SeqCst) {
            return Box::pin(async { Err(PortalError::Unreachable) });
        }
        let accepts = self.accepts.lock().unwrap().clone();
        Box::pin(async move {
            match accepts {
                Some((id, accepted)) if id == school_id && accepted == password => Ok(true),
                _ => Ok(false),
            }
        })
    }

    fn can_verify(&self) -> bool {
        true
    }
}

// ------------------------------------------------------------------- harness

fn temp_db_url(tag: &str) -> String {
    let unique = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "mmss-security-test-{}-{tag}-{unique}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    format!("sqlite://{}/mmss.db", dir.display())
}

/// The world a test runs in: the app, the database, and where the database file is on
/// disk so a test can prove a secret never reached it.
struct World {
    app: Router,
    state: AppState,
    db_path: std::path::PathBuf,
    dir: std::path::PathBuf,
}

impl World {
    async fn new(tag: &str) -> Self {
        Self::with_config(Config::for_tests(temp_db_url(tag))).await
    }

    async fn with_config(config: Config) -> Self {
        let db_path = std::path::PathBuf::from(
            config
                .database_url
                .strip_prefix("sqlite://")
                .expect("test URLs are file paths"),
        );
        let dir = db_path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_default();
        let state = AppState::new(config.clone()).await.unwrap();
        Self {
            app: mmss_backend::app(state.clone()),
            state,
            db_path,
            dir,
        }
    }
}

/// Enrols an account that already has an MMSS64 password of its own.
async fn enrol_with_password(state: &AppState, school_id: &str, password: &str) -> i64 {
    let user = enrol_legacy(state, school_id).await;
    mmss_backend::repositories::credentials::set_password_hash(
        &state.db,
        user,
        &mmss_backend::services::auth::hash_password(password).unwrap(),
    )
    .await
    .unwrap();
    user
}

/// Enrols an account with no MMSS64 password -- the legacy state.
async fn enrol_legacy(state: &AppState, school_id: &str) -> i64 {
    let user = mmss_backend::repositories::users::create(
        &state.db,
        &NewUser {
            school_id: school_id.into(),
            display_name: None,
            role: Role::Student,
            class_id: None,
        },
    )
    .await
    .unwrap();
    user.id
}

async fn body_json(response: axum::response::Response) -> serde_json::Value {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null)
}

fn json_request(method: &str, path: &str, body: serde_json::Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

/// Signs in and returns the raw `Set-Cookie` value, which is what every later request
/// presents.
async fn login(app: &Router, school_id: &str, password: &str) -> String {
    let response = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/auth/login",
            serde_json::json!({ "studentId": school_id, "password": password }),
        ))
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "login failed: {:?}",
        body_json(response).await
    );
    let cookies = response.headers().get_all("set-cookie");
    cookies
        .iter()
        .filter_map(|value| value.to_str().ok())
        .find(|value| value.starts_with("app_session="))
        .expect("login must set a session cookie")
        .split(';')
        .next()
        .unwrap()
        .to_owned()
}

/// The `sessions` array out of the paginated device-list envelope.
///
/// Kept as one helper so a shape change breaks in a single place instead of in every
/// assertion that happens to index into the response.
fn sessions_of(body: &serde_json::Value) -> &Vec<serde_json::Value> {
    body["sessions"]
        .as_array()
        .unwrap_or_else(|| panic!("expected a paginated session list, got {body}"))
}

fn with_cookie(method: &str, path: &str, cookie: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(path)
        .header("cookie", cookie)
        .body(Body::empty())
        .unwrap()
}

fn with_cookie_and_body(
    method: &str,
    path: &str,
    cookie: &str,
    body: serde_json::Value,
) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json")
        .header("cookie", cookie)
        .body(Body::from(body.to_string()))
        .unwrap()
}

/// A service wired to a fake portal, for the paths the router cannot reach yet.
fn service_with<'a>(state: &'a AppState, portal: Arc<FakePortal>) -> AccountSecurityService<'a> {
    AccountSecurityService::new(&state.db, &state.config, portal)
}

// =================================================================== sessions

#[tokio::test]
async fn a_user_sees_every_device_they_have_signed_in_on() {
    let world = World::new("device-list").await;
    let _student = enrol_with_password(&world.state, "student.devices", MMSS_PASSWORD).await;

    let laptop = login(&world.app, "student.devices", MMSS_PASSWORD).await;
    let phone = login(&world.app, "student.devices", MMSS_PASSWORD).await;

    let response = world
        .app
        .clone()
        .oneshot(with_cookie("GET", "/api/auth/sessions", &laptop))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let page = body_json(response).await;
    let rows = sessions_of(&page);

    assert_eq!(rows.len(), 2, "both devices must appear");
    let current: Vec<_> = rows.iter().filter(|row| row["current"] == true).collect();
    assert_eq!(
        current.len(),
        1,
        "exactly one row is the device making the request"
    );
    for row in rows {
        // The shape a client renders: a label, two timestamps, and a public id.
        assert!(row["deviceLabel"].is_string(), "{row}");
        assert!(row["createdAt"].as_i64().unwrap() > 0, "{row}");
        assert!(row["lastUsedAt"].as_i64().unwrap() > 0, "{row}");
        assert!(row["id"].is_string(), "{row}");
    }
    let laptop_id = current[0]["id"].clone();

    // The same list from the other device marks the *other* row as current, which is
    // what proves the flag comes from the request rather than from the data.
    let other = body_json(
        world
            .app
            .clone()
            .oneshot(with_cookie("GET", "/api/auth/sessions", &phone))
            .await
            .unwrap(),
    )
    .await;
    let other_current: Vec<_> = sessions_of(&other)
        .iter()
        .filter(|row| row["current"] == true)
        .collect();
    assert_eq!(other_current.len(), 1);
    assert_ne!(
        other_current[0]["id"], laptop_id,
        "the current-device marker must follow the request"
    );
}

#[tokio::test]
async fn a_device_label_is_recorded_and_the_user_agent_string_is_not() {
    let world = World::new("device-label").await;
    let _user = enrol_with_password(&world.state, "student.label", MMSS_PASSWORD).await;

    let response = world
        .app
        .clone()
        .oneshot(
            Request::post("/api/auth/login")
                .header("content-type", "application/json")
                .header(
                    "user-agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
                )
                .body(Body::from(
                    serde_json::json!({ "studentId": "student.label", "password": MMSS_PASSWORD })
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let cookie = response
        .headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find(|v| v.starts_with("app_session="))
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();

    let page = body_json(
        world
            .app
            .clone()
            .oneshot(with_cookie("GET", "/api/auth/sessions", &cookie))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(sessions_of(&page)[0]["deviceLabel"], "Edge on Windows");

    // The raw header is not stored anywhere: a self-reported string is a hint, and
    // keeping the whole thing would make a database dump a browser-fingerprint set.
    let stored: String =
        sqlx::query_scalar("SELECT group_concat(COALESCE(device_label, '')) FROM sessions")
            .fetch_one(&world.state.db)
            .await
            .unwrap();
    assert!(!stored.contains("Mozilla/5.0"), "{stored}");
    assert!(!stored.contains("AppleWebKit"), "{stored}");
}

#[tokio::test]
async fn the_device_list_never_carries_a_session_token() {
    let world = World::new("no-token").await;
    let _user = enrol_with_password(&world.state, "student.notoken", MMSS_PASSWORD).await;

    let cookie = login(&world.app, "student.notoken", MMSS_PASSWORD).await;
    let token = cookie.trim_start_matches("app_session=").to_owned();

    let response = world
        .app
        .clone()
        .oneshot(with_cookie("GET", "/api/auth/sessions", &cookie))
        .await
        .unwrap();
    let raw = response.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8(raw.to_vec()).unwrap();

    assert!(
        !text.contains(&token),
        "the cookie value must never be echoed"
    );
    assert!(!text.contains(&hash_token(&token)), "nor its digest");
    // And the public id is a different value from the token.
    let id = sessions_of(&serde_json::from_str::<serde_json::Value>(&text).unwrap())[0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_ne!(id, token);
}

#[tokio::test]
async fn revoking_one_session_takes_effect_on_its_very_next_request() {
    let world = World::new("revoke-one").await;
    let user = enrol_with_password(&world.state, "student.revoke", MMSS_PASSWORD).await;

    let laptop = login(&world.app, "student.revoke", MMSS_PASSWORD).await;
    let phone = login(&world.app, "student.revoke", MMSS_PASSWORD).await;

    // Find the phone's row from the laptop's point of view and revoke it.
    let rows = body_json(
        world
            .app
            .clone()
            .oneshot(with_cookie("GET", "/api/auth/sessions", &laptop))
            .await
            .unwrap(),
    )
    .await;
    let phone_id = sessions_of(&rows)
        .iter()
        .find(|row| row["current"] == false)
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();

    let response = world
        .app
        .clone()
        .oneshot(with_cookie_and_body(
            "DELETE",
            &format!("/api/auth/sessions/{phone_id}"),
            &laptop,
            serde_json::json!({ "currentPassword": MMSS_PASSWORD }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_json(response).await["revoked"], 1);

    // The revoked device is refused immediately, and so is any route behind the
    // extractor -- revocation is server-side, not a cookie the browser forgets.
    let response = world
        .app
        .clone()
        .oneshot(with_cookie("GET", "/api/auth/sessions", &phone))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let response = world
        .app
        .clone()
        .oneshot(with_cookie("GET", "/api/homework", &phone))
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        StatusCode::UNAUTHORIZED,
        "a revoked token must not reach the homework routes either"
    );

    // The row is gone from the database, not merely flagged.
    let remaining: i64 = sqlx::query_scalar("SELECT count(*) FROM sessions WHERE user_id = ?1")
        .bind(user)
        .fetch_one(&world.state.db)
        .await
        .unwrap();
    assert_eq!(remaining, 1, "only the laptop's session remains");
}

#[tokio::test]
async fn signing_out_other_devices_keeps_this_one_signed_in() {
    let world = World::new("revoke-others").await;
    let _user = enrol_with_password(&world.state, "student.others", MMSS_PASSWORD).await;

    let laptop = login(&world.app, "student.others", MMSS_PASSWORD).await;
    let phone = login(&world.app, "student.others", MMSS_PASSWORD).await;
    let tablet = login(&world.app, "student.others", MMSS_PASSWORD).await;

    let response = world
        .app
        .clone()
        .oneshot(with_cookie_and_body(
            "DELETE",
            "/api/auth/sessions/others",
            &laptop,
            serde_json::json!({ "currentPassword": MMSS_PASSWORD }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_json(response).await["revoked"], 2);

    for cookie in [phone, tablet] {
        let response = world
            .app
            .clone()
            .oneshot(with_cookie("GET", "/api/auth/sessions", &cookie))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
    // The device that asked stays signed in.
    let response = world
        .app
        .clone()
        .oneshot(with_cookie("GET", "/api/auth/sessions", &laptop))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        sessions_of(&body_json(response).await).len(),
        1,
        "only this device remains"
    );
}

#[tokio::test]
async fn signing_out_everywhere_includes_this_device() {
    let world = World::new("revoke-all").await;
    let user = enrol_with_password(&world.state, "student.all", MMSS_PASSWORD).await;

    let laptop = login(&world.app, "student.all", MMSS_PASSWORD).await;
    login(&world.app, "student.all", MMSS_PASSWORD).await;

    let response = world
        .app
        .clone()
        .oneshot(with_cookie_and_body(
            "DELETE",
            "/api/auth/sessions/all",
            &laptop,
            serde_json::json!({ "currentPassword": MMSS_PASSWORD }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    // The cookie is expired as well as the row, so the browser stops presenting it.
    let cookie_header = response
        .headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find(|v| v.starts_with("app_session="))
        .expect("the session cookie must be cleared")
        .to_owned();
    assert!(cookie_header.contains("Max-Age=0"), "{cookie_header}");
    assert_eq!(body_json(response).await["revoked"], 2);

    let response = world
        .app
        .clone()
        .oneshot(with_cookie("GET", "/api/auth/sessions", &laptop))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let remaining: i64 = sqlx::query_scalar("SELECT count(*) FROM sessions WHERE user_id = ?1")
        .bind(user)
        .fetch_one(&world.state.db)
        .await
        .unwrap();
    assert_eq!(remaining, 0);
}

// ======================================================== ownership and auth

#[tokio::test]
async fn no_user_can_see_or_revoke_another_users_sessions() {
    let world = World::new("cross-user").await;
    let _a = enrol_with_password(&world.state, "student.a", MMSS_PASSWORD).await;

    let _b = enrol_with_password(&world.state, "student.b", "student-b-password").await;

    let cookie_a = login(&world.app, "student.a", MMSS_PASSWORD).await;
    let cookie_b = login(&world.app, "student.b", "student-b-password").await;

    // A sees only A.
    let rows = body_json(
        world
            .app
            .clone()
            .oneshot(with_cookie("GET", "/api/auth/sessions", &cookie_a))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(sessions_of(&rows).len(), 1);
    let a_id = sessions_of(&rows)[0]["id"].as_str().unwrap().to_owned();
    let b_page = body_json(
        world
            .app
            .clone()
            .oneshot(with_cookie("GET", "/api/auth/sessions", &cookie_b))
            .await
            .unwrap(),
    )
    .await;
    let b_id = sessions_of(&b_page)[0]["id"].as_str().unwrap().to_owned();

    assert_ne!(a_id, b_id, "the two accounts must hold different sessions");
    // A tries every way of naming B's session, plus ids that name nothing.
    for target in [b_id.as_str(), "made-up", "1", "%20", "0"] {
        let response = world
            .app
            .clone()
            .oneshot(with_cookie_and_body(
                "DELETE",
                &format!("/api/auth/sessions/{target}"),
                &cookie_a,
                serde_json::json!({ "currentPassword": MMSS_PASSWORD }),
            ))
            .await
            .unwrap();
        // The route answers 200 with `revoked: 0` -- identical to "no such session",
        // so the answer does not reveal whether the id exists.
        assert_eq!(response.status(), StatusCode::OK);
        let body = body_json(response).await;
        assert_eq!(
            body["revoked"], 0,
            "A must not be able to revoke {target:?}, got {body}"
        );
    }

    // B's session still works, which is the property that actually matters.
    let response = world
        .app
        .clone()
        .oneshot(with_cookie("GET", "/api/auth/sessions", &cookie_b))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // A's "sign out everywhere else" cannot reach B either.
    let response = world
        .app
        .clone()
        .oneshot(with_cookie_and_body(
            "DELETE",
            "/api/auth/sessions/others",
            &cookie_a,
            serde_json::json!({ "currentPassword": MMSS_PASSWORD }),
        ))
        .await
        .unwrap();
    assert_eq!(body_json(response).await["revoked"], 0);
    let response = world
        .app
        .clone()
        .oneshot(with_cookie("GET", "/api/auth/sessions", &cookie_b))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // A *can* revoke its own session -- that is a supported action, and it is what
    // makes the checks above about ownership rather than about a route that simply
    // refuses everything. Done last, because it ends A's session.
    let response = world
        .app
        .clone()
        .oneshot(with_cookie_and_body(
            "DELETE",
            &format!("/api/auth/sessions/{a_id}"),
            &cookie_a,
            serde_json::json!({ "currentPassword": MMSS_PASSWORD }),
        ))
        .await
        .unwrap();
    assert_eq!(body_json(response).await["revoked"], 1);
    let response = world
        .app
        .clone()
        .oneshot(with_cookie("GET", "/api/auth/sessions", &cookie_a))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_client_supplied_user_id_is_not_a_field_anywhere() {
    // The defence is structural: the routes derive the account from the session and
    // there is no parameter for a caller to fill in. Asserted against the wire shapes.
    let world = World::new("no-userid-field").await;
    let _user = enrol_with_password(&world.state, "student.noowner", MMSS_PASSWORD).await;

    let cookie = login(&world.app, "student.noowner", MMSS_PASSWORD).await;

    // A body naming another account, and a query string naming another account, both
    // change nothing: there is no code reading either.
    let response = world
        .app
        .clone()
        .oneshot(with_cookie_and_body(
            "DELETE",
            "/api/auth/sessions/others?userId=999999",
            &cookie,
            serde_json::json!({ "currentPassword": MMSS_PASSWORD, "userId": 999999 }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        body_json(response).await["revoked"],
        0,
        "there was nothing of this user's to revoke besides the current session"
    );
}

#[tokio::test]
async fn every_session_action_requires_the_password_again() {
    let world = World::new("reauth").await;
    let _user = enrol_with_password(&world.state, "student.reauth", MMSS_PASSWORD).await;

    let laptop = login(&world.app, "student.reauth", MMSS_PASSWORD).await;
    let phone = login(&world.app, "student.reauth", MMSS_PASSWORD).await;

    let rows = body_json(
        world
            .app
            .clone()
            .oneshot(with_cookie("GET", "/api/auth/sessions", &laptop))
            .await
            .unwrap(),
    )
    .await;
    let phone_id = sessions_of(&rows)
        .iter()
        .find(|row| row["current"] == false)
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();

    // A stolen session alone must not be able to end the owner's other sessions --
    // that is how a theft would be made permanent before it was noticed.
    for (method, path, body) in [
        (
            "DELETE",
            format!("/api/auth/sessions/{phone_id}"),
            serde_json::json!({ "currentPassword": WRONG_PASSWORD }),
        ),
        (
            "DELETE",
            "/api/auth/sessions/others".to_owned(),
            serde_json::json!({ "currentPassword": WRONG_PASSWORD }),
        ),
        (
            "DELETE",
            "/api/auth/sessions/all".to_owned(),
            serde_json::json!({ "currentPassword": WRONG_PASSWORD }),
        ),
    ] {
        let response = world
            .app
            .clone()
            .oneshot(with_cookie_and_body(method, &path, &laptop, body))
            .await
            .unwrap();
        assert!(
            response.status() == StatusCode::UNAUTHORIZED,
            "{path} must require the password, got {}",
            response.status()
        );
    }

    // Omitting the field is refused as well -- a 400 rather than a 401, because the
    // request is malformed rather than the password wrong, and it is still a refusal.
    let response = world
        .app
        .clone()
        .oneshot(with_cookie_and_body(
            "DELETE",
            "/api/auth/sessions/others",
            &laptop,
            serde_json::json!({}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    // Nothing was revoked by any of those attempts.
    let response = world
        .app
        .clone()
        .oneshot(with_cookie("GET", "/api/auth/sessions", &laptop))
        .await
        .unwrap();
    assert_eq!(sessions_of(&body_json(response).await).len(), 2);
    let response = world
        .app
        .clone()
        .oneshot(with_cookie("GET", "/api/auth/sessions", &phone))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK, "the phone survives too");
}

#[tokio::test]
async fn session_management_is_closed_to_anonymous_callers() {
    let world = World::new("anon").await;
    for (method, path) in [
        ("GET", "/api/auth/sessions"),
        ("DELETE", "/api/auth/sessions/others"),
        ("DELETE", "/api/auth/sessions/all"),
        ("DELETE", "/api/auth/sessions/abc"),
        ("GET", "/api/auth/security"),
        ("POST", "/api/auth/security/password"),
        ("POST", "/api/auth/security/edusecure"),
    ] {
        let response = world
            .app
            .clone()
            .oneshot(json_request(
                method,
                path,
                serde_json::json!({ "currentPassword": MMSS_PASSWORD }),
            ))
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::UNAUTHORIZED,
            "{method} {path} must be session-guarded"
        );
    }
}

#[tokio::test]
async fn an_expired_or_long_idle_session_is_refused_and_cleaned_up() {
    let world = World::new("expiry").await;
    let _user = enrol_with_password(&world.state, "student.expired", MMSS_PASSWORD).await;

    let cookie = login(&world.app, "student.expired", MMSS_PASSWORD).await;
    let token = cookie.trim_start_matches("app_session=");

    // Aged past the absolute deadline.
    sqlx::query("UPDATE sessions SET expires_at = ?1")
        .bind(mmss_backend::clock::now_ms() - 1)
        .execute(&world.state.db)
        .await
        .unwrap();
    let response = world
        .app
        .clone()
        .oneshot(with_cookie("GET", "/api/auth/sessions", &cookie))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let remaining: i64 = sqlx::query_scalar("SELECT count(*) FROM sessions")
        .fetch_one(&world.state.db)
        .await
        .unwrap();
    assert_eq!(remaining, 0, "an expired row is deleted on the way past");

    // Aged past the idle deadline while still inside its absolute lifetime.
    let cookie = login(&world.app, "student.expired", MMSS_PASSWORD).await;
    sqlx::query("UPDATE sessions SET last_used_at = ?1")
        .bind(mmss_backend::clock::now_ms() - world.state.config.session_idle_ms - 1)
        .execute(&world.state.db)
        .await
        .unwrap();
    let response = world
        .app
        .clone()
        .oneshot(with_cookie("GET", "/api/auth/sessions", &cookie))
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        StatusCode::UNAUTHORIZED,
        "an idle session must stop being a session before its absolute deadline"
    );
    let _ = token;
}

#[tokio::test]
async fn activity_is_recorded_without_writing_on_every_single_request() {
    let world = World::new("activity").await;
    let user = enrol_with_password(&world.state, "student.activity", MMSS_PASSWORD).await;

    let cookie = login(&world.app, "student.activity", MMSS_PASSWORD).await;

    // Stamped well outside the activity window, so the next request must write.
    let stale = mmss_backend::clock::now_ms() - 10 * 60 * 1000;
    sqlx::query("UPDATE sessions SET last_used_at = ?1")
        .bind(stale)
        .execute(&world.state.db)
        .await
        .unwrap();
    world
        .app
        .clone()
        .oneshot(with_cookie("GET", "/api/auth/sessions", &cookie))
        .await
        .unwrap();
    let after_first: i64 =
        sqlx::query_scalar("SELECT last_used_at FROM sessions WHERE user_id = ?1")
            .bind(user)
            .fetch_one(&world.state.db)
            .await
            .unwrap();
    assert!(after_first > stale, "the first request refreshes the stamp");

    // Requests inside the window must not write again.
    for _ in 0..5 {
        world
            .app
            .clone()
            .oneshot(with_cookie("GET", "/api/auth/sessions", &cookie))
            .await
            .unwrap();
    }
    let after_rest: i64 =
        sqlx::query_scalar("SELECT last_used_at FROM sessions WHERE user_id = ?1")
            .bind(user)
            .fetch_one(&world.state.db)
            .await
            .unwrap();
    assert_eq!(
        after_rest, after_first,
        "activity must not turn every read into a write"
    );
}

// ================================================================ rate limits

#[tokio::test]
async fn repeated_password_attempts_are_rate_limited() {
    let world = World::new("limit-password").await;
    enrol_with_password(&world.state, "student.limit", MMSS_PASSWORD).await;

    let cookie = login(&world.app, "student.limit", MMSS_PASSWORD).await;

    let mut statuses = Vec::new();
    for _ in 0..(mmss_backend::ratelimit::PASSWORD_ATTEMPTS + 2) {
        let response = world
            .app
            .clone()
            .oneshot(with_cookie_and_body(
                "DELETE",
                "/api/auth/sessions/all",
                &cookie,
                serde_json::json!({ "currentPassword": WRONG_PASSWORD }),
            ))
            .await
            .unwrap();
        statuses.push(response.status());
        if response.status() == StatusCode::TOO_MANY_REQUESTS {
            // The caller is told when to come back, and the window is not zero.
            let retry = response.headers()["retry-after"].to_str().unwrap();
            assert!(retry.parse::<u64>().unwrap() >= 1, "{retry}");
            let body = body_json(response).await;
            assert_eq!(body["code"], "TOO_MANY_REQUESTS");
            assert!(body["error"].as_str().unwrap().contains("Wait"));
        }
    }

    assert_eq!(
        statuses
            .iter()
            .filter(|s| **s == StatusCode::UNAUTHORIZED)
            .count(),
        mmss_backend::ratelimit::PASSWORD_ATTEMPTS as usize,
        "the budget is spent on wrong passwords, then refused: {statuses:?}"
    );
    assert_eq!(
        statuses.last(),
        Some(&StatusCode::TOO_MANY_REQUESTS),
        "{statuses:?}"
    );

    // And it is per account, not a global ban.
    let _other = enrol_with_password(&world.state, "student.limit.other", MMSS_PASSWORD).await;

    let other_cookie = login(&world.app, "student.limit.other", MMSS_PASSWORD).await;
    let response = world
        .app
        .clone()
        .oneshot(with_cookie_and_body(
            "DELETE",
            "/api/auth/sessions/others",
            &other_cookie,
            serde_json::json!({ "currentPassword": WRONG_PASSWORD }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn repeated_login_attempts_are_rate_limited_per_school_id() {
    let world = World::new("limit-login").await;
    let _ = enrol_with_password(&world.state, "student.loginlimit", MMSS_PASSWORD).await;

    let mut last = StatusCode::OK;
    for _ in 0..(mmss_backend::ratelimit::LOGIN_ATTEMPTS + 2) {
        let response = world
            .app
            .clone()
            .oneshot(json_request(
                "POST",
                "/api/auth/login",
                serde_json::json!({ "studentId": "student.loginlimit", "password": WRONG_PASSWORD }),
            ))
            .await
            .unwrap();
        last = response.status();
        if last == StatusCode::TOO_MANY_REQUESTS {
            assert!(response.headers().contains_key("retry-after"));
        }
    }
    assert_eq!(last, StatusCode::TOO_MANY_REQUESTS);

    // A different account is not collateral damage.
    let _other = enrol_with_password(&world.state, "student.loginlimit.other", MMSS_PASSWORD).await;

    let response = world
        .app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/auth/login",
            serde_json::json!({ "studentId": "student.loginlimit.other", "password": MMSS_PASSWORD }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

// =========================================================== the two passwords

#[tokio::test]
async fn a_legacy_account_signs_in_through_the_portal_and_keeps_the_credential() {
    let world = World::new("legacy-login").await;
    let user = enrol_legacy(&world.state, "student.legacy").await;
    let portal = FakePortal::accepting("student.legacy", EDUSECURE_PASSWORD);
    let service = service_with(&world.state, portal.clone());

    let principal = world
        .app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/auth/login",
            serde_json::json!({ "studentId": "student.legacy", "password": EDUSECURE_PASSWORD }),
        ))
        .await
        .unwrap();
    // The router builds its own client, so a login over HTTP cannot use this portal.
    // That is the documented gap; the service path below is what is exercised.
    assert!(
        principal.status() == StatusCode::OK || principal.status() == StatusCode::UNAUTHORIZED,
        "unexpected {}",
        principal.status()
    );

    // The same login, through the service with a portal that can answer.
    let verified = service
        .verify_with_portal("student.legacy", EDUSECURE_PASSWORD)
        .await
        .unwrap();
    assert!(verified);
    service
        .store_verified_credential(user, "student.legacy", EDUSECURE_PASSWORD)
        .await
        .unwrap();
    assert_eq!(
        service.edusecure_password(user).await.unwrap().as_deref(),
        Some(EDUSECURE_PASSWORD),
        "the backend can recover what it needs to fetch homework"
    );
    assert_eq!(portal.seen().len(), 2, "both operations went to the portal");
}

#[tokio::test]
async fn the_mmss_password_is_never_sent_to_the_school_portal() {
    let world = World::new("never-forwarded").await;
    let user = enrol_legacy(&world.state, "student.separate").await;
    let portal = FakePortal::accepting("student.separate", EDUSECURE_PASSWORD);
    let service = service_with(&world.state, portal.clone());

    // Migrate, then change the MMSS64 password, then reauthenticate -- every operation
    // that touches a password on this account.
    service
        .set_up_password(
            user,
            "student.separate",
            EDUSECURE_PASSWORD,
            MMSS_PASSWORD,
            MMSS_PASSWORD,
            &DeviceInfo::unknown(),
        )
        .await
        .unwrap();
    service
        .change_password(
            user,
            "student.separate",
            MMSS_PASSWORD,
            NEW_MMSS_PASSWORD,
            NEW_MMSS_PASSWORD,
            &DeviceInfo::unknown(),
        )
        .await
        .unwrap();
    service
        .reauthenticate(user, "student.separate", NEW_MMSS_PASSWORD)
        .await
        .unwrap();

    assert!(
        portal.never_saw(MMSS_PASSWORD),
        "the MMSS64 password must never cross to EduSecure: {:?}",
        portal.seen()
    );
    assert!(
        portal.never_saw(NEW_MMSS_PASSWORD),
        "nor the replacement: {:?}",
        portal.seen()
    );
    assert_eq!(
        portal
            .seen()
            .iter()
            .filter(|(_, p)| p == EDUSECURE_PASSWORD)
            .count(),
        1,
        "only the EduSecure password ever goes to the portal"
    );
}

#[tokio::test]
async fn the_two_passwords_are_independent_and_never_fall_back_on_each_other() {
    let world = World::new("independent").await;
    let user = enrol_legacy(&world.state, "student.independent").await;
    let portal = FakePortal::accepting("student.independent", EDUSECURE_PASSWORD);
    let service = service_with(&world.state, portal.clone());

    service
        .set_up_password(
            user,
            "student.independent",
            EDUSECURE_PASSWORD,
            MMSS_PASSWORD,
            MMSS_PASSWORD,
            &DeviceInfo::unknown(),
        )
        .await
        .unwrap();

    // After migration, reauthentication uses the MMSS64 password and *only* it. The
    // EduSecure password is not accepted as a substitute, so a portal password leaked
    // from somewhere else cannot be spent here.
    service
        .reauthenticate(user, "student.independent", MMSS_PASSWORD)
        .await
        .expect("the MMSS64 password verifies");
    let portal_calls_before = portal.seen().len();
    assert!(
        service
            .reauthenticate(user, "student.independent", EDUSECURE_PASSWORD)
            .await
            .is_err(),
        "the EduSecure password must not be accepted once a separate one exists"
    );
    assert_eq!(
        portal.seen().len(),
        portal_calls_before,
        "the refused attempt must not reach the portal at all: {:?}",
        portal.seen()
    );

    // Changing the MMSS64 password leaves the stored credential exactly as it was --
    // same ciphertext, same timestamp.
    let before: (String, i64, i64) = sqlx::query_as(
        "SELECT ciphertext, created_at, updated_at FROM edusecure_credentials WHERE user_id = ?1",
    )
    .bind(user)
    .fetch_one(&world.state.db)
    .await
    .unwrap();
    service
        .change_password(
            user,
            "student.independent",
            MMSS_PASSWORD,
            NEW_MMSS_PASSWORD,
            NEW_MMSS_PASSWORD,
            &DeviceInfo::unknown(),
        )
        .await
        .unwrap();
    let after: (String, i64, i64) = sqlx::query_as(
        "SELECT ciphertext, created_at, updated_at FROM edusecure_credentials WHERE user_id = ?1",
    )
    .bind(user)
    .fetch_one(&world.state.db)
    .await
    .unwrap();
    assert_eq!(
        before, after,
        "changing the app password must not touch the school credential"
    );
    assert_eq!(
        service.edusecure_password(user).await.unwrap().as_deref(),
        Some(EDUSECURE_PASSWORD)
    );

    // Login now uses the MMSS64 password and never consults the portal.
    let auth = mmss_backend::services::auth::AuthService::new(&world.state.db, &world.state.config);
    assert!(auth
        .authenticate("student.independent", NEW_MMSS_PASSWORD)
        .await
        .is_ok());
    assert!(auth
        .authenticate("student.independent", EDUSECURE_PASSWORD)
        .await
        .is_err());
    let seen_before = portal.seen().len();
    assert!(auth
        .authenticate("student.independent", NEW_MMSS_PASSWORD)
        .await
        .is_ok());
    assert_eq!(portal.seen().len(), seen_before, "login stays local");
}

#[tokio::test]
async fn an_edusecure_password_is_only_ever_stored_encrypted() {
    let world = World::new("encrypted").await;
    let user = enrol_legacy(&world.state, "student.encrypted").await;
    let portal = FakePortal::accepting("student.encrypted", EDUSECURE_PASSWORD);
    let service = service_with(&world.state, portal.clone());

    service
        .set_up_password(
            user,
            "student.encrypted",
            EDUSECURE_PASSWORD,
            MMSS_PASSWORD,
            MMSS_PASSWORD,
            &DeviceInfo::unknown(),
        )
        .await
        .unwrap();

    let stored: String =
        sqlx::query_scalar("SELECT ciphertext FROM edusecure_credentials WHERE user_id = ?1")
            .bind(user)
            .fetch_one(&world.state.db)
            .await
            .unwrap();
    assert!(stored.starts_with("v1."), "{stored}");
    assert!(!stored.contains(EDUSECURE_PASSWORD));

    // The strongest form of the claim: the plaintext is not anywhere in the database
    // file on disk, including its write-ahead log.
    for suffix in ["", "-wal", "-shm"] {
        let path = world
            .db_path
            .with_file_name(format!("mmss.db{suffix}", suffix = suffix));
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let haystack = String::from_utf8_lossy(&bytes);
        assert!(
            !haystack.contains(EDUSECURE_PASSWORD),
            "the school password is on disk in {path:?}"
        );
    }
    let _ = &world.dir;

    // And it is recoverable only by the backend, through the one decrypt path.
    assert_eq!(
        service.edusecure_password(user).await.unwrap().as_deref(),
        Some(EDUSECURE_PASSWORD)
    );
    // A different key cannot read it, which is what makes the key load-bearing.
    let other_config = Config::from_getter(|key| match key {
        "DATABASE_URL" => Some(world.state.config.database_url.clone()),
        "CREDENTIAL_ENCRYPTION_KEY" => Some("cd".repeat(32)),
        _ => None,
    })
    .unwrap();
    let wrong_key = AccountSecurityService::new(&world.state.db, &other_config, portal);
    assert!(
        matches!(
            wrong_key.edusecure_password(user).await,
            Err(SecurityError::CredentialStorageUnavailable)
        ),
        "a wrong key must fail rather than return something that looks like a password"
    );
}

#[tokio::test]
async fn credential_storage_fails_closed_without_a_key() {
    // A deployment with no `CREDENTIAL_ENCRYPTION_KEY` must be unable to store a
    // credential, loudly. The failure mode it must never have is a plaintext row.
    let world = World::with_config(
        Config::from_getter(|key| (key == "DATABASE_URL").then(|| temp_db_url("no-key"))).unwrap(),
    )
    .await;
    let user = enrol_legacy(&world.state, "student.nokey").await;
    let portal = FakePortal::accepting("student.nokey", EDUSECURE_PASSWORD);
    let service = service_with(&world.state, portal.clone());

    let error = service
        .set_up_password(
            user,
            "student.nokey",
            EDUSECURE_PASSWORD,
            MMSS_PASSWORD,
            MMSS_PASSWORD,
            &DeviceInfo::unknown(),
        )
        .await
        .unwrap_err();
    assert!(
        matches!(error, SecurityError::CredentialStorageUnavailable),
        "{error:?}"
    );
    assert_eq!(
        mmss_backend::error::ApiError::from(error).status(),
        StatusCode::SERVICE_UNAVAILABLE
    );

    // Nothing at all was written: no credential, and no MMSS64 password either. An
    // account must not be half-migrated because the deployment is misconfigured.
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM edusecure_credentials")
        .fetch_one(&world.state.db)
        .await
        .unwrap();
    assert_eq!(rows, 0);
    let hash: Option<String> =
        sqlx::query_scalar("SELECT password_hash FROM credentials WHERE user_id = ?1")
            .bind(user)
            .fetch_optional(&world.state.db)
            .await
            .unwrap();
    assert_eq!(
        hash, None,
        "no password may be written without a safe place for the credential"
    );
}

// ==================================================== verification and rollback

#[tokio::test]
async fn a_rejected_portal_password_writes_nothing_at_all() {
    let world = World::new("rejected").await;
    let user = enrol_legacy(&world.state, "student.rejected").await;
    // The portal accepts a *different* password.
    let portal = FakePortal::accepting("student.rejected", "some-other-password");
    let service = service_with(&world.state, portal.clone());

    let error = service
        .set_up_password(
            user,
            "student.rejected",
            EDUSECURE_PASSWORD,
            MMSS_PASSWORD,
            MMSS_PASSWORD,
            &DeviceInfo::unknown(),
        )
        .await
        .unwrap_err();
    // The portal said no, which is a 401 -- not the 503 that an *unreachable* portal
    // produces. The distinction is the whole reason a student is not told to retype a
    // correct password because the school portal was down.
    assert_eq!(
        mmss_backend::error::ApiError::from(error).status(),
        StatusCode::UNAUTHORIZED
    );

    let credentials: i64 = sqlx::query_scalar("SELECT count(*) FROM edusecure_credentials")
        .fetch_one(&world.state.db)
        .await
        .unwrap();
    let passwords: i64 = sqlx::query_scalar("SELECT count(*) FROM credentials")
        .fetch_one(&world.state.db)
        .await
        .unwrap();
    let sessions: i64 = sqlx::query_scalar("SELECT count(*) FROM sessions")
        .fetch_one(&world.state.db)
        .await
        .unwrap();
    assert_eq!(
        (credentials, passwords, sessions),
        (0, 0, 0),
        "a refused verification rolls back completely"
    );
}

#[tokio::test]
async fn an_unreachable_portal_is_not_reported_as_a_wrong_password() {
    let world = World::new("unreachable").await;
    let user = enrol_legacy(&world.state, "student.offline").await;
    let portal = FakePortal::accepting("student.offline", EDUSECURE_PASSWORD);
    portal.unreachable.store(true, Ordering::SeqCst);
    let service = service_with(&world.state, portal.clone());

    let error = service
        .verify_with_portal("student.offline", EDUSECURE_PASSWORD)
        .await
        .unwrap_err();
    assert!(
        matches!(error, SecurityError::EduSecure(PortalError::Unreachable)),
        "{error:?}"
    );
    // 503, not 401. Telling somebody their correct password is wrong because the
    // school portal is down is how a working password gets thrown away.
    assert_eq!(
        mmss_backend::error::ApiError::from(error).status(),
        StatusCode::SERVICE_UNAVAILABLE
    );

    // And nothing was stored from an attempt that never got an answer.
    assert!(service
        .store_verified_credential(user, "student.offline", EDUSECURE_PASSWORD)
        .await
        .is_err());
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM edusecure_credentials")
        .fetch_one(&world.state.db)
        .await
        .unwrap();
    assert_eq!(rows, 0);
}

#[tokio::test]
async fn a_failed_credential_update_leaves_the_saved_credential_intact() {
    let world = World::new("update-rollback").await;
    let user = enrol_legacy(&world.state, "student.update").await;
    let portal = FakePortal::accepting("student.update", EDUSECURE_PASSWORD);
    let service = service_with(&world.state, portal.clone());

    service
        .store_verified_credential(user, "student.update", EDUSECURE_PASSWORD)
        .await
        .unwrap();
    let original: String =
        sqlx::query_scalar("SELECT ciphertext FROM edusecure_credentials WHERE user_id = ?1")
            .bind(user)
            .fetch_one(&world.state.db)
            .await
            .unwrap();

    // An unverified replacement must not overwrite it.
    assert!(service
        .store_verified_credential(user, "student.update", "a-wrong-password")
        .await
        .is_err());
    let after_rejected: String =
        sqlx::query_scalar("SELECT ciphertext FROM edusecure_credentials WHERE user_id = ?1")
            .bind(user)
            .fetch_one(&world.state.db)
            .await
            .unwrap();
    assert_eq!(
        after_rejected, original,
        "a valid credential must survive a rejected update"
    );
    assert_eq!(
        service.edusecure_password(user).await.unwrap().as_deref(),
        Some(EDUSECURE_PASSWORD)
    );

    // Nor may an unreachable portal.
    portal.unreachable.store(true, Ordering::SeqCst);
    assert!(service
        .store_verified_credential(user, "student.update", "another-password")
        .await
        .is_err());
    let after_offline: String =
        sqlx::query_scalar("SELECT ciphertext FROM edusecure_credentials WHERE user_id = ?1")
            .bind(user)
            .fetch_one(&world.state.db)
            .await
            .unwrap();
    assert_eq!(after_offline, original);

    // A verified replacement does take effect, and the old one stops working.
    portal.unreachable.store(false, Ordering::SeqCst);
    let portal = FakePortal::accepting("student.update", "brand-new-password");
    let service = AccountSecurityService::new(&world.state.db, &world.state.config, portal);
    service
        .store_verified_credential(user, "student.update", "brand-new-password")
        .await
        .unwrap();
    assert_eq!(
        service.edusecure_password(user).await.unwrap().as_deref(),
        Some("brand-new-password")
    );
}

#[tokio::test]
async fn setup_is_refused_twice_and_never_overwrites_a_password() {
    let world = World::new("setup-twice").await;
    let user = enrol_legacy(&world.state, "student.twice").await;
    let portal = FakePortal::accepting("student.twice", EDUSECURE_PASSWORD);
    let service = service_with(&world.state, portal.clone());

    service
        .set_up_password(
            user,
            "student.twice",
            EDUSECURE_PASSWORD,
            MMSS_PASSWORD,
            MMSS_PASSWORD,
            &DeviceInfo::unknown(),
        )
        .await
        .unwrap();
    assert!(
        matches!(
            service
                .set_up_password(
                    user,
                    "student.twice",
                    EDUSECURE_PASSWORD,
                    NEW_MMSS_PASSWORD,
                    NEW_MMSS_PASSWORD,
                    &DeviceInfo::unknown(),
                )
                .await,
            Err(SecurityError::AlreadyMigrated)
        ),
        "setup must be refused once a password exists"
    );

    // The original password is untouched.
    let auth = mmss_backend::services::auth::AuthService::new(&world.state.db, &world.state.config);
    assert!(auth
        .authenticate("student.twice", MMSS_PASSWORD)
        .await
        .is_ok());
    assert!(auth
        .authenticate("student.twice", NEW_MMSS_PASSWORD)
        .await
        .is_err());
}

#[tokio::test]
async fn a_legacy_account_cannot_change_a_password_it_does_not_have_yet() {
    let world = World::new("legacy-change").await;
    let user = enrol_legacy(&world.state, "student.legacychange").await;
    let portal = FakePortal::accepting("student.legacychange", EDUSECURE_PASSWORD);
    let service = service_with(&world.state, portal.clone());

    let error = service
        .change_password(
            user,
            "student.legacychange",
            EDUSECURE_PASSWORD,
            MMSS_PASSWORD,
            MMSS_PASSWORD,
            &DeviceInfo::unknown(),
        )
        .await
        .unwrap_err();
    assert!(
        matches!(error, SecurityError::ReauthenticationFailed),
        "{error:?}"
    );
    assert_eq!(
        portal.seen(),
        Vec::<(String, String)>::new(),
        "a legacy account must not reach the portal through the change-password path"
    );
    let hash: Option<String> =
        sqlx::query_scalar("SELECT password_hash FROM credentials WHERE user_id = ?1")
            .bind(user)
            .fetch_optional(&world.state.db)
            .await
            .unwrap();
    assert_eq!(hash, None, "setup is the only way to get here");
}

// ============================================== password change over HTTP

#[tokio::test]
async fn changing_the_password_over_http_rotates_this_session_and_drops_the_rest() {
    let world = World::new("change-http").await;
    let _ = enrol_with_password(&world.state, "student.change", MMSS_PASSWORD).await;

    let laptop = login(&world.app, "student.change", MMSS_PASSWORD).await;
    let phone = login(&world.app, "student.change", MMSS_PASSWORD).await;

    let response = world
        .app
        .clone()
        .oneshot(with_cookie_and_body(
            "PATCH",
            "/api/auth/security/password",
            &laptop,
            serde_json::json!({
                "currentPassword": MMSS_PASSWORD,
                "newPassword": NEW_MMSS_PASSWORD,
                "confirmPassword": NEW_MMSS_PASSWORD,
            }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    // This browser is issued a replacement cookie rather than being logged out.
    let fresh_cookie = response
        .headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find(|v| v.starts_with("app_session="))
        .expect("a rotated session cookie")
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    assert_ne!(fresh_cookie, laptop, "the token must actually rotate");
    let body = body_json(response).await;
    assert_eq!(body["success"], true);
    assert_eq!(body["separatePasswordEnabled"], true);
    let response = world
        .app
        .clone()
        .oneshot(with_cookie("GET", "/api/auth/security", &fresh_cookie))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // The old token is dead, including the one this browser was using.
    for dead in [laptop, phone] {
        let response = world
            .app
            .clone()
            .oneshot(with_cookie("GET", "/api/auth/security", &dead))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    // And the new password is the one that works now.
    let response = world
        .app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/auth/login",
            serde_json::json!({ "studentId": "student.change", "password": NEW_MMSS_PASSWORD }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn a_mismatched_confirmation_is_refused_before_anything_is_written() {
    let world = World::new("mismatch").await;
    let _ = enrol_with_password(&world.state, "student.mismatch", MMSS_PASSWORD).await;

    let cookie = login(&world.app, "student.mismatch", MMSS_PASSWORD).await;

    let response = world
        .app
        .clone()
        .oneshot(with_cookie_and_body(
            "PATCH",
            "/api/auth/security/password",
            &cookie,
            serde_json::json!({
                "currentPassword": MMSS_PASSWORD,
                "newPassword": NEW_MMSS_PASSWORD,
                "confirmPassword": "something-else",
            }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(body_json(response).await["error"]
        .as_str()
        .unwrap()
        .contains("do not match"));

    // The old password still works, and no session was rotated.
    let response = world
        .app
        .clone()
        .oneshot(with_cookie("GET", "/api/auth/security", &cookie))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = world
        .app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/auth/login",
            serde_json::json!({ "studentId": "student.mismatch", "password": MMSS_PASSWORD }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn a_wrong_current_password_changes_nothing() {
    let world = World::new("wrong-current").await;
    let _ = enrol_with_password(&world.state, "student.wrongcurrent", MMSS_PASSWORD).await;

    let cookie = login(&world.app, "student.wrongcurrent", MMSS_PASSWORD).await;

    let response = world
        .app
        .clone()
        .oneshot(with_cookie_and_body(
            "PATCH",
            "/api/auth/security/password",
            &cookie,
            serde_json::json!({
                "currentPassword": WRONG_PASSWORD,
                "newPassword": NEW_MMSS_PASSWORD,
                "confirmPassword": NEW_MMSS_PASSWORD,
            }),
        ))
        .await
        .unwrap();
    // 400, not 401: the caller is signed in and is changing their own password, so
    // "you are not authenticated" would be a different and misleading claim. This is the
    // status `PATCH /auth/password` has always answered with.
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(body_json(response).await["error"]
        .as_str()
        .unwrap()
        .contains("not correct"));
    // The cookie still works: a failed change must not sign the user out.
    let response = world
        .app
        .clone()
        .oneshot(with_cookie("GET", "/api/auth/security", &cookie))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

// ================================================= status and its honesty

#[tokio::test]
async fn the_status_endpoint_reports_configuration_and_nothing_else() {
    let world = World::new("status").await;
    let _ = enrol_with_password(&world.state, "student.status", MMSS_PASSWORD).await;

    let cookie = login(&world.app, "student.status", MMSS_PASSWORD).await;

    let response = world
        .app
        .clone()
        .oneshot(with_cookie("GET", "/api/auth/security", &cookie))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let raw = response.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8(raw.to_vec()).unwrap();
    assert_eq!(
        text,
        r#"{"hasMmssPassword":true,"edusecureCredentialConfigured":false,"edusecureVerificationAvailable":false}"#
    );
    // No field that could leak anything, now or after a credential is stored. The
    // field *names* legitimately mention passwords and credentials; what must not be
    // present is anything about their values.
    for forbidden in [
        "cipher",
        "\"length",
        "updatedAt",
        "createdAt",
        "schoolId",
        "v1.",
    ] {
        assert!(
            !text.to_lowercase().contains(&forbidden.to_lowercase()),
            "{forbidden:?} must not appear in {text}"
        );
    }
}

// ============================================================ regressions

#[tokio::test]
async fn homework_routes_keep_their_existing_authorization() {
    // The new session columns must not change what a signed-in user can read, and a
    // revoked token must be refused everywhere, not only on the new routes.
    let world = World::new("homework-regression").await;
    // In a class, because a student with no class has nothing to see and the resulting
    // 403 would be indistinguishable from an authorization regression here.
    let class = mmss_backend::repositories::classes::create(
        &world.state.db,
        &mmss_backend::models::NewClass::new("9-F"),
    )
    .await
    .unwrap();
    let user = enrol_with_password(&world.state, "student.regression", MMSS_PASSWORD).await;
    sqlx::query("UPDATE users SET class_id = ?1 WHERE id = ?2")
        .bind(class.id)
        .bind(user)
        .execute(&world.state.db)
        .await
        .unwrap();

    let cookie = login(&world.app, "student.regression", MMSS_PASSWORD).await;

    for path in [
        "/api/homework",
        "/api/subjects",
        "/api/notes",
        "/api/progress",
    ] {
        let response = world
            .app
            .clone()
            .oneshot(with_cookie("GET", path, &cookie))
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::OK,
            "{path} must still answer a signed-in student"
        );
        // ...and refuse an anonymous one.
        let anonymous = world
            .app
            .clone()
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED, "{path}");
    }

    // The account view the existing client depends on is unchanged.
    let response = world
        .app
        .clone()
        .oneshot(with_cookie("GET", "/api/auth/me", &cookie))
        .await
        .unwrap();
    let me = body_json(response).await;
    assert_eq!(me["authenticated"], true);
    assert_eq!(me["user"]["studentId"], "student.regression");
    for field in [
        "id",
        "displayName",
        "classId",
        "section",
        "role",
        "isAdmin",
        "isTeacher",
    ] {
        assert!(me["user"].get(field).is_some(), "missing {field}: {me}");
    }
}

// ================================================= account enumeration

#[tokio::test]
async fn a_login_never_reveals_which_accounts_still_use_the_school_portal() {
    // The one thing this whole feature could have got wrong quietly: if a legacy
    // account's failed login answered differently from a migrated account's, the
    // difference would be an oracle for "does this school ID have a local password".
    //
    // The configuration here is the dangerous one -- `EDUSECURE_*` fully set, so
    // everything *looks* configured -- with no portal client actually present.
    let config = Config::from_getter(|key| match key {
        "DATABASE_URL" => Some(temp_db_url("enumeration")),
        "CREDENTIAL_ENCRYPTION_KEY" => Some(mmss_backend::config::TEST_CREDENTIAL_KEY.to_owned()),
        "EDUSECURE_BASE_URL" => Some("https://portal.invalid/ParentApp".into()),
        "EDUSECURE_USERNAME" => Some("svc".into()),
        "EDUSECURE_PASSWORD" => Some("deployment-password".into()),
        _ => None,
    })
    .unwrap();
    assert!(
        config.edusecure.enabled(),
        "the point of this test is a fully configured-looking deployment"
    );

    let world = World::with_config(config).await;
    enrol_legacy(&world.state, "student.legacy").await;
    let _ = enrol_with_password(&world.state, "student.migrated", MMSS_PASSWORD).await;

    let mut answers = Vec::new();
    for school_id in ["student.legacy", "student.migrated", "student.nobody"] {
        let response = world
            .app
            .clone()
            .oneshot(json_request(
                "POST",
                "/api/auth/login",
                serde_json::json!({ "studentId": school_id, "password": WRONG_PASSWORD }),
            ))
            .await
            .unwrap();
        let status = response.status();
        let body = body_json(response).await;
        answers.push((
            school_id.to_owned(),
            status,
            body["error"].as_str().map(str::to_owned),
        ));
    }

    for (school_id, status, message) in &answers {
        assert_eq!(
            *status,
            StatusCode::UNAUTHORIZED,
            "{school_id:?} must be refused like any other wrong password, not 503"
        );
        assert_eq!(message.as_deref(), Some("Invalid school ID or password."));
    }
}

#[tokio::test]
async fn the_status_endpoint_does_not_advertise_an_integration_that_cannot_work() {
    // Same trap, on the surface that is *meant* to answer "can this be offered".
    let config = Config::from_getter(|key| match key {
        "DATABASE_URL" => Some(temp_db_url("status-unavailable")),
        "EDUSECURE_BASE_URL" => Some("https://portal.invalid/ParentApp".into()),
        "EDUSECURE_USERNAME" => Some("svc".into()),
        "EDUSECURE_PASSWORD" => Some("deployment-password".into()),
        _ => None,
    })
    .unwrap();
    let world = World::with_config(config).await;
    let user = enrol_with_password(&world.state, "student.status2", MMSS_PASSWORD).await;
    let _ = user;
    let cookie = login(&world.app, "student.status2", MMSS_PASSWORD).await;

    let status = body_json(
        world
            .app
            .clone()
            .oneshot(with_cookie("GET", "/api/auth/security", &cookie))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(
        status["edusecureVerificationAvailable"], false,
        "a configured-looking deployment with no client must not advertise the flows"
    );
}

// ==================================================================== CSRF

/// Every encoding a browser can produce from a `<form>` without a preflight, against
/// every state-changing auth route.
///
/// The dangerous one is `text/plain`: `<form enctype="text/plain">` sends a body with
/// no preflight and `Content-Type: text/plain`, and these handlers parse JSON by hand --
/// so a JSON body under that header used to be accepted. Against the password-change
/// route that is not a nuisance, it is account takeover.
///
/// `application/x-www-form-urlencoded` and `multipart/form-data` were always safe by
/// virtue of not being JSON, and are asserted here so that stays true.
#[tokio::test]
async fn no_browser_forgeable_body_encoding_can_change_an_account() {
    let world = World::new("csrf").await;
    let user = enrol_with_password(&world.state, "student.csrf", MMSS_PASSWORD).await;
    let cookie = login(&world.app, "student.csrf", MMSS_PASSWORD).await;

    let attacks: Vec<(&str, &str, &str, &str)> = vec![
        (
            "PATCH",
            "/api/auth/profile",
            "text/plain",
            r#"{"displayName":"Attacker"}"#,
        ),
        (
            "PATCH",
            "/api/auth/profile",
            "application/x-www-form-urlencoded",
            "displayName=Attacker",
        ),
        (
            "PATCH",
            "/api/auth/security/password",
            "text/plain",
            r#"{"currentPassword":MMSS_PASSWORD,"newPassword":"pwned-password","confirmPassword":"pwned-password"}"#,
        ),
        (
            "PATCH",
            "/api/auth/security/password",
            "application/x-www-form-urlencoded",
            "currentPassword=test-mmss-password&newPassword=pwned-password&confirmPassword=pwned-password",
        ),
        (
            "PATCH",
            "/api/auth/password",
            "text/plain",
            r#"{"currentPassword":MMSS_PASSWORD,"newPassword":"pwned-password"}"#,
        ),
        (
            "DELETE",
            "/api/auth/sessions/all",
            "text/plain",
            r#"{"currentPassword":MMSS_PASSWORD}"#,
        ),
        (
            "DELETE",
            "/api/auth/sessions/others",
            "text/plain",
            r#"{"currentPassword":MMSS_PASSWORD}"#,
        ),
        (
            "POST",
            "/api/auth/security/edusecure",
            "text/plain",
            r#"{"currentPassword":MMSS_PASSWORD,"newPassword":"pwned"}"#,
        ),
        // Logout is the one route that ignores its body entirely, so it is the one a
        // pure-body check could never have caught.
        ("POST", "/api/auth/logout", "text/plain", ""),
    ];

    for (method, path, content_type, body) in &attacks {
        let response = world
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .method(*method)
                    .uri(*path)
                    .header("content-type", *content_type)
                    .header("cookie", &cookie)
                    .header("origin", "https://evil.example")
                    .header("referer", "https://evil.example/attack.html")
                    .body(Body::from(*body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "{method} {path} as {content_type} must be refused"
        );
    }

    // Nothing moved: the profile, the password and the session are all untouched.
    let name: Option<String> = sqlx::query_scalar("SELECT display_name FROM users WHERE id = ?1")
        .bind(user)
        .fetch_optional(&world.state.db)
        .await
        .unwrap();
    assert_ne!(
        name.as_deref(),
        Some("Attacker"),
        "the profile must be untouched"
    );

    let auth = mmss_backend::services::auth::AuthService::new(&world.state.db, &world.state.config);
    assert!(
        auth.authenticate("student.csrf", MMSS_PASSWORD)
            .await
            .is_ok(),
        "the real password must still be the one that works"
    );
    assert!(
        auth.authenticate("student.csrf", "pwned-password")
            .await
            .is_err(),
        "a forged password must not have been installed"
    );

    // ...and the session survived, so none of the revocations landed either.
    let response = world
        .app
        .clone()
        .oneshot(with_cookie("GET", "/api/auth/security", &cookie))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

/// The guard covers the whole API, not just `/auth`.
///
/// It was originally scoped to the auth router, on the argument that a forged request
/// there is a takeover. But the same raw-bytes-and-parse shape exists on notes,
/// progress, the homework compat aliases and teacher homework, and a forged
/// `PATCH /api/teacher/homework/{id}` edits what a teacher published. One layer for the
/// whole API is also one fewer place for the next route to forget.
#[tokio::test]
async fn non_auth_mutation_routes_are_covered_by_the_same_guard() {
    let world = World::new("csrf-wide").await;
    let _user = enrol_with_password(&world.state, "student.wide", MMSS_PASSWORD).await;
    let cookie = login(&world.app, "student.wide", MMSS_PASSWORD).await;

    // Routes this account may not reach are still expected to answer 415 rather than
    // acting on the request, because the guard sits outside every handler.
    let routes = [
        ("POST", "/api/notes"),
        ("PATCH", "/api/notes/1"),
        ("DELETE", "/api/notes/1"),
        ("POST", "/api/notes/homework/1"),
        ("PATCH", "/api/progress/1"),
        ("PATCH", "/api/homework/1/status"),
        ("PATCH", "/api/homework/1/note"),
        ("POST", "/api/teacher/homework"),
        ("PATCH", "/api/teacher/homework/1"),
        ("DELETE", "/api/teacher/homework/1"),
        ("POST", "/api/edusecure/import"),
    ];

    for (method, path) in routes {
        let forged = world
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header("content-type", "text/plain")
                    .header("cookie", &cookie)
                    .header("origin", "https://evil.example")
                    .body(Body::from(r#"{"body":"Attacker was here"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            forged.status(),
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "{method} {path} accepted a browser-forgeable body"
        );
    }

    // Nothing was written.
    let notes: i64 = sqlx::query_scalar("SELECT count(*) FROM notes")
        .fetch_one(&world.state.db)
        .await
        .unwrap();
    let homework: i64 = sqlx::query_scalar("SELECT count(*) FROM homework")
        .fetch_one(&world.state.db)
        .await
        .unwrap();
    assert_eq!(
        (notes, homework),
        (0, 0),
        "no forged request may have any effect"
    );
}

/// Reads are never gated, or a link or a prefetch would stop working.
#[tokio::test]
async fn reads_are_never_blocked_by_the_guard() {
    let world = World::new("csrf-reads").await;
    let _user = enrol_with_password(&world.state, "student.reads", MMSS_PASSWORD).await;
    let cookie = login(&world.app, "student.reads", MMSS_PASSWORD).await;

    for path in [
        "/api/auth/me",
        "/api/auth/security",
        "/api/auth/sessions",
        "/api/homework",
        "/api/notes",
        "/api/progress",
        "/api/subjects",
    ] {
        let response = world
            .app
            .clone()
            .oneshot(with_cookie("GET", path, &cookie))
            .await
            .unwrap();
        assert!(
            response.status() != StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "{path} must not be gated by the CSRF guard"
        );
    }
}

/// The same requests with a well-behaved client still work, so the guard is not simply
/// a wall.
#[tokio::test]
async fn a_json_client_is_never_blocked_by_the_csrf_guard() {
    let world = World::new("csrf-ok").await;
    let _user = enrol_with_password(&world.state, "student.csrfok", MMSS_PASSWORD).await;
    let cookie = login(&world.app, "student.csrfok", MMSS_PASSWORD).await;

    // `charset` on the content type is what browsers add, and must not be a 415.
    let response = world
        .app
        .clone()
        .oneshot(
            Request::patch("/api/auth/profile")
                .header("content-type", "application/json; charset=utf-8")
                .header("cookie", &cookie)
                .body(Body::from(r#"{"displayName":"Real Name"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // Reads are never affected -- a prefetch or a link must keep working.
    let response = world
        .app
        .clone()
        .oneshot(with_cookie("GET", "/api/auth/sessions", &cookie))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

/// A CORS preflight must be answered by the CORS layer, not refused by the CSRF guard.
///
/// This is a regression test for a real bug: the guard was layered *outside* CORS, so
/// the browser's preflight — an `OPTIONS` with no body and no `Content-Type` — was
/// answered `415` before `CorsLayer` ever saw it. The shipped deployment is
/// same-origin and never sends a preflight, so it looked fine; the cross-origin
/// topology `DEPLOYMENT.md` documents was entirely broken.
#[tokio::test]
async fn a_cors_preflight_is_answered_by_cors_not_refused_by_the_csrf_guard() {
    let dir = std::env::temp_dir().join(format!("mmss-preflight-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let config = Config::from_getter(|key| match key {
        "DATABASE_URL" => Some(format!("sqlite://{}/mmss.db", dir.display())),
        "ALLOWED_ORIGINS" => Some("https://frontend.example".into()),
        _ => None,
    })
    .unwrap();
    let app = mmss_backend::app(AppState::new(config).await.unwrap());

    let preflight = app
        .clone()
        .oneshot(
            Request::builder()
                .method("OPTIONS")
                .uri("/api/auth/logout")
                .header("origin", "https://frontend.example")
                .header("access-control-request-method", "POST")
                .header("access-control-request-headers", "content-type")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_ne!(
        preflight.status(),
        StatusCode::UNSUPPORTED_MEDIA_TYPE,
        "the guard must not see a preflight"
    );
    assert_eq!(
        preflight.headers()["access-control-allow-origin"],
        "https://frontend.example",
        "an allowlisted preflight must be answered by CORS"
    );

    // The guard still refuses the *actual* cross-site mutation that follows it. That is
    // the whole point of the ordering: the preflight succeeds, the request does not.
    let actual = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/logout")
                .header("origin", "https://frontend.example")
                .header("content-type", "text/plain")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        actual.status(),
        StatusCode::UNSUPPORTED_MEDIA_TYPE,
        "the real request is still gated"
    );
}

// ================================================================ pagination

/// A large device list is served a page at a time, and the totals are honest.
///
/// The account this was written for has 91 live sessions. Returning all of them was
/// not a crash risk but it made the page unreadable, and a bounded list that quietly
/// hid the rest would be worse: a user cannot revoke a device they cannot see.
#[tokio::test]
async fn a_large_device_list_is_paginated_with_honest_totals() {
    let world = World::new("pagination").await;
    let _user = enrol_with_password(&world.state, "student.pages", MMSS_PASSWORD).await;

    // 91 rows for one account, as in the real database.
    let now = mmss_backend::clock::now_ms();
    for index in 0..91 {
        sqlx::query(
            "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, id, last_used_at, device_label)
             VALUES (?1, ?2, ?3, ?4, ?5, ?3, 'Chrome on Linux')",
        )
        .bind(format!("digest-{index}"))
        .bind(1)
        .bind(now - index)
        .bind(now + 86_400_000)
        .bind(format!("session-{index}"))
        .execute(&world.state.db)
        .await
        .unwrap();
    }

    let cookie = login(&world.app, "student.pages", MMSS_PASSWORD).await;

    // First page: bounded, with an accurate total and a truthful `hasMore`.
    let first = body_json(
        world
            .app
            .clone()
            .oneshot(with_cookie(
                "GET",
                "/api/auth/sessions?limit=20&offset=0",
                &cookie,
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(sessions_of(&first).len(), 20, "the page must be bounded");
    assert_eq!(
        first["total"], 92,
        "the real total is 91 fixtures plus this login"
    );
    assert_eq!(first["hasMore"], true);
    assert_eq!(first["offset"], 0);
    assert_eq!(first["limit"], 20);

    // Last page: partial, and `hasMore` goes false.
    let last = body_json(
        world
            .app
            .clone()
            .oneshot(with_cookie(
                "GET",
                "/api/auth/sessions?limit=20&offset=80",
                &cookie,
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(
        sessions_of(&last).len(),
        12,
        "92 rows, two full pages, twelve left"
    );
    assert_eq!(last["hasMore"], false);
    assert_eq!(last["total"], 92);

    // Paging through yields every row exactly once -- no duplicates, none skipped.
    let mut seen = std::collections::HashSet::new();
    for offset in (0..92).step_by(20) {
        let page = body_json(
            world
                .app
                .clone()
                .oneshot(with_cookie(
                    "GET",
                    &format!("/api/auth/sessions?limit=20&offset={offset}"),
                    &cookie,
                ))
                .await
                .unwrap(),
        )
        .await;
        for row in sessions_of(&page) {
            let id = row["id"].as_str().unwrap().to_owned();
            assert!(seen.insert(id.clone()), "row {id} appeared on two pages");
        }
    }
    assert_eq!(
        seen.len(),
        92,
        "every session must be reachable through the pages"
    );
}

/// A caller that sends a nonsensical-but-numeric page size is served a usable page,
/// and one that sends something that is not a number at all gets a 400 -- inventing a
/// page for `?limit=abc` would hide the mistake rather than serve the client.
#[tokio::test]
async fn page_parameters_are_clamped_rather_than_refused() {
    let world = World::new("pagination-clamp").await;
    let _user = enrol_with_password(&world.state, "student.clamp", MMSS_PASSWORD).await;
    let cookie = login(&world.app, "student.clamp", MMSS_PASSWORD).await;

    for query in [
        "/api/auth/sessions?limit=0",
        "/api/auth/sessions?limit=-5",
        "/api/auth/sessions?limit=100000",
        "/api/auth/sessions?offset=-1",
        "/api/auth/sessions?offset=99999",
    ] {
        let response = world
            .app
            .clone()
            .oneshot(with_cookie("GET", query, &cookie))
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::OK,
            "{query} must be clamped, not refused"
        );
    }

    // An absurd limit is capped, not honoured.
    let page = body_json(
        world
            .app
            .clone()
            .oneshot(with_cookie(
                "GET",
                "/api/auth/sessions?limit=100000",
                &cookie,
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(
        page["limit"], 100,
        "the limit must be capped at MAX_PAGE_SIZE"
    );

    // Not a number is a 400, not a silently defaulted page.
    let malformed = world
        .app
        .clone()
        .oneshot(with_cookie("GET", "/api/auth/sessions?limit=abc", &cookie))
        .await
        .unwrap();
    assert_eq!(malformed.status(), StatusCode::BAD_REQUEST);

    // An offset past the end is an empty page with an accurate total -- which is how a
    // client learns the list got shorter.
    let past = body_json(
        world
            .app
            .clone()
            .oneshot(with_cookie(
                "GET",
                "/api/auth/sessions?offset=99999",
                &cookie,
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(sessions_of(&past).len(), 0);
    assert_eq!(past["total"], 1, "the total is still the truth");
    assert_eq!(past["hasMore"], false);
}

/// An account whose sessions have all expired gets an empty page, not an error.
///
/// The caller must hold a live session to reach the endpoint at all, so "zero sessions"
/// is only observable for an account whose other rows have aged out underneath it.
#[tokio::test]
async fn an_account_whose_sessions_aged_out_gets_an_empty_page() {
    let world = World::new("pagination-empty").await;
    let _user = enrol_with_password(&world.state, "student.nosessions", MMSS_PASSWORD).await;
    let cookie = login(&world.app, "student.nosessions", MMSS_PASSWORD).await;

    // Every row but the caller's ages past the idle window.
    sqlx::query("UPDATE sessions SET last_used_at = 0 WHERE id != (SELECT id FROM sessions WHERE id IS NOT NULL ORDER BY last_used_at DESC LIMIT 1)")
        .execute(&world.state.db)
        .await
        .unwrap();

    let page = body_json(
        world
            .app
            .clone()
            .oneshot(with_cookie("GET", "/api/auth/sessions", &cookie))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(sessions_of(&page).len(), 1, "only the live caller remains");
    assert_eq!(page["total"], 1);
    assert_eq!(page["hasMore"], false);
}

/// A session revoked on any page disappears from the list, and the total drops.
#[tokio::test]
async fn revoking_a_session_removes_it_from_a_later_page() {
    let world = World::new("pagination-revoke").await;
    let _user = enrol_with_password(&world.state, "student.revpaged", MMSS_PASSWORD).await;
    let now = mmss_backend::clock::now_ms();
    for index in 0..30 {
        sqlx::query(
            "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, id, last_used_at, device_label)
             VALUES (?1, 1, ?2, ?3, ?4, ?2, 'Firefox on Windows')",
        )
        .bind(format!("digest-{index}"))
        .bind(now - index)
        .bind(now + 86_400_000)
        .bind(format!("session-{index}"))
        .execute(&world.state.db)
        .await
        .unwrap();
    }
    let cookie = login(&world.app, "student.revpaged", MMSS_PASSWORD).await;

    let before = body_json(
        world
            .app
            .clone()
            .oneshot(with_cookie("GET", "/api/auth/sessions", &cookie))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(before["total"], 31);

    // Revoke a row that lives on the second page.
    let page_two = body_json(
        world
            .app
            .clone()
            .oneshot(with_cookie(
                "GET",
                "/api/auth/sessions?limit=20&offset=20",
                &cookie,
            ))
            .await
            .unwrap(),
    )
    .await;
    let victim = sessions_of(&page_two)[0]["id"].as_str().unwrap().to_owned();

    let response = world
        .app
        .clone()
        .oneshot(with_cookie_and_body(
            "DELETE",
            &format!("/api/auth/sessions/{victim}"),
            &cookie,
            serde_json::json!({ "currentPassword": MMSS_PASSWORD }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_json(response).await["revoked"], 1);

    // The row is gone from the page it was on, and the total fell by one.
    let after = body_json(
        world
            .app
            .clone()
            .oneshot(with_cookie(
                "GET",
                "/api/auth/sessions?limit=20&offset=20",
                &cookie,
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(after["total"], 30, "a revoked session is no longer active");
    assert!(
        !sessions_of(&after)
            .iter()
            .any(|row| row["id"] == victim.as_str()),
        "a revoked session must not linger in the list"
    );
}

/// A row with no recorded device metadata is labelled honestly, not invented.
#[tokio::test]
async fn unknown_device_metadata_is_reported_as_unknown() {
    let world = World::new("pagination-labels").await;
    let _user = enrol_with_password(&world.state, "student.labels", MMSS_PASSWORD).await;
    sqlx::query("UPDATE sessions SET device_label = NULL")
        .execute(&world.state.db)
        .await
        .unwrap();
    let cookie = login(&world.app, "student.labels", MMSS_PASSWORD).await;
    sqlx::query("UPDATE sessions SET device_label = NULL")
        .execute(&world.state.db)
        .await
        .unwrap();

    let page = body_json(
        world
            .app
            .clone()
            .oneshot(with_cookie("GET", "/api/auth/sessions", &cookie))
            .await
            .unwrap(),
    )
    .await;
    for row in sessions_of(&page) {
        // The fallback, not a guess: a user-agent is self-reported, and the interface
        // says as much rather than presenting a fabricated identity.
        assert_eq!(row["deviceLabel"], "Unknown device");
    }
}
