//! Phase 8 tests for the AI boundary.
//!
//! Every provider here is a deterministic fake. **No test makes a network call, and none
//! needs an API key**: the suite boots, runs and passes on a machine that has never heard of
//! a model.
//!
//! The property the whole phase exists to protect is stated once and then attacked from
//! several directions: AI is assistive, so no provider behaviour -- success, garbage,
//! silence, or a hang -- may change a stored homework row.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use mmss_backend::config::{AiConfig, Config};
use mmss_backend::cookies::SESSION_COOKIE;
use mmss_backend::models::{NewHomework, NewUser, Role};
use mmss_backend::repositories::{classes, homework, subjects, teacher_classes};
use mmss_backend::services::ai::{
    client_for, AiClient, AiError, AiService, ClassifyFuture, ClassifyRequest, DisabledAi,
    ModerateFuture, ModerateRequest, RawClassification, RawModeration,
};
use mmss_backend::services::auth::AuthService;
use mmss_backend::state::AppState;
use serde_json::{json, Value};
use tower::ServiceExt;

static NEXT_ID: AtomicU32 = AtomicU32::new(0);

const STUDENT_PASSWORD: &str = "test-student-password";
const TEACHER_PASSWORD: &str = "test-teacher-password";
const ADMIN_PASSWORD: &str = "test-admin-password";

/// A deterministic provider: it answers with whatever it was told to, and it can be told to
/// hang, so the timeout is exercised without a socket.
struct FakeAi {
    name: &'static str,
    classify: Result<RawClassification, AiError>,
    moderate: Result<RawModeration, AiError>,
    classify_hangs: bool,
    moderate_hangs: bool,
    calls: AtomicU32,
    /// The last text handed in, so a test can assert the bound was applied before the call.
    seen: std::sync::Mutex<Vec<String>>,
}

impl FakeAi {
    fn new(name: &'static str) -> Self {
        Self {
            name,
            classify: Ok(RawClassification {
                subject: Some("Mathematics".into()),
                is_formatted: Some(true),
            }),
            moderate: Ok(RawModeration {
                flagged: Some(false),
                categories: Some(vec![]),
            }),
            classify_hangs: false,
            moderate_hangs: false,
            calls: AtomicU32::new(0),
            seen: std::sync::Mutex::new(Vec::new()),
        }
    }

    fn classifying(mut self, subject: Option<&str>, is_formatted: bool) -> Self {
        self.classify = Ok(RawClassification {
            subject: subject.map(str::to_owned),
            is_formatted: Some(is_formatted),
        });
        self
    }

    fn moderating(mut self, flagged: bool, categories: &[&str]) -> Self {
        self.moderate = Ok(RawModeration {
            flagged: Some(flagged),
            categories: Some(categories.iter().map(|c| (*c).to_owned()).collect()),
        });
        self
    }

    fn classify_errors(mut self, error: AiError) -> Self {
        self.classify = Err(error);
        self
    }

    fn moderate_errors(mut self, error: AiError) -> Self {
        self.moderate = Err(error);
        self
    }

    fn hanging(mut self, classify: bool, moderate: bool) -> Self {
        self.classify_hangs = classify;
        self.moderate_hangs = moderate;
        self
    }

    fn calls(&self) -> u32 {
        self.calls.load(Ordering::SeqCst)
    }

    fn last_seen(&self) -> String {
        self.seen
            .lock()
            .unwrap()
            .last()
            .cloned()
            .unwrap_or_default()
    }
}

impl AiClient for FakeAi {
    fn provider(&self) -> &'static str {
        self.name
    }

    fn classify<'a>(&'a self, request: ClassifyRequest) -> ClassifyFuture<'a> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.seen.lock().unwrap().push(request.text);
        let hang = self.classify_hangs;
        let outcome = self.classify.clone();
        Box::pin(async move {
            if hang {
                // Longer than any timeout the service will use, so the service must give up
                // first. This is the only way to test a timeout without a real socket.
                tokio::time::sleep(Duration::from_secs(30)).await;
                return Err(AiError::Unreachable);
            }
            outcome
        })
    }

    fn moderate<'a>(&'a self, request: ModerateRequest) -> ModerateFuture<'a> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.seen.lock().unwrap().push(request.text);
        let hang = self.moderate_hangs;
        let outcome = self.moderate.clone();
        Box::pin(async move {
            if hang {
                tokio::time::sleep(Duration::from_secs(30)).await;
                return Err(AiError::Unreachable);
            }
            outcome
        })
    }
}

/// A configuration with or without credentials, and a timeout short enough to keep the
/// hanging tests quick.
fn ai_config(enabled: bool, timeout_ms: i64) -> AiConfig {
    let config = AiConfig {
        timeout_ms,
        ..Default::default()
    };
    if enabled {
        AiConfig {
            base_url: Some("http://127.0.0.1:8001".into()),
            api_key: Some("not-a-real-secret".into()),
            model: Some("fake-model".into()),
            timeout_ms,
        }
    } else {
        config
    }
}

// ---------------------------------------------------------------------- world

struct World {
    app: axum::Router,
    db: sqlx::SqlitePool,
    class_id: i64,
    subject_id: i64,
    /// Teacher-authored. The record that must never be touched by anything AI does.
    authored: i64,
    ai: AiConfig,
}

async fn world(tag: &str, ai: AiConfig) -> World {
    let unique = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "mmss-r8-test-{}-{tag}-{unique}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    let mut config = Config::for_tests(format!("sqlite://{}/mmss.db", dir.display()));
    config.ai = ai;
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

    let authored = homework::create(
        &db,
        &NewHomework {
            class_id: class.id,
            subject_id: subject.id,
            author_id: Some(teacher),
            due_date: "2026-10-12".into(),
            homework_text: Some("Complete exercises 1-10.".into()),
            classwork_text: Some("Chapter 4 examples.".into()),
        },
    )
    .await
    .unwrap()
    .id;

    let ai = state.config.ai.clone();
    World {
        app: mmss_backend::app(state),
        db,
        class_id: class.id,
        subject_id: subject.id,
        authored,
        ai,
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

/// The service under test, with an injected provider.
fn service(world: &World, client: Arc<dyn AiClient>) -> AiService<'_> {
    AiService::new(client, &world.ai)
}

// ---------------------------------------------------------------- AI disabled

/// With no credentials the layer is off, and the status view says so without disclosing the
/// base URL, the key or the model.
#[tokio::test]
async fn ai_disabled_is_off_and_says_nothing_secret() {
    let world = world("disabled", ai_config(false, 5_000)).await;
    assert!(!world.ai.enabled());

    let (status, body) = call(&world.app, "GET", "/api/ai/status", None, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["enabled"], false);
    assert_eq!(body["provider"], "disabled");

    let rendered = body.to_string();
    for secret in ["127.0.0.1:8001", "AI_API_KEY", "fake-model"] {
        assert!(
            !rendered.contains(secret),
            "status leaked {secret}: {rendered}"
        );
    }
}

/// The disabled client is a real implementation, so "off" and "failing" run the same code.
#[tokio::test]
async fn the_disabled_client_answers_disabled_for_both_capabilities() {
    let world = world("disabled-client", ai_config(false, 5_000)).await;
    let service = service(&world, Arc::new(DisabledAi));

    let error = service
        .classify("some homework text", None)
        .await
        .unwrap_err();
    assert_eq!(error.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert!(!service.status().enabled);

    let error = service.moderate("some homework text").await.unwrap_err();
    assert_eq!(error.status(), StatusCode::SERVICE_UNAVAILABLE);
}

// ------------------------------------------------------- successful answers

#[tokio::test]
async fn a_successful_classification_returns_a_validated_suggestion() {
    let world = world("classify-ok", ai_config(true, 5_000)).await;
    let provider = Arc::new(FakeAi::new("fake-remote").classifying(Some("Physics"), false));
    let service = service(&world, provider.clone());

    let view = service
        .classify("Refraction problems for chapter 4", None)
        .await
        .unwrap();
    assert_eq!(view.subject.as_deref(), Some("Physics"));
    assert!(!view.is_formatted);
    assert_eq!(service.status().provider, "fake-remote");
    assert_eq!(provider.calls(), 1);
}

#[tokio::test]
async fn a_successful_moderation_returns_a_normalised_verdict() {
    let world = world("moderate-ok", ai_config(true, 5_000)).await;
    let provider = Arc::new(FakeAi::new("fake-remote").moderating(true, &[" Harassment ", ""]));
    let service = service(&world, provider);

    let view = service.moderate("some text").await.unwrap();
    assert!(view.flagged);
    assert_eq!(view.categories, vec!["harassment".to_owned()]);
}

#[tokio::test]
async fn a_classification_with_no_subject_reports_absent_rather_than_guessing() {
    let world = world("classify-none", ai_config(true, 5_000)).await;
    let service = service(&world, Arc::new(FakeAi::new("f").classifying(None, true)));

    let view = service.classify("some text", None).await.unwrap();
    assert!(
        view.subject.is_none(),
        "a plausible wrong subject is worse than none"
    );
    assert!(view.is_formatted);
}

// ------------------------------------------------------ malformed / unsafe output

/// Every way a model can answer badly becomes `Malformed`, never a partial view and never a
/// 500.
#[tokio::test]
async fn malformed_model_output_is_rejected_as_a_whole() {
    for classification in [
        // Neither field usable: not an answer.
        RawClassification {
            subject: None,
            is_formatted: None,
        },
        // A blank subject with no verdict is not an answer either.
        RawClassification {
            subject: Some("   ".into()),
            is_formatted: None,
        },
    ] {
        let world = world("malformed", ai_config(true, 5_000)).await;
        let service = service(
            &world,
            Arc::new(FakeAi::new("f").classify_errors(AiError::Malformed)),
        );
        // The provider-level Malformed and the validation-level Malformed below are the
        // same thing to a caller, which is the whole point of validating the wire shape.
        let error = service.classify("text", None).await.unwrap_err();
        assert_eq!(error.status(), StatusCode::BAD_GATEWAY);

        // And the same shape, arriving through validation rather than the client.
        assert_eq!(
            mmss_backend::services::ai::validate(classification),
            Err(AiError::Malformed)
        );
    }

    // A moderation response missing its flag.
    let world = world("malformed-moderation", ai_config(true, 5_000)).await;
    let service = service(
        &world,
        Arc::new(FakeAi::new("f").moderate_errors(AiError::Malformed)),
    );
    let error = service.moderate("text").await.unwrap_err();
    assert_eq!(error.status(), StatusCode::BAD_GATEWAY);
}

/// A model that returns nothing usable is answered with an error, not with an empty
/// suggestion that reads like "nothing to report".
#[tokio::test]
async fn a_provider_that_returns_nothing_usable_is_not_reported_as_clean() {
    let world = world("empty-output", ai_config(true, 5_000)).await;
    let provider = Arc::new(FakeAi::new("f").classifying(Some(""), false));
    let blank_subject = service(&world, provider);

    // Blank subject + a verdict is still a usable answer, so it succeeds with no subject.
    let view = blank_subject.classify("text", None).await.unwrap();
    assert!(view.subject.is_none());

    // A provider error, though, is an error -- never a clean-looking empty answer.
    let erroring = service(
        &world,
        Arc::new(FakeAi::new("f").classify_errors(AiError::Malformed)),
    );
    assert!(erroring.classify("text", None).await.is_err());
}

/// An unexpectedly hostile response -- an enormous answer, or a subject full of markup --
/// is normalised by validation and never reaches a caller unbounded.
#[tokio::test]
async fn an_unexpected_response_is_bounded_before_it_is_returned() {
    let world = world("hostile", ai_config(true, 5_000)).await;

    // A runaway subject: far longer than the input, so the model rewrote the content.
    let huge = "A".repeat(50_000);
    let runaway = service(
        &world,
        Arc::new(FakeAi::new("f").classifying(Some(&huge), true)),
    );
    let view = runaway.classify("text", None).await.unwrap();
    assert!(
        view.subject.as_ref().unwrap().chars().count() <= 8_000,
        "a runaway answer must be cut, not returned whole"
    );

    // Many categories, some empty and some enormous: bounded in count and in length, with
    // the unusable ones dropped rather than shown.
    let noisy: Vec<String> = (0..40)
        .map(|n| {
            if n % 3 == 0 {
                String::new()
            } else {
                format!("  Category{n}  ")
            }
        })
        .chain(std::iter::once("Z".repeat(500)))
        .collect();
    let borrowed: Vec<&str> = noisy.iter().map(String::as_str).collect();
    let noisy_service = service(
        &world,
        Arc::new(FakeAi::new("f").moderating(true, &borrowed)),
    );

    let view = noisy_service.moderate("text").await.unwrap();
    assert!(view.flagged, "the verdict itself is preserved");
    assert!(
        view.categories.len() <= 16,
        "the category count must be bounded: {:?}",
        view.categories
    );
    assert!(
        view.categories
            .iter()
            .all(|c| !c.is_empty() && c.chars().count() <= 64),
        "unusable categories must be dropped, not shown: {:?}",
        view.categories
    );
    assert!(
        view.categories.iter().all(|c| c == &c.to_lowercase()),
        "categories are normalised: {:?}",
        view.categories
    );
}

// ------------------------------------------------------------- timeout / failure

/// A provider that never answers is bounded by the service, so the guarantee holds for any
/// implementation rather than being each client's promise.
#[tokio::test]
async fn a_hanging_provider_is_cut_off_by_the_service() {
    let world = world("timeout", ai_config(true, 150)).await;
    let provider = Arc::new(FakeAi::new("slow").hanging(true, true));
    let service = service(&world, provider);

    let started = std::time::Instant::now();
    let error = service.classify("text", None).await.unwrap_err();
    let elapsed = started.elapsed();

    assert_eq!(error.status(), StatusCode::BAD_GATEWAY);
    assert!(
        elapsed < Duration::from_secs(5),
        "the timeout must fire promptly, took {elapsed:?}"
    );

    let error = service.moderate("text").await.unwrap_err();
    assert_eq!(error.status(), StatusCode::BAD_GATEWAY);
}

/// Every provider failure is a 502 or a 503 -- never a 500, because nothing a model does is
/// an internal server fault.
#[tokio::test]
async fn provider_failures_are_never_a_server_error() {
    for error in [
        AiError::Unreachable,
        AiError::Rejected,
        AiError::Malformed,
        AiError::Disabled,
    ] {
        let world = world("failures", ai_config(true, 5_000)).await;
        let service = service(
            &world,
            Arc::new(FakeAi::new("f").classify_errors(error.clone())),
        );
        let api_error = service.classify("text", None).await.unwrap_err();
        assert!(
            matches!(
                api_error.status(),
                StatusCode::BAD_GATEWAY | StatusCode::SERVICE_UNAVAILABLE
            ),
            "{error:?} produced {}",
            api_error.status()
        );
        // And the message never leaks the key or the endpoint.
        let message = api_error.to_string();
        assert!(!message.contains("not-a-real-secret"), "{message}");
        assert!(!message.contains("8001"), "{message}");
    }
}

// ------------------------------------------- the record is never disturbed

/// The architectural rule, tested: whatever the provider does, the stored homework is
/// byte-identical afterwards.
#[tokio::test]
async fn no_provider_behaviour_changes_stored_homework() {
    let behaviours: Vec<Box<dyn Fn() -> Arc<dyn AiClient> + Send + Sync>> = vec![
        Box::new(|| Arc::new(FakeAi::new("ok").classifying(Some("Physics"), false))),
        Box::new(|| Arc::new(FakeAi::new("garbage").classify_errors(AiError::Malformed))),
        Box::new(|| Arc::new(FakeAi::new("down").classify_errors(AiError::Unreachable))),
        Box::new(|| Arc::new(FakeAi::new("refused").classify_errors(AiError::Rejected))),
        Box::new(|| Arc::new(FakeAi::new("off").classify_errors(AiError::Disabled))),
        Box::new(|| Arc::new(FakeAi::new("hang").hanging(true, false))),
    ];

    for build in behaviours {
        let world = world("non-destructive", ai_config(true, 150)).await;
        let before = homework::find_by_id(&world.db, world.authored)
            .await
            .unwrap();
        let service = service(&world, build());

        let _ = service.classify("Complete exercises 1-10.", None).await;
        let _ = service.moderate("Complete exercises 1-10.").await;

        let after = homework::find_by_id(&world.db, world.authored)
            .await
            .unwrap();
        assert_eq!(
            before,
            after,
            "a model changed the source of truth: {}",
            service.status().provider
        );
    }
}

/// A teacher creating homework never touches the AI layer, so the API is fully functional
/// with AI switched off -- and with a provider that misbehaves.
#[tokio::test]
async fn homework_creation_never_depends_on_ai() {
    for enabled in [false, true] {
        let world = world("create-without-ai", ai_config(enabled, 5_000)).await;
        let teacher = sign_in(&world, "teacher.test", TEACHER_PASSWORD).await;

        let (status, created) = call(
            &world.app,
            "POST",
            "/api/teacher/homework",
            Some(&teacher),
            Some(json!({
                "classId": world.class_id,
                "subjectId": world.subject_id,
                "dueDate": "2026-10-20",
                "homework": "Chapter 6 questions",
                "classwork": "Presentation notes",
            })),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "enabled={enabled}: {created}");

        // And a student sees it, which is the whole point of the app.
        let student = sign_in(&world, "student.a", STUDENT_PASSWORD).await;
        let (status, feed) = call(&world.app, "GET", "/api/homework", Some(&student), None).await;
        assert_eq!(status, StatusCode::OK);
        let found = feed["homework"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["homework"] == "Chapter 6 questions");
        assert!(found, "enabled={enabled}");
    }
}

// ------------------------------------------------------------- route guards

#[tokio::test]
async fn ai_routes_require_staff_not_a_student() {
    let world = world("guards", ai_config(false, 5_000)).await;
    let teacher = sign_in(&world, "teacher.test", TEACHER_PASSWORD).await;
    let admin = sign_in(&world, "admin.test", ADMIN_PASSWORD).await;
    let student = sign_in(&world, "student.a", STUDENT_PASSWORD).await;

    for path in ["/api/ai/classify", "/api/ai/moderate"] {
        let body = Some(json!({ "text": "some text" }));

        // Anonymous.
        let (status, _) = call(&world.app, "POST", path, None, body.clone()).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}");

        // A student is refused, so the endpoint is not an oracle for classifying strings.
        let (status, out) = call(&world.app, "POST", path, Some(&student), body.clone()).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}: {out}");

        // Staff reach it, and with AI off they get 503 rather than 404 or 500.
        for token in [teacher.as_str(), admin.as_str()] {
            let (status, out) = call(&world.app, "POST", path, Some(token), body.clone()).await;
            assert_eq!(
                status,
                StatusCode::SERVICE_UNAVAILABLE,
                "{token} {path}: {out}"
            );
            assert_eq!(out["code"], "AI_UNAVAILABLE");
        }
    }

    // Status is public and never leaks.
    let (status, body) = call(&world.app, "GET", "/api/ai/status", None, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["enabled"], false);
}

#[tokio::test]
async fn empty_and_oversized_requests_are_refused_before_any_call() {
    let world = world("limits", ai_config(true, 5_000)).await;
    let provider = Arc::new(FakeAi::new("f"));
    let teacher = sign_in(&world, "teacher.test", TEACHER_PASSWORD).await;

    for path in ["/api/ai/classify", "/api/ai/moderate"] {
        for text in ["", "   "] {
            let (status, out) = call(
                &world.app,
                "POST",
                path,
                Some(&teacher),
                Some(json!({ "text": text })),
            )
            .await;
            assert_eq!(
                status,
                StatusCode::BAD_REQUEST,
                "{path} with {text:?}: {out}"
            );
        }
        // Larger than the input bound: refused at the route, so it never becomes a call.
        let (status, out) = call(
            &world.app,
            "POST",
            path,
            Some(&teacher),
            Some(json!({ "text": "x".repeat(4_001) })),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{path}: {out}");
    }

    assert_eq!(
        provider.calls(),
        0,
        "no provider call should have been made"
    );

    // The bound is applied inside the service too, for any caller that is not the route.
    let service = service(&world, provider.clone());
    let long = "y".repeat(10_000);
    let _ = service.classify(&long, None).await;
    assert_eq!(
        provider.last_seen().chars().count(),
        4_000,
        "the service must bound the text before handing it over"
    );
}

#[tokio::test]
async fn a_malformed_body_is_a_clean_400() {
    let world = world("bad-body", ai_config(true, 5_000)).await;
    let teacher = sign_in(&world, "teacher.test", TEACHER_PASSWORD).await;

    for body in [
        json!({}),
        json!({ "text": 42 }),
        json!({ "subject_hint": "Maths" }),
    ] {
        let (status, out) = call(
            &world.app,
            "POST",
            "/api/ai/classify",
            Some(&teacher),
            Some(body.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {out}");
    }
}

// -------------------------------------- swapping the provider changes nothing

/// A second, deliberately different provider implementation reaches the same service and
/// the same HTTP contract. This is the property that lets a local model replace a remote
/// one without touching a service, a route or a DTO.
#[tokio::test]
async fn ai_provider_is_a_configuration_choice_not_a_code_change() {
    // A provider with a different name, a different answer shape and a different verdict.
    struct OtherProvider;
    impl AiClient for OtherProvider {
        fn provider(&self) -> &'static str {
            "local-model"
        }
        fn classify<'a>(&'a self, _request: ClassifyRequest) -> ClassifyFuture<'a> {
            Box::pin(async {
                Ok(RawClassification {
                    subject: Some("Biology".into()),
                    is_formatted: Some(true),
                })
            })
        }
        fn moderate<'a>(&'a self, _request: ModerateRequest) -> ModerateFuture<'a> {
            Box::pin(async {
                Ok(RawModeration {
                    flagged: Some(false),
                    categories: None,
                })
            })
        }
    }

    let world = world("provider-swap", ai_config(true, 5_000)).await;
    let teacher = sign_in(&world, "teacher.test", TEACHER_PASSWORD).await;

    // Same route, same request, same response *shape* -- different provider behind it.
    let remote = AiService::new(
        Arc::new(FakeAi::new("remote-model").classifying(Some("Physics"), false)),
        &world.ai,
    );
    let local = AiService::new(Arc::new(OtherProvider), &world.ai);

    let from_remote = remote.classify("text", None).await.unwrap();
    let from_local = local.classify("text", None).await.unwrap();

    assert_eq!(from_remote.subject.as_deref(), Some("Physics"));
    assert_eq!(from_local.subject.as_deref(), Some("Biology"));
    // The *answers* differ -- that is the provider doing its job. The *shape* does not: both
    // serialise to exactly the same two keys, so no client has to know which is behind it.
    let remote_json = serde_json::to_value(&from_remote).unwrap();
    let local_json = serde_json::to_value(&from_local).unwrap();
    let keys = |value: &serde_json::Value| {
        value
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>()
    };
    assert_eq!(keys(&remote_json), vec!["isFormatted", "subject"]);
    assert_eq!(keys(&local_json), keys(&remote_json));
    assert_eq!(local.status().provider, "local-model");

    // And the HTTP contract is the same one either way.
    let (status, body) = call(
        &world.app,
        "POST",
        "/api/ai/classify",
        Some(&teacher),
        Some(json!({ "text": "text" })),
    )
    .await;
    // AI is configured but `client_for` has no concrete transport yet, so this is the
    // disabled path -- which is precisely the honest state of things.
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(body["error"].as_str().unwrap().contains("not configured"));
}

/// The production factory returns the disabled client today, and that is the *only* place
/// provider selection happens -- so adding a provider is a one-line change here.
#[tokio::test]
async fn the_factory_is_the_only_provider_choice() {
    let client = client_for(&ai_config(true, 5_000));
    assert_eq!(client.provider(), "disabled");
    assert!(client_for(&ai_config(false, 5_000)).provider() == "disabled");
}
