//! Student homework routes.
//!
//! Thin by design: parse and validate input, ask [`HomeworkService`], shape a response.
//! No SQL and no access rules live here.

use axum::extract::{Path, Query, State};
use axum::Json;

use crate::api::{HomeworkFeed, HomeworkView};
use crate::auth::StudentUser;
use crate::error::ApiResult;
use crate::services::homework::{HomeworkQuery, HomeworkService};
use crate::state::AppState;
use crate::validate::{check_range, query_date, query_id, query_limit, Params};

pub fn router(prefix: &str) -> axum::Router<AppState> {
    use axum::routing::get;
    axum::Router::new()
        .route(&format!("{prefix}/homework"), get(list))
        .route(&format!("{prefix}/homework/{{id}}"), get(get_one))
}

/// `GET /api/homework`
///
/// The student's whole class feed by default. The current client fetches everything and
/// filters in the browser, so a default limit or a default page would quietly empty half
/// its views -- see `STUDENT_API_AUDIT.md`. Filters are an addition for other clients.
///
/// Every filter is optional; all are validated before the query runs, so an unparseable
/// date is a 400 rather than a silently wider result set.
pub async fn list(
    State(state): State<AppState>,
    user: StudentUser,
    params: Query<Params>,
) -> ApiResult<Json<HomeworkFeed>> {
    let subject_id = query_id(&params, "subjectId")?;
    let from = query_date(&params, "from")?;
    let to = query_date(&params, "to")?;
    check_range(from.as_deref(), to.as_deref())?;
    let limit = query_limit(&params)?;

    let query = HomeworkQuery {
        subject_id,
        from,
        to,
        limit,
    };
    let feed = HomeworkService::new(&state.db)
        .list(user.0.principal(), query_id(&params, "classId")?, &query)
        .await?;
    Ok(Json(feed))
}

/// `GET /api/homework/{id}`
///
/// 404 for an id in another class as well as for one that does not exist.
pub async fn get_one(
    State(state): State<AppState>,
    user: StudentUser,
    Path(raw): Path<String>,
) -> ApiResult<Json<HomeworkView>> {
    let id = crate::validate::path_id(&raw)?;
    let view = HomeworkService::new(&state.db)
        .get(user.0.principal(), id)
        .await?;
    Ok(Json(view))
}

/// Shared by the attachments and progress routes: "is this homework visible to this
/// student", answered with the same 404 the homework route would give.
pub(crate) async fn ensure_visible(
    state: &AppState,
    principal: &crate::services::auth::Principal,
    homework_id: i64,
) -> ApiResult<()> {
    HomeworkService::new(&state.db)
        .exists_for(principal, homework_id)
        .await
        .map(|_| ())
}
