//! EduSecure integration routes.
//!
//! Thin by design, like every other route module: parse, delegate, shape. All of the
//! semantics live in [`EduSecureService`].
//!
//! Administrator-only, deliberately. Publishing pushes MMSS's homework outward to a school
//! system, and importing writes historical rows into the source of truth. Both are
//! deliberate acts with consequences outside MMSS, and neither is something a teacher
//! clicking "save" should trigger as a side effect. During the transition these are
//! operator actions, not student or teacher ones.

use axum::extract::{Path, State};
use axum::Json;

use crate::api::{EduSecureStatusView, ImportBody, ImportResult, PublicationView};
use crate::auth::{AdminUser, AuthenticatedUser};
use crate::error::ApiResult;
use crate::services::edusecure::{
    client_for, parse_announcement_html, require_admin, EduSecureService,
};
use crate::state::AppState;
use crate::validate::{json_body, path_id, text_body, MAX_NOTE_LEN};

pub fn router(prefix: &str) -> axum::Router<AppState> {
    use axum::routing::{get, post};
    axum::Router::new()
        .route(&format!("{prefix}/edusecure/status"), get(status))
        .route(&format!("{prefix}/edusecure/import"), post(import))
        .route(
            &format!("{prefix}/edusecure/homework/{{id}}/publication"),
            get(publication).post(publish),
        )
}

fn service(state: &AppState) -> EduSecureService<'_> {
    EduSecureService::new(
        &state.db,
        client_for(&state.config.edusecure),
        state.config.edusecure.enabled(),
    )
}

/// `GET /api/edusecure/status`
///
/// Whether the integration is configured. Never echoes a credential, and answers 200 with
/// `{"enabled": false}` rather than an error, because "not configured" is the normal state
/// of a local checkout and a health check that 503s would be a false alarm.
///
/// Any signed-in user may ask, not only an administrator: it reports a boolean about the
/// deployment and nothing about any account, and a teacher UI needs to know whether to
/// offer the option at all. Anonymous is 401, like every other route outside `/health`.
pub async fn status(
    State(state): State<AppState>,
    _user: AuthenticatedUser,
) -> Json<EduSecureStatusView> {
    Json(EduSecureStatusView {
        enabled: state.config.edusecure.enabled(),
    })
}

/// `GET /api/edusecure/homework/{id}/publication`
///
/// The publication state of one entry, or `null` when it has never been attempted.
pub async fn publication(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(raw): Path<String>,
) -> ApiResult<Json<Option<PublicationView>>> {
    let homework_id = path_id(&raw)?;
    // 404 for an entry that does not exist, matching every other read: a publication is
    // meaningless without the homework it refers to, and the FK guarantees they agree.
    crate::repositories::homework::find_by_id(&state.db, homework_id)
        .await?
        .ok_or_else(|| crate::error::ApiError::not_found("That homework item was not found."))?;
    Ok(Json(service(&state).publication(homework_id).await?))
}

/// `POST /api/edusecure/homework/{id}/publication`
///
/// Publishes one entry. Idempotent: an entry that is already published answers with its
/// existing state and does not call the portal again.
pub async fn publish(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(raw): Path<String>,
) -> ApiResult<Json<PublicationView>> {
    require_admin(admin.0.principal())?;
    let homework_id = path_id(&raw)?;
    Ok(Json(service(&state).publish(homework_id).await?))
}

/// `POST /api/edusecure/import`
///
/// Imports a portal page. The caller supplies the HTML rather than this service fetching
/// it, because the portal's control ids are regenerated each academic year and that
/// fragility belongs to whoever refreshes the page, not to this codebase. See
/// `EDUSECURE_AUDIT.md`.
pub async fn import(
    State(state): State<AppState>,
    admin: AdminUser,
    body: axum::body::Bytes,
) -> ApiResult<Json<ImportResult>> {
    require_admin(admin.0.principal())?;
    let parsed: ImportBody = json_body(
        &body,
        "Expected a JSON body with classId, subjectId and html.",
    )?;
    let html = text_body(&parsed.html, "html", MAX_NOTE_LEN * 10)?;

    let rows = parse_announcement_html(&html).map_err(|error| {
        crate::error::ApiError::bad_request(format!(
            "The page could not be read as an EduSecure announcement page: {error}"
        ))
    })?;
    Ok(Json(
        service(&state)
            .import(parsed.class_id, parsed.subject_id, &rows)
            .await?,
    ))
}
