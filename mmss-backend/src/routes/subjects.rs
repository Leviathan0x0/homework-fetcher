//! Subjects a student can filter by.
//!
//! There was no subjects endpoint before: the client hardcoded the list in
//! `subjectDetector.ts`. This replaces that hardcoded array with the `subjects` table.

use axum::extract::State;
use axum::Json;

use crate::api::SubjectView;
use crate::auth::StudentUser;
use crate::error::ApiResult;
use crate::repositories::subjects as subjects_repo;
use crate::state::AppState;

pub fn router(prefix: &str) -> axum::Router<AppState> {
    axum::Router::new().route(&format!("{prefix}/subjects"), axum::routing::get(list))
}

/// `GET /api/subjects`
///
/// The subjects the school actually uses, ordered by name so the client's combobox has a
/// stable list. Deliberately *not* narrowed to the student's class: the subject set is a
/// property of the school, and a student can filter a feed by any subject that appears
/// in it. Empty is `[]`, never null.
pub async fn list(
    State(state): State<AppState>,
    _user: StudentUser,
) -> ApiResult<Json<Vec<SubjectView>>> {
    let subjects = subjects_repo::list(&state.db).await?;
    Ok(Json(subjects.iter().map(SubjectView::from).collect()))
}
