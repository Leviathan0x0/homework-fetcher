//! Student completion state.
//!
//! Every route here is scoped to the signed-in student by construction: the repository
//! calls take `principal.user_id`, so there is no request parameter that could redirect a
//! write onto someone else's row.

use axum::extract::{Path, State};
use axum::Json;

use crate::api::{CompletionBody, ProgressView};
use crate::auth::StudentUser;
use crate::error::ApiResult;
use crate::routes::homework::ensure_visible;
use crate::services::progress::ProgressService;
use crate::state::AppState;
use crate::validate::{json_body, path_id};

pub fn router(prefix: &str) -> axum::Router<AppState> {
    use axum::routing::get;
    axum::Router::new()
        .route(&format!("{prefix}/progress"), get(list))
        .route(
            &format!("{prefix}/progress/{{homeworkId}}"),
            get(get_one).patch(set_completed),
        )
}

fn service(db: &sqlx::SqlitePool) -> ProgressService<'_> {
    ProgressService::new(db)
}

/// `GET /api/progress` -- every tick this student has made.
pub async fn list(
    State(state): State<AppState>,
    user: StudentUser,
) -> ApiResult<Json<Vec<ProgressView>>> {
    Ok(Json(service(&state.db).list(user.0.principal()).await?))
}

/// `GET /api/progress/{homeworkId}`
///
/// Never-ticked is `{"completed": false}`, not a 404: absence of a row *is* the
/// not-completed state, and asking "have I done this?" should always get an answer.
pub async fn get_one(
    State(state): State<AppState>,
    user: StudentUser,
    Path(raw): Path<String>,
) -> ApiResult<Json<ProgressView>> {
    let homework_id = path_id(&raw)?;
    ensure_visible(&state, user.0.principal(), homework_id).await?;
    Ok(Json(
        service(&state.db)
            .get(user.0.principal(), homework_id)
            .await?,
    ))
}

/// `PATCH /api/progress/{homeworkId}` with `{"completed": true|false}`.
///
/// Idempotent, because ticking the same box twice is the same state rather than a
/// conflict. 404 when the homework is not one this student can see, which is what stops
/// a write onto an entry that does not exist or belongs to another class.
pub async fn set_completed(
    State(state): State<AppState>,
    user: StudentUser,
    Path(raw): Path<String>,
    body: axum::body::Bytes,
) -> ApiResult<Json<ProgressView>> {
    let homework_id = path_id(&raw)?;
    ensure_visible(&state, user.0.principal(), homework_id).await?;
    let parsed: CompletionBody = json_body(&body, "Expected a JSON body with a completed flag.")?;
    Ok(Json(
        service(&state.db)
            .set_completed(user.0.principal(), homework_id, parsed.completed)
            .await?,
    ))
}
