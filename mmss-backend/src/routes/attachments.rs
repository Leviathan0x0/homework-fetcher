//! Attachment metadata for a student.
//!
//! Metadata only. No file bytes are served and none are stored in SQLite -- see
//! `STUDENT_API_AUDIT.md` for why there is deliberately no download URL here.

use axum::extract::{Path, State};
use axum::Json;

use crate::api::AttachmentView;
use crate::auth::StudentUser;
use crate::error::ApiResult;
use crate::services::homework::HomeworkService;
use crate::state::AppState;

pub fn router(prefix: &str) -> axum::Router<AppState> {
    axum::Router::new().route(
        &format!("{prefix}/homework/{{id}}/attachments"),
        axum::routing::get(list),
    )
}

/// `GET /api/homework/{id}/attachments`
///
/// The class check is the homework service's, so an entry in another class is a 404
/// before any attachment metadata is read.
pub async fn list(
    State(state): State<AppState>,
    user: StudentUser,
    Path(raw): Path<String>,
) -> ApiResult<Json<Vec<AttachmentView>>> {
    let homework_id = crate::validate::path_id(&raw)?;
    let attachments = HomeworkService::new(&state.db)
        .attachments_for(user.0.principal(), homework_id)
        .await?;
    Ok(Json(attachments))
}
