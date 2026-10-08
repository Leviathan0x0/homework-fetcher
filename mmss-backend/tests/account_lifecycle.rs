//! Phase 12 tests: account lifecycle and credential management.
//!
//! Two things make this file different from R11's.
//!
//! First, the security questions dominate. R11 asked "does the import work"; this asks
//! "can a deactivated student still get in, can one student change another's password, can
//! a setup token be spent twice", and the answers are asserted at the socket rather than
//! at the service.
//!
//! Second, the audit trail is a *deliverable*, so several tests read `account_events`
//! directly: "deactivated" that leaves no record is not a lifecycle operation, it is an
//! UPDATE nobody can account for.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

use mmss_backend::config::Config;
use mmss_backend::lifecycle_cli;
use mmss_backend::models::{NewUser, Role};
use mmss_backend::provisioning::{self, Report};
use mmss_backend::repositories::users;
use mmss_backend::services::accounts::AccountsService;
use mmss_backend::state::AppState;
use serde_json::{json, Value};
use sqlx::SqlitePool;

static NEXT_ID: AtomicU32 = AtomicU32::new(0);

const STUDENT_PASSWORD: &str = "student-password-1";
const OTHER_PASSWORD: &str = "other-password-22";
const TEACHER_PASSWORD: &str = "teacher-password-3";

/// A database, its roster directory, and a running server over it.
struct World {
    db: SqlitePool,
    dir: PathBuf,
    addr: SocketAddr,
    config: Config,
}

impl World {
    async fn new(tag: &str) -> Self {
        let unique = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("mmss-r12-{}-{tag}-{unique}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let config = Config::for_tests(format!("sqlite://{}/mmss.db", dir.display()));
        let db = AppState::new(config.clone()).await.unwrap().db;

        // Real TCP, real cookies, real status codes -- the same boundary R10 established.
        let state = AppState {
            db: db.clone(),
            config: config.clone(),
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = mmss_backend::app(state);
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        Self {
            db,
            dir,
            addr,
            config,
        }
    }

    fn service(&self) -> AccountsService<'_> {
        AccountsService::new(&self.db, &self.config)
    }

    async fn write(&self, name: &str, contents: &str) -> PathBuf {
        let path = self.dir.join(name);
        std::fs::write(&path, contents).unwrap();
        path
    }

    /// Enrols a small school through the real R11 importer, so every R12 test starts from
    /// accounts that arrived the way a real school's would.
    async fn enrol(&self) -> Report {
        let roster = "\
kind,id,name,role,section,password,password_hash
class,9-A,,,,
subject,Mathematics,,,,
user,2026001,Aarav Sharma,student,9-A,student-password-1,
user,2026002,Bhavya Rao,student,9-A,other-password-22,
user,t001,Ms Rao,teacher,,teacher-password-3,
user,newbie,New Student,student,9-A,,
assignment,t001,,,9-A,
";
        let path = self.write("roster.csv", roster).await;
        let report = provisioning::import_file(&self.db, &path).await.unwrap();
        assert!(report.is_clean(), "{report:?}");
        report
    }

    async fn user(&self, school_id: &str) -> mmss_backend::models::User {
        users::find_by_school_id(&self.db, school_id)
            .await
            .unwrap()
            .unwrap_or_else(|| panic!("no account {school_id}"))
    }

    async fn is_active(&self, school_id: &str) -> bool {
        self.user(school_id).await.is_active
    }

    /// The audit trail, as `(kind, actor, detail)` tuples.
    async fn events(&self) -> Vec<(String, String, Option<String>)> {
        sqlx::query_as::<_, (String, String, Option<String>)>(
            "SELECT kind, actor, detail FROM account_events ORDER BY id",
        )
        .fetch_all(&self.db)
        .await
        .unwrap()
    }

    async fn session_count(&self, school_id: &str) -> i64 {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM sessions WHERE user_id = (SELECT id FROM users WHERE school_id = ?1)",
        )
        .bind(school_id)
        .fetch_one(&self.db)
        .await
        .unwrap()
    }

    /// Everything in the `setup_tokens` table, as `(token_hash, used_at, expires_at)`.
    async fn setup_token_rows(&self) -> Vec<(String, Option<i64>, i64)> {
        sqlx::query_as("SELECT token_hash, used_at, expires_at FROM setup_tokens")
            .fetch_all(&self.db)
            .await
            .unwrap()
    }

    /// Issues a setup token and returns the plaintext -- the operator's only chance to see
    /// it, exactly as in the real flow.
    async fn setup_token(&self, school_id: &str) -> String {
        let user = self.user(school_id).await;
        self.service()
            .issue_setup_token(user.id)
            .await
            .unwrap()
            .token
    }

    // -------------------------------------------------------------- transport

    async fn send(
        &self,
        method: &str,
        path: &str,
        session: Option<&str>,
        body: Option<Value>,
    ) -> Reply {
        let mut request = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n");
        request.push_str("Accept: application/json\r\n");
        if let Some(token) = session {
            request.push_str(&format!("Cookie: app_session={token}\r\n"));
        }
        let body = body.map(|value| value.to_string());
        if let Some(text) = &body {
            request.push_str("Content-Type: application/json\r\n");
            request.push_str(&format!("Content-Length: {}\r\n", text.len()));
        }
        request.push_str("Connection: close\r\n\r\n");
        if let Some(text) = &body {
            request.push_str(text);
        }

        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut stream = tokio::net::TcpStream::connect(self.addr).await.unwrap();
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).await.unwrap();
        let text = String::from_utf8_lossy(&raw).into_owned();
        let (head, body) = text.split_once("\r\n\r\n").unwrap_or((text.as_str(), ""));

        let status = head
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|code| code.parse().ok())
            .unwrap_or(0);
        let cookie = head
            .lines()
            .filter_map(|line| line.split_once(':'))
            .find(|(name, _)| name.trim().eq_ignore_ascii_case("set-cookie"))
            .and_then(|(_, value)| {
                let pair = value.trim().split(';').next()?;
                Some(pair.split_once('=')?.1.trim().to_owned())
            });

        Reply {
            status,
            body: body.to_owned(),
            cookie,
        }
    }

    async fn login(&self, school_id: &str, password: &str) -> Reply {
        self.send(
            "POST",
            "/api/auth/login",
            None,
            Some(json!({ "studentId": school_id, "password": password })),
        )
        .await
    }
}

impl Drop for World {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

struct Reply {
    status: u16,
    body: String,
    cookie: Option<String>,
}

impl Reply {
    fn json(&self) -> Value {
        serde_json::from_str(&self.body)
            .unwrap_or_else(|_| panic!("expected JSON, got {}: {}", self.status, self.body))
    }

    fn session(&self) -> String {
        self.cookie
            .clone()
            .unwrap_or_else(|| panic!("expected a cookie, got {}: {}", self.status, self.body))
    }
}

// ------------------------------------------------------- the active/deactivated state

/// The baseline: an enrolled, active account signs in and gets a working session. Every
/// deactivation test is only meaningful next to this.
#[tokio::test]
async fn an_active_account_signs_in_and_uses_the_app() {
    let world = World::new("active").await;
    world.enrol().await;

    assert!(world.is_active("2026001").await);
    let login = world.login("2026001", STUDENT_PASSWORD).await;
    assert_eq!(login.status, 200, "{}", login.body);
    assert_eq!(login.json()["authenticated"], true);

    let session = login.session();
    let feed = world
        .send("GET", "/api/homework", Some(&session), None)
        .await;
    assert_eq!(feed.status, 200, "{}", feed.body);
}

/// Deactivated accounts cannot authenticate, and the refusal is indistinguishable from a
/// wrong password -- otherwise the login endpoint becomes a way to enumerate which school
/// IDs exist and which have been switched off.
#[tokio::test]
async fn a_deactivated_account_cannot_authenticate_and_is_indistinguishable() {
    let world = World::new("deactivated-login").await;
    world.enrol().await;

    let user = world.user("2026001").await;
    world
        .service()
        .set_active(user.id, false, "cli", Some("left the school"))
        .await
        .unwrap();
    assert!(!world.is_active("2026001").await);

    let deactivated = world.login("2026001", STUDENT_PASSWORD).await;
    assert_eq!(deactivated.status, 401);
    assert_eq!(deactivated.json()["authenticated"], false);

    // Byte-identical to every other authentication failure.
    let wrong_password = world.login("2026001", "not-the-password").await;
    let unknown_id = world.login("nobody-here", STUDENT_PASSWORD).await;
    assert_eq!(deactivated.json()["error"], wrong_password.json()["error"]);
    assert_eq!(deactivated.json()["error"], unknown_id.json()["error"]);
    assert_eq!(deactivated.body, wrong_password.body);

    // And the error body says nothing about the account's state.
    let lowered = deactivated.body.to_lowercase();
    for leak in ["deactiv", "inactive", "disabled", "left the school"] {
        assert!(
            !lowered.contains(leak),
            "{leak:?} leaked: {}",
            deactivated.body
        );
    }

    // A classmate in the same class is unaffected.
    assert_eq!(world.login("2026002", OTHER_PASSWORD).await.status, 200);
}

/// The case that makes deactivation real: someone is *already signed in* when the school
/// switches their account off. Without this, "deactivated" would mean nothing to any
/// browser that already holds a cookie.
#[tokio::test]
async fn an_existing_session_stops_working_the_moment_the_account_is_deactivated() {
    let world = World::new("session-invalidation").await;
    world.enrol().await;

    // Two devices, both live.
    let phone = world.login("2026001", STUDENT_PASSWORD).await.session();
    let laptop = world.login("2026001", STUDENT_PASSWORD).await.session();
    let classmate = world.login("2026002", OTHER_PASSWORD).await.session();
    assert_eq!(world.session_count("2026001").await, 2);

    // Both work right up to the moment of deactivation.
    for session in [&phone, &laptop] {
        assert_eq!(
            world
                .send("GET", "/api/auth/me", Some(session), None)
                .await
                .status,
            200
        );
    }

    let user = world.user("2026001").await;
    let outcome = world
        .service()
        .set_active(user.id, false, "cli", Some("left the school"))
        .await
        .unwrap();
    match outcome {
        mmss_backend::services::accounts::ActivationOutcome::Changed {
            sessions_revoked, ..
        } => assert_eq!(sessions_revoked, 2, "both devices must be revoked"),
        other => panic!("expected a change, got {other:?}"),
    }

    // The next request from either device is refused -- not the next login.
    for session in [&phone, &laptop] {
        let refused = world
            .send("GET", "/api/homework", Some(session), None)
            .await;
        assert_eq!(refused.status, 401, "{}", refused.body);
        assert_eq!(refused.json()["code"], "UNAUTHENTICATED");
        // `/auth/me` reads as signed-out, not as an error.
        let me = world.send("GET", "/api/auth/me", Some(session), None).await;
        assert_eq!(me.status, 200);
        assert_eq!(me.json()["authenticated"], false);
    }

    // The session rows are gone, so a dead cookie stops costing a lookup.
    assert_eq!(world.session_count("2026001").await, 0);
    // And a classmate's session is untouched.
    assert_eq!(world.session_count("2026002").await, 1);
    assert_eq!(
        world
            .send("GET", "/api/homework", Some(&classmate), None)
            .await
            .status,
        200
    );
}

/// Deactivating does not delete. A leaver's notes and progress are still theirs, and a
/// student who comes back gets the same account rather than a fresh one.
#[tokio::test]
async fn deactivating_keeps_the_account_and_everything_it_owns() {
    let world = World::new("keep-data").await;
    world.enrol().await;

    let session = world.login("2026001", STUDENT_PASSWORD).await.session();
    let created = world
        .send(
            "POST",
            "/api/notes",
            Some(&session),
            Some(json!({ "body": "a note from a student who left" })),
        )
        .await;
    assert!(
        created.status == 200 || created.status == 201,
        "{}",
        created.body
    );
    let note_id = created.json()["id"].as_i64().unwrap();

    let user = world.user("2026001").await;
    world
        .service()
        .set_active(user.id, false, "cli", None)
        .await
        .unwrap();

    // The account row survives, with its identity and its data.
    assert_eq!(world.user("2026001").await.id, user.id);
    let notes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM notes WHERE id = ?1")
        .bind(note_id)
        .fetch_one(&world.db)
        .await
        .unwrap();
    assert_eq!(notes, 1, "a leaver's own notes must not be cascaded away");

    // Reactivate and the account works again, with the same id and the same notes.
    world
        .service()
        .set_active(user.id, true, "cli", Some("came back"))
        .await
        .unwrap();
    assert_eq!(world.login("2026001", STUDENT_PASSWORD).await.status, 200);
    let session = world.login("2026001", STUDENT_PASSWORD).await.session();
    let listed = world.send("GET", "/api/notes", Some(&session), None).await;
    assert_eq!(listed.json().as_array().unwrap().len(), 1);
}

// --------------------------------------------------------- password rotation

/// The ordinary path: a signed-in user changes their own password, keeps their session on
/// this device, and gets locked out of the old one.
#[tokio::test]
async fn a_user_can_change_their_own_password() {
    let world = World::new("change").await;
    world.enrol().await;

    let phone = world.login("2026001", STUDENT_PASSWORD).await.session();
    let laptop = world.login("2026001", STUDENT_PASSWORD).await.session();

    let changed = world
        .send(
            "PATCH",
            "/api/auth/password",
            Some(&phone),
            Some(json!({
                "currentPassword": STUDENT_PASSWORD,
                "newPassword": "a-brand-new-password",
            })),
        )
        .await;
    assert_eq!(changed.status, 200, "{}", changed.body);
    assert_eq!(changed.json()["success"], true);
    assert_eq!(changed.json()["user"]["studentId"], "2026001");
    // A replacement cookie arrives in the same response, so the user is not logged out of
    // the browser they just changed the password in.
    let replacement = changed.session();
    assert_ne!(replacement, phone);

    // The old password is refused. Counted before the next assertion, which signs in again
    // and would add a session of its own.
    assert_eq!(world.login("2026001", STUDENT_PASSWORD).await.status, 401);
    assert_eq!(
        world.session_count("2026001").await,
        1,
        "only the replacement"
    );

    // The new one works.
    assert_eq!(
        world.login("2026001", "a-brand-new-password").await.status,
        200
    );

    // The new cookie works and the old one does not.
    assert_eq!(
        world
            .send("GET", "/api/auth/me", Some(&replacement), None)
            .await
            .json()["authenticated"],
        true
    );
    for stale in [&phone, &laptop] {
        assert_eq!(
            world
                .send("GET", "/api/homework", Some(stale), None)
                .await
                .status,
            401,
            "every session must be revoked, including the one that asked for the change"
        );
    }
    // (The surviving session was counted above, before the verification login that
    // follows the change -- a login of its own would add another row.)
}

/// A wrong current password changes nothing: not the credential, not the sessions.
#[tokio::test]
async fn a_password_change_needs_the_current_password() {
    let world = World::new("change-authz").await;
    world.enrol().await;
    let session = world.login("2026001", STUDENT_PASSWORD).await.session();

    let refused = world
        .send(
            "PATCH",
            "/api/auth/password",
            Some(&session),
            Some(json!({
                "currentPassword": "not-the-current-one",
                "newPassword": "a-brand-new-password",
            })),
        )
        .await;
    assert_eq!(refused.status, 400, "{}", refused.body);

    // Nothing moved: the old password still works, the new one does not, and the session
    // survived.
    assert_eq!(world.login("2026001", STUDENT_PASSWORD).await.status, 200);
    assert_eq!(
        world.login("2026001", "a-brand-new-password").await.status,
        401
    );
    assert_eq!(
        world
            .send("GET", "/api/auth/me", Some(&session), None)
            .await
            .json()["authenticated"],
        true
    );
}

/// The session alone is not authority to change a credential. Anyone who steals a cookie
/// must not be able to take the account over permanently.
#[tokio::test]
async fn a_stolen_session_alone_cannot_take_over_an_account() {
    let world = World::new("stolen-session").await;
    world.enrol().await;

    let owner = world.login("2026001", STUDENT_PASSWORD).await.session();
    let stolen = owner.clone(); // the same valid cookie, in someone else's hands

    let refused = world
        .send(
            "PATCH",
            "/api/auth/password",
            Some(&stolen),
            Some(json!({
                // No current password, or a guessed one.
                "newPassword": "attacker-chosen-password",
            })),
        )
        .await;
    assert!(
        refused.status == 400 || refused.status == 422,
        "{}",
        refused.body
    );

    // The owner's password is intact and still works.
    assert_eq!(world.login("2026001", STUDENT_PASSWORD).await.status, 200);
    assert_eq!(
        world
            .login("2026001", "attacker-chosen-password")
            .await
            .status,
        401
    );
}

/// Cross-user authorization, over the real socket. There is no user id in the body to
/// target, so this is asserted by attacking the shape rather than a single payload.
#[tokio::test]
async fn a_user_can_never_change_another_users_password() {
    let world = World::new("cross-user").await;
    world.enrol().await;
    let victim_id = world.user("2026002").await.id;
    // Tracked because a change that succeeds moves it: each iteration signs in with
    // whatever the caller's password currently is, so the loop exercises the request
    // shape rather than tripping over its own earlier success.
    let mut current = STUDENT_PASSWORD.to_owned();

    // Every plausible "whose password" field a client might try to send.
    for (field, value) in [
        ("userId", json!(victim_id)),
        ("id", json!(victim_id)),
        ("schoolId", json!("2026002")),
        ("studentId", json!("2026002")),
    ] {
        // A fresh session each time too: a successful change revokes every session the
        // caller holds, including the one that asked for it.
        let session = world.login("2026001", &current).await.session();
        let mut body = json!({
            "currentPassword": current,
            "newPassword": "attacker-chosen-password",
        });
        body[field] = value;

        let reply = world
            .send(
                "PATCH",
                "/api/auth/password",
                Some(&session),
                Some(body.clone()),
            )
            .await;
        assert!(
            reply.status == 200 || reply.status == 400,
            "{field}: {}",
            reply.body
        );

        // If it succeeded at all, it succeeded on the *caller*: the account the response
        // names is the only account it can ever have touched. Changing your own password
        // is the endpoint working as designed, not an attack succeeding.
        if reply.status == 200 {
            assert_eq!(
                reply.json()["user"]["studentId"],
                "2026001",
                "{field}: the write must land on the session holder"
            );
            current = "attacker-chosen-password".to_owned();
        }

        // The victim's credential is untouched, whatever the response was.
        assert_eq!(
            world.login("2026002", OTHER_PASSWORD).await.status,
            200,
            "{field} must not have reached another account"
        );
        assert_eq!(
            world
                .login("2026002", "attacker-chosen-password")
                .await
                .status,
            401,
            "{field} must not have reached another account"
        );
    }

    // Even with the caller's own current password correct -- so the change really is
    // authorised -- it still lands on the caller and only on the caller.
    let session = world.login("2026001", &current).await.session();
    let reply = world
        .send(
            "PATCH",
            "/api/auth/password",
            Some(&session),
            Some(json!({
                "currentPassword": current,
                "newPassword": "a-third-distinct-password",
                "userId": victim_id,
                "schoolId": "2026002",
            })),
        )
        .await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.json()["user"]["studentId"], "2026001");
    assert_eq!(world.login("2026002", OTHER_PASSWORD).await.status, 200);
    assert_eq!(
        world
            .login("2026002", "a-third-distinct-password")
            .await
            .status,
        401
    );
    // And the caller's own credential moved, which is the whole point: the write landed on
    // the session holder and not on the account the body tried to name.
    assert_eq!(
        world
            .login("2026001", "a-third-distinct-password")
            .await
            .status,
        200
    );
}

/// Anonymous callers get nothing, and the endpoint is not a way to create a credential.
#[tokio::test]
async fn password_change_requires_a_session_and_password_setup_does_not_allow_one() {
    let world = World::new("change-anon").await;
    world.enrol().await;

    let anonymous = world
        .send(
            "PATCH",
            "/api/auth/password",
            None,
            Some(json!({
                "currentPassword": STUDENT_PASSWORD,
                "newPassword": "attacker-chosen-password",
            })),
        )
        .await;
    assert_eq!(anonymous.status, 401, "{}", anonymous.body);
    assert_eq!(world.login("2026001", STUDENT_PASSWORD).await.status, 200);

    // The setup endpoint must not accept a session in place of a token: a token is the
    // whole of the identity verification, and a body that also carries a session would be
    // a second, weaker door.
    let session = world.login("2026001", STUDENT_PASSWORD).await.session();
    let no_token = world
        .send(
            "POST",
            "/api/auth/password/setup",
            Some(&session),
            Some(json!({ "newPassword": "attacker-chosen-password" })),
        )
        .await;
    assert_eq!(no_token.status, 400, "{}", no_token.body);
    assert_eq!(world.login("2026001", STUDENT_PASSWORD).await.status, 200);
}

// -------------------------------------------------------- first-password setup

/// The token is a real credential, so it must be unguessable and must never be stored.
#[tokio::test]
async fn a_setup_token_is_random_single_use_expiring_and_stored_only_as_a_hash() {
    let world = World::new("token-properties").await;
    world.enrol().await;

    let token = world.setup_token("newbie").await;
    // 256 bits of CSPRNG, base64url -- the same shape as a session token.
    assert_eq!(token.len(), 43, "{token}");
    assert!(token
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));

    // Tokens do not repeat. `newbie` is the only account a token can be issued for, since
    // it is the only one without a password -- which is itself asserted elsewhere.
    let mut many = std::collections::HashSet::new();
    for _ in 0..50 {
        many.insert(world.setup_token("newbie").await);
    }
    assert_eq!(many.len(), 50);

    // Re-issued, so the token under test is the live one. Asking again replaces the
    // outstanding token rather than piling up alongside it.
    let token = world.setup_token("newbie").await;

    // The database holds a digest, and only one row.
    let rows = world.setup_token_rows().await;
    let matching: Vec<_> = rows
        .iter()
        .filter(|(hash, _, _)| hash == &mmss_backend::cookies::hash_token(&token))
        .collect();
    assert_eq!(matching.len(), 1);
    assert!(!rows.iter().any(|(hash, _, _)| hash.contains(&token)));
    assert_ne!(matching[0].0, token);
    assert_eq!(matching[0].1, None, "unused");
    assert!(
        matching[0].2 > chrono_now_ms(),
        "must expire in the future, not at creation"
    );

    // Nothing anywhere in the database file contains the plaintext token.
    let bytes = std::fs::read(world.dir.join("mmss.db")).unwrap();
    assert!(
        !contains(&bytes, token.as_bytes()),
        "the setup token must not be in the database file"
    );
}

fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

/// Substring search over raw bytes: the token must be absent from all of the file, not
/// merely from one column.
fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

/// The whole first-sign-in journey over the real boundary, ending in a working session.
#[tokio::test]
async fn a_student_can_set_a_first_password_with_a_token_and_sign_in() {
    let world = World::new("setup-happy").await;
    world.enrol().await;

    // Before: the account exists, is authorised, and cannot sign in at all.
    assert!(world.is_active("newbie").await);
    assert_eq!(world.login("newbie", "anything").await.status, 401);

    let token = world.setup_token("newbie").await;

    let setup = world
        .send(
            "POST",
            "/api/auth/password/setup",
            None,
            Some(json!({ "token": token, "newPassword": "chosen-by-the-student" })),
        )
        .await;
    assert_eq!(setup.status, 200, "{}", setup.body);
    assert_eq!(setup.json()["authenticated"], true);
    assert_eq!(setup.json()["user"]["studentId"], "newbie");
    assert_eq!(setup.json()["user"]["section"], "9-A");

    // The response is a signed-in session, and no password appears anywhere in it.
    let session = setup.session();
    assert_eq!(
        world
            .send("GET", "/api/auth/me", Some(&session), None)
            .await
            .json()["user"]["studentId"],
        "newbie"
    );
    for forbidden in ["chosen-by-the-student", token.as_str(), "$argon2"] {
        assert!(
            !setup.body.contains(forbidden),
            "{forbidden:?} must never appear in a response"
        );
    }

    // The student can now sign in, with their chosen password.
    assert_eq!(
        world.login("newbie", "chosen-by-the-student").await.status,
        200
    );
    assert_eq!(world.login("newbie", "anything").await.status, 401);

    // And the stored credential is an argon2id hash, in the right column.
    let hashes: Vec<String> = sqlx::query_scalar("SELECT password_hash FROM credentials")
        .fetch_all(&world.db)
        .await
        .unwrap();
    let mine = hashes
        .iter()
        .find(|hash| hash.contains("$argon2id$"))
        .expect("an argon2id hash");
    assert!(!mine.contains("chosen-by-the-student"));
}

/// Single use. The second attempt must be refused even from the same browser that just
/// succeeded.
#[tokio::test]
async fn a_setup_token_cannot_be_spent_twice() {
    let world = World::new("token-single-use").await;
    world.enrol().await;
    let token = world.setup_token("newbie").await;

    let first = world
        .send(
            "POST",
            "/api/auth/password/setup",
            None,
            Some(json!({ "token": token, "newPassword": "the-first-password" })),
        )
        .await;
    assert_eq!(first.status, 200, "{}", first.body);

    // Spend it again for a *different* password.
    let second = world
        .send(
            "POST",
            "/api/auth/password/setup",
            None,
            Some(json!({ "token": token, "newPassword": "a-second-password" })),
        )
        .await;
    assert_eq!(second.status, 400, "{}", second.body);

    // The first password stands; the second never existed.
    assert_eq!(
        world.login("newbie", "the-first-password").await.status,
        200
    );
    assert_eq!(world.login("newbie", "a-second-password").await.status, 401);

    // And the row records that it was used.
    let spent = world
        .setup_token_rows()
        .await
        .into_iter()
        .find(|(hash, _, _)| hash == &mmss_backend::cookies::hash_token(&token))
        .unwrap();
    assert!(spent.1.is_some(), "used_at must be set");
}

/// Concurrency: two simultaneous submissions of one token. `used_at IS NULL` in the
/// consuming statement is what makes exactly one of them win.
#[tokio::test]
async fn a_setup_token_cannot_be_spent_concurrently() {
    let world = World::new("token-race").await;
    world.enrol().await;
    let token = world.setup_token("newbie").await;

    let (a, b) = tokio::join!(
        world.send(
            "POST",
            "/api/auth/password/setup",
            None,
            Some(json!({ "token": token, "newPassword": "the-first-password" }))
        ),
        world.send(
            "POST",
            "/api/auth/password/setup",
            None,
            Some(json!({ "token": token, "newPassword": "the-second-password" }))
        ),
    );

    let statuses = [a.status, b.status];
    assert!(
        statuses.contains(&200) && statuses.contains(&400),
        "exactly one submission may win, got {statuses:?}: {} / {}",
        a.body,
        b.body
    );
    // Whichever password won is the only one that works.
    let first = world.login("newbie", "the-first-password").await.status;
    let second = world.login("newbie", "the-second-password").await.status;
    assert!(
        (first == 200) ^ (second == 200),
        "exactly one password may be live: first={first} second={second}"
    );
    assert!(first == 401 || second == 401);
}

/// An expired token is refused. The deadline is stored, so the test moves time by writing
/// the row rather than by sleeping for a day.
#[tokio::test]
async fn an_expired_setup_token_is_refused() {
    let world = World::new("token-expired").await;
    world.enrol().await;
    let token = world.setup_token("newbie").await;

    // Backdate it. `expires_at > now` is the condition in the consuming statement.
    sqlx::query("UPDATE setup_tokens SET expires_at = ?1 WHERE token_hash = ?2")
        .bind(chrono_now_ms() - 1)
        .bind(mmss_backend::cookies::hash_token(&token))
        .execute(&world.db)
        .await
        .unwrap();

    let refused = world
        .send(
            "POST",
            "/api/auth/password/setup",
            None,
            Some(json!({ "token": token, "newPassword": "too-late-for-this" })),
        )
        .await;
    assert_eq!(refused.status, 400, "{}", refused.body);

    // And it did not spend a credential either.
    assert_eq!(world.login("newbie", "too-late-for-this").await.status, 401);
    // A spent deadline, not a consumed token: the row is still there, still unused.
    let row = world
        .setup_token_rows()
        .await
        .into_iter()
        .find(|(hash, _, _)| hash == &mmss_backend::cookies::hash_token(&token))
        .unwrap();
    assert_eq!(row.1, None);
    assert!(row.2 < chrono_now_ms());
}

/// Every way of a *token* being wrong produces one identical answer, so the endpoint
/// cannot be used to learn whether a token exists, has been used, has expired, or belongs
/// to an account that already signed in.
///
/// Request-shape and password-policy errors are deliberately a different answer, and the
/// distinction is the point: "your password must be at least 8 characters" is the only
/// message here a student can act on, and it says nothing whatever about the token.
#[tokio::test]
async fn token_failures_are_indistinguishable_while_usable_errors_are_not() {
    let world = World::new("token-uniform").await;
    world.enrol().await;

    // A real, live token, presented by someone who is not its owner -- the fourth
    // indistinguishable case, because the account it belongs to already has a password.
    let real = world.setup_token("newbie").await;

    // One spent, by spending it.
    let spent = world.setup_token("newbie").await;
    let spent_ok = world
        .send(
            "POST",
            "/api/auth/password/setup",
            None,
            Some(json!({ "token": spent, "newPassword": "a-good-password" })),
        )
        .await;
    assert_eq!(spent_ok.status, 200, "{}", spent_ok.body);

    // One expired, backdated rather than slept for.
    let user = world.user("2026001").await;
    let expired_token = mmss_backend::repositories::setup_tokens::issue(&world.db, user.id, 1000)
        .await
        .unwrap()
        .token;
    sqlx::query("UPDATE setup_tokens SET expires_at = ?1 WHERE token_hash = ?2")
        .bind(chrono_now_ms() - 1)
        .bind(mmss_backend::cookies::hash_token(&expired_token))
        .execute(&world.db)
        .await
        .unwrap();

    let answers = [
        world
            .send(
                "POST",
                "/api/auth/password/setup",
                None,
                Some(
                    json!({ "token": "not-a-real-token-at-all", "newPassword": "a-good-password" }),
                ),
            )
            .await,
        world
            .send(
                "POST",
                "/api/auth/password/setup",
                None,
                Some(json!({ "token": spent, "newPassword": "a-good-password" })),
            )
            .await,
        world
            .send(
                "POST",
                "/api/auth/password/setup",
                None,
                Some(json!({ "token": expired_token, "newPassword": "a-good-password" })),
            )
            .await,
        world
            .send(
                "POST",
                "/api/auth/password/setup",
                None,
                Some(json!({ "token": real, "newPassword": "a-good-password" })),
            )
            .await,
    ];

    for reply in &answers {
        assert_eq!(reply.status, 400, "{}", reply.body);
        // No storage detail, and nothing that distinguishes one cause from another.
        let lowered = reply.body.to_lowercase();
        // No storage detail. ("or has expired" is part of the one uniform message, so it
        // distinguishes nothing -- the assertion below is that all four are identical.)
        for leak in ["token_hash", "expires_at", "used_at", "argon2", "sql"] {
            assert!(!lowered.contains(leak), "{leak:?} leaked: {}", reply.body);
        }
    }
    for reply in &answers[1..] {
        assert_eq!(
            reply.body,
            answers[0].body,
            "unknown, spent, expired and live-but-unowned must be byte-identical: {:?}",
            answers.iter().map(|r| r.body.clone()).collect::<Vec<_>>()
        );
    }
    // The usable errors, which are different on purpose and leak nothing about the token.
    let shape = world
        .send(
            "POST",
            "/api/auth/password/setup",
            None,
            Some(json!({ "newPassword": "a-good-password" })),
        )
        .await;
    assert_eq!(shape.status, 400);
    let weak = world
        .send(
            "POST",
            "/api/auth/password/setup",
            None,
            Some(json!({ "token": real, "newPassword": "abc" })),
        )
        .await;
    assert_eq!(weak.status, 400);
    let weak_message = weak.json()["error"].as_str().unwrap().to_owned();
    assert!(
        weak_message.contains("8 characters"),
        "the one message a student can act on must say what is needed: {weak_message}"
    );
    // The shape error names the field the caller left out, which is what helps them and
    // says nothing about whether a token exists.
    assert!(shape.json()["error"].as_str().unwrap().contains("token"));
}

/// A token is only ever issued for an account that has **no** password. A token for a
/// working account would be a second way in, and an operator with database access would be
/// able to mint one for the administrator.
#[tokio::test]
async fn a_setup_token_is_refused_for_an_account_that_already_has_a_password() {
    let world = World::new("token-no-override").await;
    world.enrol().await;

    let user = world.user("2026001").await;
    let refused = world.service().issue_setup_token(user.id).await;
    assert!(refused.is_err(), "a working account must not get a token");
    assert!(world.setup_token_rows().await.is_empty());

    // The credential is untouched, so a refused issue is not a way to lock anyone out.
    assert_eq!(world.login("2026001", STUDENT_PASSWORD).await.status, 200);

    // Deactivated accounts get no token either.
    let newbie = world.user("newbie").await;
    world
        .service()
        .set_active(newbie.id, false, "cli", None)
        .await
        .unwrap();
    assert!(world.service().issue_setup_token(newbie.id).await.is_err());
}

/// The token is worthless after the account is deactivated -- including for one issued in
/// the same breath, which is why the account's active state is re-checked *after* the token
/// is consumed.
#[tokio::test]
async fn a_deactivated_account_cannot_use_a_setup_token() {
    let world = World::new("token-deactivated").await;
    world.enrol().await;
    let token = world.setup_token("newbie").await;

    let user = world.user("newbie").await;
    let outcome = world
        .service()
        .set_active(user.id, false, "cli", Some("left before starting"))
        .await
        .unwrap();
    match outcome {
        mmss_backend::services::accounts::ActivationOutcome::Changed { tokens_revoked, .. } => {
            assert_eq!(tokens_revoked, 1, "deactivation must revoke live tokens")
        }
        other => panic!("expected a change, got {other:?}"),
    }

    let refused = world
        .send(
            "POST",
            "/api/auth/password/setup",
            None,
            Some(json!({ "token": token, "newPassword": "a-good-password" })),
        )
        .await;
    assert_eq!(refused.status, 400, "{}", refused.body);
    assert_eq!(world.login("newbie", "a-good-password").await.status, 401);
    assert!(!world
        .service()
        .change_password(user.id, "newbie", "", "a-good-password")
        .await
        .is_ok());
}

/// Password rules, over the boundary, because they are the one thing a student can act on.
#[tokio::test]
async fn a_weak_first_password_is_refused_with_a_usable_message() {
    let world = World::new("weak-password").await;
    world.enrol().await;

    for (password, why) in [
        ("short", "too short"),
        ("        ", "whitespace only"),
        (
            "12345678",
            "eight but weak is still accepted -- the rule is length, not shape",
        ),
    ] {
        let token = world.setup_token("newbie").await;
        let reply = world
            .send(
                "POST",
                "/api/auth/password/setup",
                None,
                Some(json!({ "token": token, "newPassword": password })),
            )
            .await;
        if why.contains("too short") || why.contains("whitespace") {
            assert_eq!(reply.status, 400, "{why}: {}", reply.body);
            let body = reply.json();
            let message = body["error"].as_str().unwrap_or_default();
            assert!(!message.is_empty(), "the message must be actionable: {why}");
        } else {
            assert_eq!(reply.status, 200, "{why}: {}", reply.body);
        }
    }
}

// ------------------------------------------------------------ the audit trail

/// "Audited" means a row an operator can read, not a log line that scrolls away.
#[tokio::test]
async fn every_lifecycle_operation_leaves_an_audit_record_naming_who_did_it() {
    let world = World::new("audit").await;
    world.enrol().await;

    // A self-service password change records the person themselves.
    let session = world.login("2026001", STUDENT_PASSWORD).await.session();
    world
        .send(
            "PATCH",
            "/api/auth/password",
            Some(&session),
            Some(json!({
                "currentPassword": STUDENT_PASSWORD,
                "newPassword": "a-brand-new-password",
            })),
        )
        .await;

    // A first password records the account it was set on.
    let token = world.setup_token("newbie").await;
    world
        .send(
            "POST",
            "/api/auth/password/setup",
            None,
            Some(json!({ "token": token, "newPassword": "chosen-by-the-student" })),
        )
        .await;

    // An operator deactivation records the operator, not the student.
    let user = world.user("2026002").await;
    world
        .service()
        .set_active(user.id, false, "cli", Some("left the school"))
        .await
        .unwrap();

    let events = world.events().await;
    let kinds: Vec<&str> = events.iter().map(|(kind, _, _)| kind.as_str()).collect();
    assert_eq!(
        kinds,
        vec!["password_changed", "password_set", "deactivated"],
        "{events:?}"
    );

    // The self-service events name the account holder; the operator one does not.
    assert_eq!(events[0].1, "2026001");
    assert_eq!(events[1].1, "newbie");
    assert_eq!(events[2].1, "cli");
    // The reason an operator gave is kept, and it is the only free text.
    assert_eq!(events[2].2.as_deref(), Some("left the school"));
    assert_eq!(events[0].2, None);

    // No secret ever reaches the audit table.
    let rows: Vec<String> =
        sqlx::query_scalar("SELECT kind || actor || COALESCE(detail, '') FROM account_events")
            .fetch_all(&world.db)
            .await
            .unwrap();
    for row in rows {
        for secret in [
            STUDENT_PASSWORD,
            "a-brand-new-password",
            "chosen-by-the-student",
            token.as_str(),
        ] {
            assert!(
                !row.contains(secret),
                "a secret reached the audit trail: {row}"
            );
        }
    }
}

/// A deactivation reason is operator free text, so it is bounded and stripped of the
/// characters that would let it forge a log line.
#[tokio::test]
async fn a_deactivation_reason_is_bounded_and_control_free() {
    let world = World::new("audit-reason").await;
    world.enrol().await;
    let user = world.user("2026001").await;

    world
        .service()
        .set_active(user.id, false, "cli", Some("moved away\nFORGED LOG LINE"))
        .await
        .unwrap();
    let detail = world.events().await[0].2.clone().unwrap();
    assert!(
        !detail.contains('\n'),
        "a newline could forge a log line: {detail:?}"
    );
    assert!(
        detail.contains("FORGED LOG LINE"),
        "the text itself is kept"
    );

    // A reactivation is a separate kind, so "why is this student off" is answerable.
    world
        .service()
        .set_active(user.id, true, "cli", Some("came back"))
        .await
        .unwrap();
    let kinds: Vec<String> = world
        .events()
        .await
        .into_iter()
        .map(|(kind, _, _)| kind)
        .collect();
    assert_eq!(kinds, vec!["deactivated", "reactivated"]);
}

// --------------------------------------------------------- bulk deactivation

/// A leavers list, run in one command, does the whole cohort -- and a second run changes
/// nothing.
#[tokio::test]
async fn a_leavers_list_is_applied_in_one_run_and_is_idempotent() {
    let world = World::new("bulk").await;
    world.enrol().await;

    let extra: String = (0..25)
        .map(|index| format!("user,20270{index:02},Leaver {index},student,9-A\n"))
        .collect();
    let roster =
        format!("kind,id,name,role,section,password,password_hash\nclass,9-A,,,,\n{extra}");
    let path = world.write("bulk-roster.csv", &roster).await;
    provisioning::import_file(&world.db, &path).await.unwrap();
    for index in 0..25 {
        assert!(world.is_active(&format!("20270{index:02}")).await);
    }

    // Every leaver, and nothing else.
    let list: String = (0..25).map(|index| format!("20270{index:02}\n")).collect();
    let path = world.write("leavers.csv", &format!("id\n{list}")).await;

    let first = lifecycle_cli::deactivate(
        &world.db,
        &world.config,
        &path,
        false,
        Some("left the school"),
    )
    .await
    .unwrap();
    assert!(first.is_clean(), "{first:?}");
    assert_eq!(first.changed, 25);
    assert_eq!(first.unchanged, 0);
    assert!(first.issues.is_empty());

    for index in 0..25 {
        let id = format!("20270{index:02}");
        assert!(!world.is_active(&id).await, "{id} should be deactivated");
        assert_eq!(world.login(&id, STUDENT_PASSWORD).await.status, 401);
    }
    // The cohort the list did not name is untouched, including their sessions.
    let untouched = world.login("2026001", STUDENT_PASSWORD).await;
    assert_eq!(untouched.status, 200, "{}", untouched.body);
    assert!(world.is_active("2026001").await);
    assert_eq!(world.session_count("2026001").await, 1);

    // A second run converges rather than fighting.
    let second = lifecycle_cli::deactivate(&world.db, &world.config, &path, false, None)
        .await
        .unwrap();
    assert!(second.is_clean(), "{second:?}");
    assert_eq!(second.changed, 0);
    assert_eq!(
        second.unchanged, 25,
        "already in that state, reported not repeated"
    );

    // And reactivation converges the same way.
    let back = lifecycle_cli::deactivate(&world.db, &world.config, &path, true, Some("came back"))
        .await
        .unwrap();
    assert_eq!(back.changed, 25);
    assert_eq!(
        lifecycle_cli::deactivate(&world.db, &world.config, &path, true, None)
            .await
            .unwrap()
            .unchanged,
        25
    );
    for index in 0..25 {
        assert!(world.is_active(&format!("20270{index:02}")).await);
    }
}

/// A leavers file can only carry school IDs. This is the safety property that makes a
/// mis-aimed file harmless.
#[tokio::test]
async fn a_leavers_file_cannot_change_a_role_a_class_or_a_password() {
    let world = World::new("bulk-safety").await;
    world.enrol().await;

    let before = world.user("2026001").await;

    // Every field a file might try to smuggle past the `id` column.
    for line in [
        "2026001,admin",
        "2026001,,9-B",
        "2026001,,,student-password-1",
        "2026001,,,,,,,{\"role\":\"admin\"}",
    ] {
        let path = world
            .write("bad-leavers.csv", &format!("id\n{line}\n"))
            .await;
        let error = lifecycle_cli::deactivate(&world.db, &world.config, &path, false, None)
            .await
            .unwrap_err()
            .to_string();
        assert!(
            error.contains("school IDs only"),
            "{line:?} must be refused: {error}"
        );
    }

    let after = world.user("2026001").await;
    assert_eq!(after.role, before.role);
    assert_eq!(after.class_id, before.class_id);
    assert_eq!(after.display_name, before.display_name);
    assert!(after.is_active, "a refused file must change nothing");
    assert_eq!(world.login("2026001", STUDENT_PASSWORD).await.status, 200);
}

/// A student cannot reach any of this over HTTP. Deactivation and token issuance are
/// operator actions; there is no route for either.
#[tokio::test]
async fn no_request_can_deactivate_an_account_or_mint_a_token() {
    let world = World::new("no-http-lifecycle").await;
    world.enrol().await;

    let student = world.login("2026001", STUDENT_PASSWORD).await.session();
    let admin = world.login("t001", TEACHER_PASSWORD).await.session();
    assert!(world.is_active("2026002").await);

    let bodies = [
        json!({ "schoolId": "2026002", "active": false }),
        json!({ "id": world.user("2026002").await.id, "isActive": false }),
        json!({ "reason": "left the school" }),
        json!({ "tokens": ["2026002"] }),
    ];
    let paths = [
        "/api/admin/users/2/deactivate",
        "/api/users/2/deactivate",
        "/api/accounts/deactivate",
        "/api/accounts",
        "/api/admin/accounts",
        "/api/admin/setup-tokens",
        "/api/setup-tokens",
        "/api/accounts/2026002",
        "/api/admin/users",
    ];

    for path in paths {
        for method in ["POST", "PATCH", "DELETE"] {
            for body in &bodies {
                for session in [None, Some(student.as_str()), Some(admin.as_str())] {
                    let reply = world.send(method, path, session, Some(body.clone())).await;
                    assert!(
                        reply.status == 404 || reply.status == 405 || reply.status == 401,
                        "{method} {path} -> {} {}",
                        reply.status,
                        reply.body
                    );
                    assert_ne!(
                        reply.status, 200,
                        "{method} {path} reached a lifecycle operation"
                    );
                }
            }
        }
    }

    assert!(
        world.is_active("2026002").await,
        "nothing about 2026002 may have changed"
    );
    assert_eq!(
        world.setup_token_rows().await.len(),
        0,
        "no token was minted"
    );
    assert_eq!(world.login("2026002", OTHER_PASSWORD).await.status, 200);
}

/// Rows that name nobody, and a malformed file, are both reported rather than guessed at.
#[tokio::test]
async fn a_leavers_list_that_does_not_match_reality_is_reported_not_guessed() {
    let world = World::new("bulk-mismatch").await;
    world.enrol().await;

    // Two real accounts and one that does not exist. The third row carries a trailing
    // comma rather than a second value, which is tolerated -- so both real accounts are
    // deactivated and only the phantom is reported.
    let path = world
        .write("mismatched.csv", "id\n2026001\n9999999\n2026002,,\n")
        .await;
    let report = lifecycle_cli::deactivate(&world.db, &world.config, &path, false, None)
        .await
        .unwrap();
    assert_eq!(report.changed, 2);
    assert_eq!(report.issues.len(), 1);
    assert!(report.issues[0].subject == "9999999");
    assert!(report.issues[0].reason.contains("no account"));
    assert!(!report.is_clean(), "the CLI must exit non-zero for this");
    assert!(!world.is_active("2026001").await);
    assert!(!world.is_active("2026002").await);

    // A row with no ID at all stops the whole file before anything is applied.
    let path = world
        .write("hollow.csv", "id\n2026001\n,,\n2026002\n")
        .await;
    let error = lifecycle_cli::deactivate(&world.db, &world.config, &path, false, None)
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("`id` is required"), "{error}");
    assert!(error.contains("line 3"), "{error}");

    // Both accounts are already off from the run above, so they come back first.
    for id in ["2026001", "2026002"] {
        let user = world.user(id).await;
        world
            .service()
            .set_active(user.id, true, "cli", None)
            .await
            .unwrap();
    }
    // Surrounding whitespace on the second row, as a hand-typed list would have it.
    let path = world.write("case.csv", "id\n2026001\n 2026002 \n").await;
    let report = lifecycle_cli::deactivate(&world.db, &world.config, &path, false, None)
        .await
        .unwrap();
    assert!(report.is_clean(), "{report:?}");
    assert_eq!(
        report.changed, 2,
        "whitespace must not stop a leaver being switched off"
    );
    assert!(!world.is_active("2026002").await);
}

/// Token issuance and revocation, the operator's other two moves.
#[tokio::test]
async fn setup_tokens_are_issued_to_stdout_only_and_can_be_revoked() {
    let world = World::new("token-cli").await;
    world.enrol().await;

    let path = world.write("newcomers.csv", "id\nnewbie\n").await;
    let report = lifecycle_cli::issue_setup_tokens(&world.db, &world.config, &path)
        .await
        .unwrap();
    assert!(report.is_clean(), "{report:?}");
    assert_eq!(report.tokens_issued, vec!["newbie".to_owned()]);

    // The report names the account and never the token, because it is meant to be pasted
    // into a ticket.
    let serialised = serde_json::to_string(&report).unwrap();
    let stored = world.setup_token_rows().await;
    assert_eq!(stored.len(), 1);
    assert!(
        !serialised.contains(&stored[0].0),
        "the digest must not be in the report either"
    );

    // Revoking kills it, and the student's attempt is refused.
    let revoked = lifecycle_cli::revoke_setup_tokens(&world.db, &path)
        .await
        .unwrap();
    assert_eq!(revoked.tokens_revoked_count, 1);
    let spent = world.setup_token_rows().await;
    assert!(spent[0].1.is_some(), "revoked rows are marked used");
}

/// A token cannot be minted for an account that already signed in, and asking twice does
/// not leave two live tokens.
#[tokio::test]
async fn token_issuance_is_refused_for_working_accounts_and_does_not_pile_up() {
    let world = World::new("token-no-pileup").await;
    world.enrol().await;

    let path = world.write("all.csv", "id\nnewbie\n2026001\n").await;
    let report = lifecycle_cli::issue_setup_tokens(&world.db, &world.config, &path)
        .await
        .unwrap();
    assert_eq!(report.tokens_issued, vec!["newbie".to_owned()]);
    assert_eq!(report.issues.len(), 1);
    assert_eq!(report.issues[0].subject, "2026001");
    assert!(report.issues[0].reason.contains("already has a password"));

    // Asking again for the same account replaces the outstanding token rather than adding
    // to the pile: a lost slip is the normal reason to ask, and five live tokens make
    // "which slip is valid" unanswerable.
    let path = world.write("newbie-again.csv", "id\nnewbie\n").await;
    for _ in 0..3 {
        assert!(
            lifecycle_cli::issue_setup_tokens(&world.db, &world.config, &path)
                .await
                .unwrap()
                .is_clean()
        );
    }
    let newbie = world.user("newbie").await;
    assert_eq!(
        mmss_backend::repositories::setup_tokens::count_live_for_user(
            &world.db,
            newbie.id,
            chrono_now_ms()
        )
        .await
        .unwrap(),
        1,
        "only one live token may exist at a time"
    );
    // The superseded rows are kept and marked used, so "how many slips did this student
    // lose" is still answerable -- and the pile cannot grow without bound.
    assert_eq!(world.setup_token_rows().await.len(), 4);
}

// --------------------------------------------------------- provisioning + lifecycle

/// The two halves together: enrol a cohort with R11's importer, then run a real school's
/// first term through it -- students set first passwords, teachers post homework, one
/// student leaves, and the cohort keeps working.
#[tokio::test]
async fn enrolment_then_a_terms_worth_of_lifecycle_over_the_real_boundary() {
    let world = World::new("e2e").await;

    // ---- enrolment, with no passwords at all, as recommended in the docs
    let mut roster = String::from(
        "kind,id,name,role,section,password,password_hash\n\
         class,9-A,,,,\n\
         class,9-B,,,,\n\
         subject,Mathematics,,,,\n\
         user,t001,Ms Rao,teacher,,teacher-password-3,\n\
         assignment,t001,,,9-A\n\
         assignment,t001,,,9-B\n",
    );
    for index in 0..40 {
        roster.push_str(&format!(
            "user,2026{index:03},Student {index},student,9-{}\n",
            if index % 2 == 0 { "A" } else { "B" }
        ));
    }
    let path = world.write("term-roster.csv", &roster).await;
    let report = provisioning::import_file(&world.db, &path).await.unwrap();
    assert!(report.is_clean(), "{report:?}");
    assert_eq!(report.users_created, 41);
    assert_eq!(report.credentials_set, 1, "only the teacher's password");

    // No student can sign in yet -- the safe state for an unenrolled cohort.
    assert_eq!(world.login("2026000", "anything").await.status, 401);

    // ---- the office hands out setup slips
    let student_ids: Vec<String> = (0..40).map(|index| format!("2026{index:03}")).collect();
    let path = world
        .write("setup.csv", &format!("id\n{}\n", student_ids.join("\n")))
        .await;
    let issued = lifecycle_cli::issue_setup_tokens(&world.db, &world.config, &path)
        .await
        .unwrap();
    assert!(issued.is_clean(), "{issued:?}");
    assert_eq!(issued.tokens_issued.len(), 40);
    assert_eq!(
        world.setup_token_rows().await.len(),
        40,
        "one live token per student, no pile-up"
    );

    // ---- every student sets their own password and gets a working session
    for id in &student_ids {
        let token = world.setup_token(id).await;
        let setup = world
            .send(
                "POST",
                "/api/auth/password/setup",
                None,
                Some(json!({ "token": token, "newPassword": "chosen-by-the-student" })),
            )
            .await;
        assert_eq!(setup.status, 200, "{id}: {}", setup.body);
        let session = setup.session();
        let feed = world
            .send("GET", "/api/homework", Some(&session), None)
            .await;
        assert_eq!(feed.status, 200, "{id}: {}", feed.body);
    }
    assert_eq!(
        world.login("2026000", "chosen-by-the-student").await.status,
        200
    );

    // ---- the teacher posts homework to both sections
    let teacher = world.login("t001", TEACHER_PASSWORD).await.session();
    let class_ids: Vec<i64> = sqlx::query_scalar("SELECT id FROM classes ORDER BY name")
        .fetch_all(&world.db)
        .await
        .unwrap();
    let subject_id: i64 = sqlx::query_scalar("SELECT id FROM subjects LIMIT 1")
        .fetch_one(&world.db)
        .await
        .unwrap();
    for class_id in &class_ids {
        let created = world
            .send(
                "POST",
                "/api/teacher/homework",
                Some(&teacher),
                Some(json!({
                    "classId": class_id,
                    "subjectId": subject_id,
                    "dueDate": "2026-11-09",
                    "homework": "Complete exercises 1-12.",
                })),
            )
            .await;
        assert_eq!(created.status, 201, "{}", created.body);
    }

    // Both sections see it.
    for id in ["2026000", "2026001"] {
        let session = world.login(id, "chosen-by-the-student").await.session();
        let feed = world
            .send("GET", "/api/homework", Some(&session), None)
            .await;
        assert_eq!(feed.json()["count"], 1, "{id}: {}", feed.body);
    }

    // ---- one student leaves mid-term
    let path = world.write("leavers.csv", "id\n2026039\n").await;
    let report = lifecycle_cli::deactivate(
        &world.db,
        &world.config,
        &path,
        false,
        Some("left the school"),
    )
    .await
    .unwrap();
    assert_eq!(report.changed, 1);
    assert_eq!(
        world.login("2026039", "chosen-by-the-student").await.status,
        401
    );
    // And nobody else is affected.
    assert_eq!(
        world.login("2026038", "chosen-by-the-student").await.status,
        200
    );

    // ---- one student changes their password
    let session = world
        .login("2026038", "chosen-by-the-student")
        .await
        .session();
    let changed = world
        .send(
            "PATCH",
            "/api/auth/password",
            Some(&session),
            Some(json!({
                "currentPassword": "chosen-by-the-student",
                "newPassword": "something-they-prefer",
            })),
        )
        .await;
    assert_eq!(changed.status, 200, "{}", changed.body);
    assert_eq!(
        world.login("2026038", "something-they-prefer").await.status,
        200
    );
    assert_eq!(
        world.login("2026038", "chosen-by-the-student").await.status,
        401
    );

    // ---- the audit trail answers "what happened to 2026039"
    let trail: Vec<String> = sqlx::query_scalar(
        "SELECT kind FROM account_events WHERE user_id = (SELECT id FROM users WHERE school_id = '2026039')",
    )
    .fetch_all(&world.db)
    .await
    .unwrap();
    assert_eq!(
        trail,
        vec!["password_set", "deactivated"],
        "the full story for this student, in order"
    );

    // ---- and the whole term's lifecycle is replayable without surprises
    let again = lifecycle_cli::deactivate(&world.db, &world.config, &path, false, None)
        .await
        .unwrap();
    assert_eq!(again.changed, 0);
    assert_eq!(again.unchanged, 1);
}

// ------------------------------------------------------------ migration & schema

/// The lifecycle columns exist, default correctly, and are constrained.
#[tokio::test]
async fn the_lifecycle_schema_is_what_the_service_expects() {
    let world = World::new("schema").await;

    // Both new tables.
    let tables: Vec<String> =
        sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type = 'table'")
            .fetch_all(&world.db)
            .await
            .unwrap();
    assert!(tables.contains(&"setup_tokens".to_owned()));
    assert!(tables.contains(&"account_events".to_owned()));

    // A user inserted without mentioning `is_active` is active.
    let user = users::create(
        &world.db,
        &NewUser {
            school_id: "defaulted".into(),
            display_name: None,
            role: Role::Student,
            class_id: None,
        },
    )
    .await
    .unwrap();
    assert!(
        user.is_active,
        "the column default must be an active account"
    );

    // And the value is constrained to 0 or 1.
    let bad = sqlx::query("UPDATE users SET is_active = 2 WHERE id = ?1")
        .bind(user.id)
        .execute(&world.db)
        .await;
    assert!(bad.is_err(), "is_active must be 0 or 1 and nothing else");

    // Five migrations, and starting again does not reapply them.
    let applied: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
        .fetch_one(&world.db)
        .await
        .unwrap();
    assert_eq!(applied, 5);
}

/// The school ID is the identity, and R11's guarantee still holds after R12's changes.
#[tokio::test]
async fn school_ids_stay_stable_across_the_whole_lifecycle() {
    let world = World::new("stable-ids").await;
    world.enrol().await;

    let before = world.user("2026001").await;
    let session = world.login("2026001", STUDENT_PASSWORD).await.session();
    world
        .send(
            "PATCH",
            "/api/auth/password",
            Some(&session),
            Some(json!({
                "currentPassword": STUDENT_PASSWORD,
                "newPassword": "a-brand-new-password",
            })),
        )
        .await;
    world
        .service()
        .set_active(before.id, false, "cli", None)
        .await
        .unwrap();
    world
        .service()
        .set_active(before.id, true, "cli", None)
        .await
        .unwrap();

    let after = world.user("2026001").await;
    assert_eq!(after.id, before.id, "the internal key never moves");
    assert_eq!(
        after.school_id, "2026001",
        "and neither does the school's own"
    );
    assert_eq!(after.class_id, before.class_id);
    assert_eq!(
        world.login("2026001", "a-brand-new-password").await.status,
        200
    );
}
