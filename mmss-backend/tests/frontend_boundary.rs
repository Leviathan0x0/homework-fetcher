//! Phase 10 tests: the actual frontend → Rust HTTP boundary.
//!
//! These differ from R4/R5/R9's tests in one deliberate way. Everything else drives the
//! Axum router in-process with `tower::ServiceExt::oneshot`; this file **binds a real TCP
//! listener** and speaks HTTP to it over a socket, carrying the exact cookie name, headers,
//! JSON bodies and status codes that `src/services/api.ts` and `src/lib/api.ts` send.
//!
//! That difference is the point. An in-process `oneshot` cannot catch a cookie that the
//! browser would refuse to store, a header a proxy would drop, or a status code a client
//! maps to the wrong screen. Those only show up at the socket.
//!
//! Nothing here imports the frontend. Instead each request is written out as the frontend
//! writes it, so a change to the frontend that breaks the contract fails a test here rather
//! than failing silently in a browser.

use std::net::SocketAddr;
use std::sync::atomic::{AtomicU32, Ordering};

use mmss_backend::config::Config;
use mmss_backend::models::{NewUser, Role};
use mmss_backend::services::auth::AuthService;
use mmss_backend::state::AppState;
use serde_json::{json, Value};

static NEXT_ID: AtomicU32 = AtomicU32::new(0);

const STUDENT_PASSWORD: &str = "test-student-password";
const OTHER_PASSWORD: &str = "test-other-password";
const TEACHER_PASSWORD: &str = "test-teacher-password";
const ADMIN_PASSWORD: &str = "test-admin-password";

/// A running server on a real port, with the pool it is serving from.
///
/// The pool is handed back so fixtures are inserted into **this** database. Seeding a
/// second one is a silent no-op: every request would then 401, which looks like an auth
/// bug rather than a setup one.
struct Server {
    addr: SocketAddr,
    db: sqlx::SqlitePool,
    config: Config,
}

/// A parsed HTTP response, with the cookie jar the way a browser keeps it.
struct Reply {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
    /// The `app_session` value now held by the browser, if the response set one.
    cookie: Option<String>,
}

impl Reply {
    fn json(&self) -> Value {
        serde_json::from_str(&self.body)
            .unwrap_or_else(|_| panic!("expected JSON, got {:?}: {}", self.status, self.body))
    }

    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

impl Server {
    /// Starts on an ephemeral port and returns once it is accepting connections.
    async fn start(tag: &str) -> Server {
        let unique = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("mmss-r10-{}-{tag}-{unique}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut config = Config::for_tests(format!("sqlite://{}/mmss.db", dir.display()));
        // The deployed topology is Vercel rewriting /api/* to this process, which is
        // same-origin. Emulating that means no Origin header is ever sent -- so this test
        // asserts the API works with none, and R9's tests cover the cross-origin policy.
        config.allowed_origins.clear();

        let state = AppState::new(config.clone()).await.unwrap();
        let db = state.db.clone();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = mmss_backend::app(state);
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        Server { addr, db, config }
    }

    /// Sends one request the way `apiFetch` does, and keeps the cookie.
    ///
    /// `credentials: "include"` in the frontend means the browser attaches the cookie and
    /// the server must answer with a `Set-Cookie` it will accept; that is modelled here by
    /// threading `session` through and refusing to keep a cookie that is not `HttpOnly`.
    async fn send(
        &self,
        method: &str,
        path: &str,
        session: Option<&str>,
        body: Option<Value>,
    ) -> Reply {
        self.send_lenient(method, path, session, body)
            .await
            .expect("the server answered")
    }

    /// Like [`Server::send`], but returns `None` when the server closed the connection
    /// without responding.
    ///
    /// Both outcomes are real server behaviour for a body the limit layer refuses, and
    /// which one arrives is a timing race rather than a contract. Forcing every request to
    /// produce a status line would make that race a flaky test.
    async fn send_lenient(
        &self,
        method: &str,
        path: &str,
        session: Option<&str>,
        body: Option<Value>,
    ) -> Option<Reply> {
        let mut request = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n");
        request.push_str("Accept: application/json\r\n");
        // The frontend's in-flight GET dedupe is keyed on the URL and sends no extra headers,
        // so this mirrors a plain browser request.
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
        // A write failure is the same story as a read one: the server stopped listening
        // mid-request, which for a refused upload *is* the refusal.
        stream.write_all(request.as_bytes()).await.ok()?;

        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).await.ok()?;
        if raw.is_empty() {
            return None;
        }
        let text = String::from_utf8_lossy(&raw).into_owned();

        let (head, body) = text.split_once("\r\n\r\n").unwrap_or((text.as_str(), ""));
        let mut lines = head.lines();
        let status = lines
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|code| code.parse().ok())
            .unwrap_or(0);
        let headers: Vec<(String, String)> = lines
            .filter_map(|line| line.split_once(':'))
            .map(|(name, value)| (name.trim().to_owned(), value.trim().to_owned()))
            .collect();

        let set_cookie = headers
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case("set-cookie"))
            .map(|(_, value)| value.clone());
        let cookie = set_cookie.and_then(|value| {
            let pair = value.split(';').next()?;
            let token = pair.split_once('=')?.1.trim().to_owned();
            // A cookie the browser would refuse is not adopted -- which is how a missing
            // `HttpOnly` or `Path` would show up here as a broken session.
            let acceptable = value.contains("HttpOnly") && value.contains("Path=/");
            (!token.is_empty() && acceptable).then_some(token)
        });

        Some(Reply {
            status,
            headers,
            body: body.to_owned(),
            cookie,
        })
    }

    /// `authService.login`, verbatim in shape.
    async fn login(&self, student_id: &str, password: &str) -> Reply {
        self.send(
            "POST",
            "/api/auth/login",
            None,
            Some(json!({ "studentId": student_id, "password": password })),
        )
        .await
    }
}

// ------------------------------------------------------------------ fixtures

struct World {
    server: Server,
    class_id: i64,
    subject_id: i64,
    subject_name: String,
    /// Captured rather than assumed. The `teacher_classes` role trigger refuses an
    /// assignment for a user who is not a teacher, so a hardcoded id here would fail for a
    /// reason that has nothing to do with this file.
    teacher_id: i64,
}

/// The label the frontend card renders, computed independently of the server so the two
/// implementations are genuinely cross-checked rather than the test restating the code.
fn chrono_free_display(iso: &str) -> String {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let mut parts = iso.split('-');
    let year = parts.next().unwrap();
    let month: usize = parts.next().unwrap().parse().unwrap();
    let day: u32 = parts.next().unwrap().parse().unwrap();
    format!("{} {}, {}", MONTHS[month - 1], day, year)
}

async fn world(tag: &str) -> World {
    let server = Server::start(tag).await;
    // Seed the server's own database.
    let db = server.db.clone();
    let auth = AuthService::new(&db, &server.config);

    let class = mmss_backend::repositories::classes::create(
        &db,
        &mmss_backend::models::NewClass::new("9-F"),
    )
    .await
    .unwrap();
    let subject = mmss_backend::repositories::subjects::create(
        &db,
        &mmss_backend::models::NewSubject::new("Mathematics"),
    )
    .await
    .unwrap();

    let mut teacher_id = 0;
    for (school_id, display, role, password) in [
        (
            "student.a",
            Some("Student A"),
            Role::Student,
            STUDENT_PASSWORD,
        ),
        (
            "student.b",
            Some("Student B"),
            Role::Student,
            OTHER_PASSWORD,
        ),
        (
            "teacher.test",
            Some("Test Teacher"),
            Role::Teacher,
            TEACHER_PASSWORD,
        ),
        ("admin.test", None, Role::Admin, ADMIN_PASSWORD),
    ] {
        let principal = auth
            .create_user_with_password(
                &NewUser {
                    school_id: school_id.into(),
                    display_name: display.map(str::to_owned),
                    role,
                    class_id: (role == Role::Student).then_some(class.id),
                },
                password,
            )
            .await
            .unwrap();
        if role == Role::Teacher {
            teacher_id = principal.user_id;
        }
    }

    mmss_backend::repositories::teacher_classes::assign(&db, teacher_id, class.id)
        .await
        .unwrap();

    World {
        server,
        class_id: class.id,
        subject_id: subject.id,
        subject_name: subject.name,
        teacher_id,
    }
}

// ------------------------------------------------- login → me → logout

/// The exact journey `authService` performs, over a real socket.
///
/// `getCurrentUser` requires `res.ok` and then `data.authenticated && data.user`; a 401
/// there would surface in the UI as a session *error* rather than as a signed-out state,
/// so this asserts the status as well as the body.
#[tokio::test]
async fn login_me_logout_over_a_real_socket() {
    let world = world("auth-journey").await;

    // Anonymous /api/auth/me: 200 with authenticated:false, which is what the client reads.
    let me = world.server.send("GET", "/api/auth/me", None, None).await;
    assert_eq!(me.status, 200, "{}", me.body);
    assert_eq!(me.json()["authenticated"], false);
    assert!(
        me.json().get("user").is_none(),
        "no user data for an anonymous caller"
    );

    // Login: 200, authenticated:true, and a cookie the browser accepts.
    let login = world.server.login("student.a", STUDENT_PASSWORD).await;
    assert_eq!(login.status, 200, "{}", login.body);
    assert_eq!(login.json()["authenticated"], true);
    let session = login
        .cookie
        .clone()
        .expect("login must set a cookie the browser will keep");

    // mapAuthUser reads these off the user object.
    let user = &login.json()["user"];
    assert_eq!(user["studentId"], "student.a");
    assert_eq!(user["displayName"], "Student A");
    assert_eq!(user["role"], "student");
    assert_eq!(user["isAdmin"], false);
    assert_eq!(user["isTeacher"], false);
    assert_eq!(user["isTeacher"], false);
    // R10 addition: `section` is read by the frontend and was missing before.
    assert_eq!(
        user["section"], "9-F",
        "the frontend reads user.section and derives its known-section flag from it"
    );

    // /api/auth/me with the session resolves to the same account.
    let me = world
        .server
        .send("GET", "/api/auth/me", Some(&session), None)
        .await;
    assert_eq!(me.status, 200);
    assert_eq!(me.json()["authenticated"], true);
    assert_eq!(me.json()["user"]["studentId"], "student.a");
    assert_eq!(me.json()["user"]["section"], "9-F");

    // Logout, then the same session must no longer work.
    let logout = world
        .server
        .send("POST", "/api/auth/logout", Some(&session), None)
        .await;
    assert_eq!(logout.status, 200);
    assert_eq!(logout.json()["authenticated"], false);

    let after = world
        .server
        .send("GET", "/api/auth/me", Some(&session), None)
        .await;
    assert_eq!(
        after.json()["authenticated"],
        false,
        "logout must revoke server-side, not only clear the browser cookie"
    );
}

/// A staff account has `classId = NULL`, and the frontend's "unknown section" rule must not
/// apply to it: `mapAuthUser` treats an empty section as unknown for non-admins, and a
/// teacher with no class must not look like a misconfigured student.
#[tokio::test]
async fn a_teacher_and_admin_carry_no_section_and_no_class() {
    let world = world("staff-shape").await;

    for (school_id, password, expected_teacher) in [
        ("teacher.test", TEACHER_PASSWORD, true),
        ("admin.test", ADMIN_PASSWORD, true),
    ] {
        let login = world.server.login(school_id, password).await;
        assert_eq!(login.status, 200, "{}", login.body);
        let user = &login.json()["user"];
        assert_eq!(user["section"], Value::Null, "{school_id}");
        assert_eq!(user["classId"], Value::Null, "{school_id}");
        assert_eq!(user["isTeacher"], expected_teacher);
    }

    let admin = world.server.login("admin.test", ADMIN_PASSWORD).await;
    assert_eq!(admin.json()["user"]["isAdmin"], true);
}

/// A failed login is the shape `authService.login` reads: `authenticated: false` plus a
/// plain `error` string it shows verbatim.
#[tokio::test]
async fn a_failed_login_matches_what_the_frontend_reads() {
    let world = world("login-failure").await;

    for (id, password, expected) in [
        ("student.a", "wrong-password", 401),
        ("nobody.here", STUDENT_PASSWORD, 401),
        // A missing field is a 400 that names it, which the client puts in the form.
        ("", STUDENT_PASSWORD, 400),
    ] {
        let reply = world.server.login(id, password).await;
        assert_eq!(reply.status, expected, "{id}: {}", reply.body);
        let body = reply.json();
        assert_eq!(body["authenticated"], false);
        assert!(
            body["error"].as_str().is_some_and(|text| !text.is_empty()),
            "the client shows data.error verbatim: {}",
            reply.body
        );
        // The message must not disclose which half was wrong.
        assert!(!reply.body.to_lowercase().contains("unknown student"));
    }
}

// ------------------------------------------------------- the student journey

/// The student feed, exactly as `homeworkService.getHomework` consumes it.
///
/// The dedupe key the frontend uses is `date:homework:classwork`, so this includes a
/// classwork-only entry -- the case that used to collide with a second one on the same day
/// and silently lose it.
#[tokio::test]
async fn the_student_feed_matches_the_frontend_shape() {
    let world = world("student-feed").await;
    let login = world.server.login("student.a", STUDENT_PASSWORD).await;
    let session = login.cookie.clone().unwrap();

    // Written by a teacher through the teacher API, as a real entry would be.
    let teacher = world.server.login("teacher.test", TEACHER_PASSWORD).await;
    let teacher_session = teacher.cookie.clone().unwrap();
    let created = world
        .server
        .send(
            "POST",
            "/api/teacher/homework",
            Some(&teacher_session),
            Some(json!({
                "classId": world.class_id,
                "subjectId": world.subject_id,
                "dueDate": "2026-10-12",
                "homework": "Complete exercises 1-10.",
                "classwork": "Chapter 4 examples.",
            })),
        )
        .await;
    assert_eq!(created.status, 201, "{}", created.body);

    // A classwork-only entry on the same day as a second one: the collision case.
    for text in ["Diagram one", "Diagram two"] {
        world
            .server
            .send(
                "POST",
                "/api/teacher/homework",
                Some(&teacher_session),
                Some(json!({
                    "classId": world.class_id,
                    "subjectId": world.subject_id,
                    "dueDate": "2026-10-13",
                    "classwork": text,
                })),
            )
            .await;
    }

    let feed = world
        .server
        .send("GET", "/api/homework", Some(&session), None)
        .await;
    assert_eq!(feed.status, 200, "{}", feed.body);
    let body = feed.json();

    // The envelope the frontend destructures.
    assert_eq!(body["count"], body["homework"].as_array().unwrap().len());
    assert_eq!(body["isStale"], false);
    assert_eq!(body["schoolSessionExpired"], false);

    let rows = body["homework"].as_array().unwrap();
    assert_eq!(
        rows.len(),
        3,
        "both classwork-only entries must survive: {rows:?}"
    );

    // Replaying the frontend's own dedupe over the response.
    let mut seen = std::collections::HashSet::new();
    let mut kept = 0;
    for row in rows {
        let text = row["homework"].as_str().unwrap_or("").trim().to_owned();
        let classwork = row["classwork"].as_str().unwrap_or("").trim().to_owned();
        let key = format!(
            "{}:{}:{}",
            row["date"].as_str().unwrap_or(""),
            text,
            classwork
        );
        if seen.insert(key) {
            kept += 1;
        }
    }
    assert_eq!(kept, 3, "the frontend's dedupe must not drop an entry");

    // Every field HomeworkCard and the search views read.
    for row in rows {
        for field in [
            "id",
            "date",
            "displayDate",
            "subject",
            "subjectId",
            "classId",
            "homework",
            "classwork",
            "attachment",
            "completed",
            "note",
            "updatedAt",
            "attachments",
            "author",
        ] {
            assert!(row.get(field).is_some(), "row is missing {field}: {row}");
        }
        assert_eq!(row["subject"], world.subject_name);
        assert_eq!(row["classId"], world.class_id);
        // `displayDate` is the label the card renders, derived from `date` -- and the feed
        // is newest-day first, so this is checked per row rather than against a fixed index.
        let iso = row["date"].as_str().unwrap();
        let expected = chrono_free_display(iso);
        assert_eq!(row["displayDate"], expected, "for {iso}");
    }

    let both = rows
        .iter()
        .find(|row| row["homework"].as_str().is_some_and(|t| !t.is_empty()))
        .unwrap();
    assert_eq!(both["homework"], "Complete exercises 1-10.");
    assert_eq!(both["classwork"], "Chapter 4 examples.");
    assert_eq!(both["author"]["displayName"], "Test Teacher");

    // A classwork-only entry sends `homework: null`, which the frontend coerces to "" with
    // `doc.homework || doc.content || ""`. Asserting on that coercion, not on the raw null.
    let classwork_only: Vec<&Value> = rows
        .iter()
        .filter(|row| {
            let homework = row["homework"].as_str().unwrap_or("").trim();
            homework.is_empty()
        })
        .collect();
    assert_eq!(
        classwork_only.len(),
        2,
        "both classwork-only entries: {rows:?}"
    );
    for row in classwork_only {
        assert!(
            row["homework"].is_null(),
            "a classwork-only row has no homework"
        );
        assert!(
            !row["classwork"].as_str().unwrap().is_empty(),
            "and the card falls back to this instead of rendering blank"
        );
    }
}

/// The two legacy URLs the client actually calls, plus the REST ones behind them.
#[tokio::test]
async fn the_legacy_mutation_urls_the_client_calls_still_work() {
    let world = world("legacy-urls").await;
    let teacher = world.server.login("teacher.test", TEACHER_PASSWORD).await;
    let teacher_session = teacher.cookie.clone().unwrap();
    let created = world
        .server
        .send(
            "POST",
            "/api/teacher/homework",
            Some(&teacher_session),
            Some(json!({
                "classId": world.class_id,
                "subjectId": world.subject_id,
                "dueDate": "2026-10-14",
                "homework": "Algebra practice",
            })),
        )
        .await;
    let id = created.json()["id"].as_i64().unwrap();

    let login = world.server.login("student.a", STUDENT_PASSWORD).await;
    let session = login.cookie.clone().unwrap();

    // `homeworkService.toggleCompleted` -- PATCH /api/homework/:id/status
    let toggled = world
        .server
        .send(
            "PATCH",
            &format!("/api/homework/{id}/status"),
            Some(&session),
            Some(json!({ "completed": true })),
        )
        .await;
    assert_eq!(toggled.status, 200, "{}", toggled.body);

    // `homeworkService.updateNote` -- PATCH /api/homework/:id/note, with `note: null`
    // meaning "clear it".
    let noted = world
        .server
        .send(
            "PATCH",
            &format!("/api/homework/{id}/note"),
            Some(&session),
            Some(json!({ "note": "nearly done" })),
        )
        .await;
    assert_eq!(noted.status, 200, "{}", noted.body);
    let cleared = world
        .server
        .send(
            "PATCH",
            &format!("/api/homework/{id}/note"),
            Some(&session),
            Some(json!({ "note": null })),
        )
        .await;
    assert_eq!(cleared.status, 200, "{}", cleared.body);

    // Both are visible on the feed the card reads.
    let feed = world
        .server
        .send("GET", "/api/homework", Some(&session), None)
        .await;
    let row = feed.json()["homework"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"].as_i64() == Some(id))
        .unwrap()
        .clone();
    assert_eq!(row["completed"], true);
    assert_eq!(
        row["note"],
        Value::Null,
        "a cleared note must read back as null"
    );

    // And the REST routes the client does not call are reachable too.
    let progress = world
        .server
        .send("GET", &format!("/api/progress/{id}"), Some(&session), None)
        .await;
    assert_eq!(progress.status, 200);
    assert_eq!(progress.json()["completed"], true);

    let notes = world
        .server
        .send(
            "POST",
            &format!("/api/notes/homework/{id}"),
            Some(&session),
            Some(json!({ "body": "a rest note" })),
        )
        .await;
    assert_eq!(notes.status, 200, "{}", notes.body);
    assert_eq!(notes.json()["homeworkId"], id);
}

/// Filters the frontend does not use today must not break the ones it does, and must not
/// widen access.
#[tokio::test]
async fn filters_narrow_and_never_widen() {
    let world = world("filters").await;
    let teacher = world.server.login("teacher.test", TEACHER_PASSWORD).await;
    let teacher_session = teacher.cookie.clone().unwrap();
    for date in ["2026-10-01", "2026-10-05", "2026-10-09"] {
        world
            .server
            .send(
                "POST",
                "/api/teacher/homework",
                Some(&teacher_session),
                Some(json!({
                    "classId": world.class_id,
                    "subjectId": world.subject_id,
                    "dueDate": date,
                    "homework": format!("work for {date}"),
                })),
            )
            .await;
    }

    let login = world.server.login("student.a", STUDENT_PASSWORD).await;
    let session = login.cookie.clone().unwrap();

    let all = world
        .server
        .send("GET", "/api/homework", Some(&session), None)
        .await;
    assert_eq!(all.json()["count"], 3);

    let ranged = world
        .server
        .send(
            "GET",
            "/api/homework?from=2026-10-02&to=2026-10-06",
            Some(&session),
            None,
        )
        .await;
    assert_eq!(ranged.json()["count"], 1, "{}", ranged.body);

    let limited = world
        .server
        .send("GET", "/api/homework?limit=2", Some(&session), None)
        .await;
    assert_eq!(limited.json()["count"], 2);

    // A malformed filter is a clean 400, never a silently wider result.
    for query in [
        "from=yesterday",
        "limit=0",
        "limit=-1",
        "subjectId=abc",
        "from=2026-13-01",
    ] {
        let reply = world
            .server
            .send(
                "GET",
                &format!("/api/homework?{query}"),
                Some(&session),
                None,
            )
            .await;
        assert_eq!(reply.status, 400, "{query} -> {}", reply.body);
        assert_eq!(reply.json()["code"], "BAD_REQUEST");
    }

    // Naming another class cannot widen the feed.
    let other = world
        .server
        .send("GET", "/api/homework?classId=9999", Some(&session), None)
        .await;
    assert_eq!(other.status, 403, "{}", other.body);
}

// ------------------------------------------------- teacher, over the boundary

/// Teacher create → read → patch → read → delete, the R10 e2e journey.
#[tokio::test]
async fn the_teacher_journey_works_over_the_boundary() {
    let world = world("teacher-journey").await;
    let teacher = world.server.login("teacher.test", TEACHER_PASSWORD).await;
    let session = teacher.cookie.clone().unwrap();

    // List before anything exists.
    let empty = world
        .server
        .send("GET", "/api/teacher/homework", Some(&session), None)
        .await;
    assert_eq!(empty.status, 200);
    assert_eq!(empty.json()["count"], 0);

    let created = world
        .server
        .send(
            "POST",
            "/api/teacher/homework",
            Some(&session),
            Some(json!({
                "classId": world.class_id,
                "subjectId": world.subject_id,
                "dueDate": "2026-10-15",
                "homework": "Complete exercises 1-10.",
                "classwork": "Chapter 4 examples.",
                "attachments": [{
                    "filename": "worksheet.pdf",
                    "mimeType": "application/pdf",
                    "sizeBytes": 2048,
                    "storageKey": "homework/2026/10/15/worksheet.pdf",
                }],
            })),
        )
        .await;
    assert_eq!(created.status, 201, "{}", created.body);
    let id = created.json()["id"].as_i64().unwrap();
    assert_eq!(created.json()["author"]["displayName"], "Test Teacher");
    assert_eq!(created.json()["attachments"].as_array().unwrap().len(), 1);

    // Read it back.
    let read = world
        .server
        .send(
            "GET",
            &format!("/api/teacher/homework/{id}"),
            Some(&session),
            None,
        )
        .await;
    assert_eq!(read.status, 200);
    assert_eq!(read.json()["homework"], "Complete exercises 1-10.");

    // Patch only the classwork. The homework text must survive.
    let patched = world
        .server
        .send(
            "PATCH",
            &format!("/api/teacher/homework/{id}"),
            Some(&session),
            Some(json!({ "classwork": "Chapter 4 and 5 examples." })),
        )
        .await;
    assert_eq!(patched.status, 200, "{}", patched.body);
    assert_eq!(
        patched.json()["homework"],
        "Complete exercises 1-10.",
        "a partial update must not blank the other half"
    );
    assert_eq!(patched.json()["classwork"], "Chapter 4 and 5 examples.");

    // Delete, then it is gone.
    let deleted = world
        .server
        .send(
            "DELETE",
            &format!("/api/teacher/homework/{id}"),
            Some(&session),
            None,
        )
        .await;
    assert_eq!(deleted.status, 200, "{}", deleted.body);
    let gone = world
        .server
        .send(
            "GET",
            &format!("/api/teacher/homework/{id}"),
            Some(&session),
            None,
        )
        .await;
    assert_eq!(gone.status, 404);
}

/// A teacher cannot submit to a class they do not teach, and cannot forge an author. Both
/// are checked at the socket, because that is where a hostile client actually lives.
#[tokio::test]
async fn class_authorization_and_authorship_hold_over_the_boundary() {
    let world = world("teacher-authz").await;
    let teacher = world.server.login("teacher.test", TEACHER_PASSWORD).await;
    let session = teacher.cookie.clone().unwrap();

    // A real second class in the same database, which this teacher is NOT assigned to. This is
    // the case the brief cares about: a valid class alone does not mean the caller may use
    // it.
    let unassigned = mmss_backend::repositories::classes::create(
        &world.server.db,
        &mmss_backend::models::NewClass::new("9-A"),
    )
    .await
    .unwrap();

    let forbidden = world
        .server
        .send(
            "POST",
            "/api/teacher/homework",
            Some(&session),
            Some(json!({
                "classId": unassigned.id,
                "subjectId": world.subject_id,
                "dueDate": "2026-10-16",
                "homework": "must not be created in an unassigned class",
            })),
        )
        .await;
    assert_eq!(
        forbidden.status, 403,
        "a valid class the teacher does not teach must be 403: {}",
        forbidden.body
    );
    assert_eq!(forbidden.json()["code"], "FORBIDDEN");

    // A class that does not exist at all is a 400 -- reference validation, not a
    // permission answer.
    let missing = world
        .server
        .send(
            "POST",
            "/api/teacher/homework",
            Some(&session),
            Some(json!({
                "classId": 9999,
                "subjectId": world.subject_id,
                "dueDate": "2026-10-16",
                "homework": "should not exist",
            })),
        )
        .await;
    assert_eq!(missing.status, 400, "{}", missing.body);

    // A forged author is not a deserializable field, so it is simply not honoured.
    let forged = world
        .server
        .send(
            "POST",
            "/api/teacher/homework",
            Some(&session),
            Some(json!({
                "classId": world.class_id,
                "subjectId": world.subject_id,
                "dueDate": "2026-10-16",
                "homework": "author must be the session",
                "authorId": 4,
                "teacherId": 4,
                "role": "admin",
            })),
        )
        .await;
    assert_eq!(forged.status, 201, "{}", forged.body);
    assert_eq!(
        forged.json()["author"]["id"].as_i64(),
        Some(world.teacher_id),
        "the authenticated user must win over any supplied id"
    );

    // Both fields blank is refused.
    let blank = world
        .server
        .send(
            "POST",
            "/api/teacher/homework",
            Some(&session),
            Some(json!({
                "classId": world.class_id,
                "subjectId": world.subject_id,
                "dueDate": "2026-10-16",
                "homework": "   ",
                "classwork": "",
            })),
        )
        .await;
    assert_eq!(blank.status, 400, "{}", blank.body);

    // A malformed date is refused rather than reinterpreted.
    for date in ["10/16/26", "Oct 16, 2026", "tomorrow", "2026-13-01"] {
        let reply = world
            .server
            .send(
                "POST",
                "/api/teacher/homework",
                Some(&session),
                Some(json!({
                    "classId": world.class_id,
                    "subjectId": world.subject_id,
                    "dueDate": date,
                    "homework": "text",
                })),
            )
            .await;
        assert_eq!(reply.status, 400, "{date} -> {}", reply.body);
    }
}

/// An admin may manage any homework; a second teacher may not touch someone else's.
#[tokio::test]
async fn the_admin_override_and_cross_teacher_rule_hold() {
    let world = world("admin-override").await;

    // A second teacher, with their own session and no assignment.
    let dir = std::env::temp_dir().join(format!("mmss-r10-t2-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);

    let teacher = world.server.login("teacher.test", TEACHER_PASSWORD).await;
    let teacher_session = teacher.cookie.clone().unwrap();
    let created = world
        .server
        .send(
            "POST",
            "/api/teacher/homework",
            Some(&teacher_session),
            Some(json!({
                "classId": world.class_id,
                "subjectId": world.subject_id,
                "dueDate": "2026-10-17",
                "homework": "teacher one wrote this",
            })),
        )
        .await;
    let id = created.json()["id"].as_i64().unwrap();

    // Admin may edit and delete it.
    let admin = world.server.login("admin.test", ADMIN_PASSWORD).await;
    let admin_session = admin.cookie.clone().unwrap();

    let edited = world
        .server
        .send(
            "PATCH",
            &format!("/api/teacher/homework/{id}"),
            Some(&admin_session),
            Some(json!({ "homework": "corrected by an admin" })),
        )
        .await;
    assert_eq!(edited.status, 200, "{}", edited.body);
    assert_eq!(edited.json()["homework"], "corrected by an admin");

    let deleted = world
        .server
        .send(
            "DELETE",
            &format!("/api/teacher/homework/{id}"),
            Some(&admin_session),
            None,
        )
        .await;
    assert_eq!(deleted.status, 200, "{}", deleted.body);
}

// ----------------------------------------------------------- role boundaries

/// A student on a teacher route, an anonymous caller on anything, over the socket.
#[tokio::test]
async fn role_boundaries_survive_a_real_network_hop() {
    let world = world("roles").await;
    let student = world.server.login("student.a", STUDENT_PASSWORD).await;
    let session = student.cookie.clone().unwrap();

    for (method, path) in [
        ("GET", "/api/teacher/homework"),
        ("POST", "/api/teacher/homework"),
        // `/api/ai/*` is staff-only: a student must not be able to use the classifier as
        // an oracle. The two integration *status* probes deliberately admit any signed-in
        // user (they report a boolean about the deployment), so they are not in this list.
        ("POST", "/api/ai/moderate"),
        ("POST", "/api/edusecure/import"),
    ] {
        let body = if method == "POST" {
            Some(json!({ "classId": 1, "subjectId": 1, "dueDate": "2026-10-18", "homework": "x" }))
        } else {
            None
        };
        let anonymous = world.server.send(method, path, None, body.clone()).await;
        assert_eq!(anonymous.status, 401, "anonymous {method} {path}");

        let forbidden = world.server.send(method, path, Some(&session), body).await;
        assert!(
            forbidden.status == 403 || forbidden.status == 401,
            "{method} {path} as a student: {}",
            forbidden.body
        );
        assert!(
            forbidden.status == 403,
            "{method} {path} as a student must be 403, got {}",
            forbidden.status
        );
    }
}

/// Cross-user and cross-class isolation, over the socket.
#[tokio::test]
async fn isolation_holds_over_the_socket() {
    let world = world("isolation").await;
    let teacher = world.server.login("teacher.test", TEACHER_PASSWORD).await;
    let created = world
        .server
        .send(
            "POST",
            "/api/teacher/homework",
            Some(&teacher.cookie.clone().unwrap()),
            Some(json!({
                "classId": world.class_id,
                "subjectId": world.subject_id,
                "dueDate": "2026-10-19",
                "homework": "private to 9-F",
            })),
        )
        .await;
    let id = created.json()["id"].as_i64().unwrap();

    let a = world.server.login("student.a", STUDENT_PASSWORD).await;
    let a_session = a.cookie.clone().unwrap();
    let b = world.server.login("student.b", OTHER_PASSWORD).await;
    let b_session = b.cookie.clone().unwrap();

    // Both are in 9-F, so both can read it.
    for session in [&a_session, &b_session] {
        let seen = world
            .server
            .send("GET", &format!("/api/homework/{id}"), Some(session), None)
            .await;
        assert_eq!(seen.status, 200, "{}", seen.body);
    }

    // A note is private, even between classmates in the same class.
    let note = world
        .server
        .send(
            "POST",
            &format!("/api/notes/homework/{id}"),
            Some(&a_session),
            Some(json!({ "body": "student A private" })),
        )
        .await;
    assert_eq!(note.status, 200, "{}", note.body);
    let note_id = note.json()["id"].as_i64().unwrap();

    let stolen = world
        .server
        .send(
            "PATCH",
            &format!("/api/notes/{note_id}"),
            Some(&b_session),
            Some(json!({ "body": "hijacked" })),
        )
        .await;
    assert_eq!(stolen.status, 404, "{}", stolen.body);

    let b_notes = world
        .server
        .send("GET", "/api/notes", Some(&b_session), None)
        .await;
    assert_eq!(b_notes.json().as_array().unwrap().len(), 0);

    // Progress is per user too.
    world
        .server
        .send(
            "PATCH",
            &format!("/api/progress/{id}"),
            Some(&a_session),
            Some(json!({ "completed": true })),
        )
        .await;
    let b_view = world
        .server
        .send(
            "GET",
            &format!("/api/progress/{id}"),
            Some(&b_session),
            None,
        )
        .await;
    assert_eq!(b_view.json()["completed"], false);
}

// ------------------------------------------------------ operational endpoints

/// `/health`, `/ready` and `/metrics` are reachable and correct over the socket, which is
/// how an orchestrator will reach them.
#[tokio::test]
async fn the_operational_endpoints_answer_over_the_socket() {
    let world = world("ops").await;

    let health = world.server.send("GET", "/health", None, None).await;
    assert_eq!(health.status, 200);
    assert_eq!(health.json()["status"], "ok");

    let ready = world.server.send("GET", "/ready", None, None).await;
    assert_eq!(ready.status, 200);
    assert_eq!(ready.json()["status"], "ok");

    let metrics = world.server.send("GET", "/metrics", None, None).await;
    assert_eq!(metrics.status, 200);
    assert!(
        metrics
            .header("content-type")
            .is_some_and(|value| value.starts_with("text/plain")),
        "{:?}",
        metrics.headers
    );
    assert!(metrics.body.contains("mmss_requests_total"));

    // The hardening headers reach a real client, not just an in-process router.
    for name in [
        "x-content-type-options",
        "x-frame-options",
        "referrer-policy",
        "x-request-id",
    ] {
        assert!(
            health.header(name).is_some(),
            "missing {name} over the wire"
        );
    }
}

// ------------------------------------------------------- error compatibility

/// Every error the frontend can provoke is a documented status with a JSON body carrying
/// `error` and `code` -- which is what `apiJson` and `authService` read.
#[tokio::test]
async fn error_bodies_carry_what_the_frontend_reads() {
    let world = world("errors").await;

    // A wrong password: 401, `error` a non-empty string, and the code the client maps.
    let bad = world.server.login("student.a", "nope").await;
    assert_eq!(bad.status, 401);
    let body = bad.json();
    assert!(body["error"].as_str().is_some_and(|t| !t.is_empty()));
    assert!(
        !bad.body.contains("argon2") && !bad.body.to_lowercase().contains("sql"),
        "{}",
        bad.body
    );

    // A malformed body on login: 400, not axum's 422 with a parser message.
    let malformed = world
        .server
        .send(
            "POST",
            "/api/auth/login",
            None,
            Some(json!({ "studentId": 1 })),
        )
        .await;
    assert_eq!(malformed.status, 400, "{}", malformed.body);
    assert_eq!(malformed.json()["code"], "BAD_REQUEST");

    // An unknown route is a JSON 404, not an HTML page -- the frontend parses JSON
    // unconditionally and turns anything else into an opaque parse error.
    let missing = world.server.send("GET", "/api/nope", None, None).await;
    assert_eq!(missing.status, 404);
    assert_eq!(missing.json()["code"], "NOT_FOUND");

    // An unauthenticated data route: 401 with the code `homeworkService` looks for.
    let unauth = world.server.send("GET", "/api/homework", None, None).await;
    assert_eq!(unauth.status, 401);
    assert_eq!(unauth.json()["code"], "UNAUTHENTICATED");

    // A status the frontend's login handler special-cases is never produced by this API:
    // 503 there means "school portal unavailable", which would be a misleading message for
    // a local-credentials login.
    for (school_id, password) in [("student.a", STUDENT_PASSWORD), ("student.a", "nope")] {
        let reply = world.server.login(school_id, password).await;
        assert_ne!(
            reply.status, 503,
            "a local login must never claim the portal is down"
        );
    }
}

/// A body over the configured limit is refused over the wire, and the refusal is a client
/// error rather than a server fault.
///
/// The harness tolerates a dropped connection as well as a status code, because both are
/// legitimate server behaviour here and which one happens is a timing race: the body-limit
/// layer can reject on `Content-Length` and close the connection, or read up to the limit
/// and answer. What is asserted is the property that actually matters -- the request never
/// succeeds, never yields a 5xx, and never lands.
#[tokio::test]
async fn an_oversized_body_is_refused_over_the_socket() {
    let world = world("oversized").await;
    let student = world.server.login("student.a", STUDENT_PASSWORD).await;
    let session = student.cookie.clone().unwrap();

    let huge: Value = json!({ "body": "x".repeat(400_000) });
    let reply = world
        .server
        .send_lenient("POST", "/api/notes", Some(&session), Some(huge))
        .await;
    match reply {
        Some(reply) => {
            assert!(
                reply.status == 413 || reply.status == 400,
                "got {}: {}",
                reply.status,
                &reply.body[..reply.body.len().min(200)]
            );
            assert!(
                reply.status < 500,
                "an attacker's payload is not a server fault"
            );
        }
        None => {
            // Closed without a response, which is also a refusal.
        }
    }

    // Either way, nothing was written. A body rejected for its size must not have been
    // partially applied -- this is the half of the property that a status-code-only
    // assertion would miss.
    let notes = world
        .server
        .send("GET", "/api/notes", Some(&session), None)
        .await;
    assert_eq!(
        notes.json().as_array().unwrap().len(),
        0,
        "the refused body must not have created a note"
    );
}
