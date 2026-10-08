//! The AI routes.
//!
//! Thin, like every other route module. Two assistive endpoints plus a status probe. None
//! of them writes to homework, and none of them is on the homework-creation path -- AI is
//! optional, and `POST /api/teacher/homework` never calls into [`AiService`].
//!
//! Teacher or administrator. A student cannot reach these: a moderation verdict on
//! arbitrary text is an operator tool, and a classification hint is an authoring aid for
//! whoever is recording the work. Refusing students here also means a student cannot use the
//! endpoint as an oracle for what a given string is classified as.

use axum::extract::State;
use axum::Json;

use crate::api::{AiStatusView, ClassificationView, ClassifyBody, ModerateBody, ModerationView};
use crate::auth::AuthenticatedUser;
use crate::config::MAX_AI_INPUT_CHARS;
use crate::error::ApiResult;
use crate::models::Role;
use crate::services::ai::{client_for, AiService};
use crate::state::AppState;
use crate::validate::json_body;

pub fn router(prefix: &str) -> axum::Router<AppState> {
    use axum::routing::{get, post};
    axum::Router::new()
        .route(&format!("{prefix}/ai/status"), get(status))
        .route(&format!("{prefix}/ai/classify"), post(classify))
        .route(&format!("{prefix}/ai/moderate"), post(moderate))
}

fn service(state: &AppState) -> AiService<'_> {
    AiService::new(client_for(&state.config.ai), &state.config.ai)
}

/// Teacher-only surfaces. Students are refused, not merely unused.
fn require_staff(user: &AuthenticatedUser) -> ApiResult<()> {
    if user.role() == Role::Student {
        return Err(crate::error::ApiError::forbidden(
            "This resource is for teachers and administrators.",
        ));
    }
    Ok(())
}

/// `GET /api/ai/status`
///
/// 200 with `{"enabled": false}` rather than an error when the layer is off: "not
/// configured" is the normal state of a local checkout, and a UI asking whether to offer
/// the feature deserves an answer, not a failure.
pub async fn status(State(state): State<AppState>) -> Json<AiStatusView> {
    Json(service(&state).status())
}

/// `POST /api/ai/classify`
///
/// Returns a suggestion. Nothing is written; the caller decides whether to use it.
pub async fn classify(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    body: axum::body::Bytes,
) -> ApiResult<Json<ClassificationView>> {
    require_staff(&user)?;
    let parsed: ClassifyBody = json_body(&body, "Expected a JSON body with text.")?;
    // Bounded here as well as in the service, so an oversized request is a named 400
    // before it becomes an oversized model call.
    if parsed.text.trim().is_empty() {
        return Err(crate::error::ApiError::bad_request("text cannot be empty."));
    }
    if parsed.text.chars().count() > MAX_AI_INPUT_CHARS {
        return Err(crate::error::ApiError::bad_request(format!(
            "text must be at most {MAX_AI_INPUT_CHARS} characters."
        )));
    }
    Ok(Json(
        service(&state)
            .classify(&parsed.text, parsed.subject_hint.as_deref())
            .await?,
    ))
}

/// `POST /api/ai/moderate`
///
/// Returns a verdict. Advisory, and deliberately not wired into any write path: a
/// moderation flag that silently blocked a teacher's work would be the AI deciding the
/// source of truth.
pub async fn moderate(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    body: axum::body::Bytes,
) -> ApiResult<Json<ModerationView>> {
    require_staff(&user)?;
    let parsed: ModerateBody = json_body(&body, "Expected a JSON body with text.")?;
    if parsed.text.trim().is_empty() {
        return Err(crate::error::ApiError::bad_request("text cannot be empty."));
    }
    if parsed.text.chars().count() > MAX_AI_INPUT_CHARS {
        return Err(crate::error::ApiError::bad_request(format!(
            "text must be at most {MAX_AI_INPUT_CHARS} characters."
        )));
    }
    Ok(Json(service(&state).moderate(&parsed.text).await?))
}
