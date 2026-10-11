//! Teacher homework routes.
//!
//! Thin by design, like every other route module: parse and validate the request,
//! hand it to [`TeacherHomeworkService`], shape a response. No SQL, no
//! authorization rules, no ownership checks -- taking [`AuthenticatedUser`] is the
//! authentication requirement, and the service owns everything after that.
//!
//! The prefix argument builds absolute paths rather than using `axum::nest`,
//! because `nest` followed by `merge` on a sibling router silently drops that
//! sibling in axum 0.8 (already hit and fixed in R4).

use axum::extract::{Path, Query, State};
use axum::Json;

use crate::api::{
    CreateHomeworkBody, TeacherHomeworkList, TeacherHomeworkView, UpdateHomeworkBody,
};
use crate::auth::AuthenticatedUser;
use crate::error::ApiResult;
use crate::services::teacher_homework::{TeacherHomeworkService, TeacherQuery};
use crate::state::AppState;
use crate::validate::{check_range, json_body, path_id, query_date, query_id, query_limit, Params};

/// Mounted by [`crate::routes`] under the shared `/api` prefix only. There is no
/// bare `/teacher` mount: no client calls that path, and a second mount of an
/// unrouted-looking prefix is a route that exists for no reason.
pub fn router(prefix: &str) -> axum::Router<AppState> {
    use axum::routing::get;
    axum::Router::new()
        .route(
            &format!("{prefix}/teacher/homework"),
            get(list).post(create),
        )
        .route(
            &format!("{prefix}/teacher/homework/{{id}}"),
            get(get_one).patch(update).delete(remove),
        )
}

fn service(db: &sqlx::SqlitePool) -> TeacherHomeworkService<'_> {
    TeacherHomeworkService::new(db)
}

/// `GET /api/teacher/homework`
///
/// Every filter is optional and all of them are validated before the query runs, so
/// an unparseable date is a 400 rather than a silently wider result set. Results are
/// scoped by the service to the classes this teacher may see.
pub async fn list(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    params: Query<Params>,
) -> ApiResult<Json<TeacherHomeworkList>> {
    let from = query_date(&params, "from")?;
    let to = query_date(&params, "to")?;
    check_range(from.as_deref(), to.as_deref())?;
    let query = TeacherQuery {
        class_id: query_id(&params, "classId")?,
        subject_id: query_id(&params, "subjectId")?,
        from,
        to,
        limit: query_limit(&params)?,
    };
    Ok(Json(
        service(&state.db).list(user.principal(), &query).await?,
    ))
}

/// `GET /api/teacher/homework/{id}`
///
/// 404 for an entry in a class this teacher does not teach.
pub async fn get_one(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(raw): Path<String>,
) -> ApiResult<Json<TeacherHomeworkView>> {
    let id = path_id(&raw)?;
    Ok(Json(service(&state.db).get(user.principal(), id).await?))
}

/// `POST /api/teacher/homework`
///
/// 201 with the created entry. The response is the full view rather than a bare id
/// so a teacher frontend can render what it just wrote without a second round trip
/// -- and so the author in the response is visibly the session user.
pub async fn create(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    body: axum::body::Bytes,
) -> ApiResult<(axum::http::StatusCode, Json<TeacherHomeworkView>)> {
    // Decoded here, not with `Json<T>`, so a malformed body is the same clean 400 as
    // a missing field rather than axum's 422 carrying the parser's message.
    let parsed: CreateHomeworkBody = json_body(
        &body,
        "Expected a JSON body with classId, subjectId and dueDate.",
    )?;
    let created = service(&state.db).create(user.principal(), &parsed).await?;
    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

/// `PATCH /api/teacher/homework/{id}`
///
/// Partial by omission: fields left out are unchanged, `null` clears, a value is
/// validated and written. Only the author (or an admin) may reach this.
pub async fn update(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(raw): Path<String>,
    body: axum::body::Bytes,
) -> ApiResult<Json<TeacherHomeworkView>> {
    let id = path_id(&raw)?;
    let parsed: UpdateHomeworkBody =
        json_body(&body, "Expected a JSON body with the fields to change.")?;
    Ok(Json(
        service(&state.db)
            .update(user.principal(), id, &parsed)
            .await?,
    ))
}

/// `DELETE /api/teacher/homework/{id}`
///
/// 200 with `{"success": true}`, matching every other write in this API. The entry's
/// attachments, notes and progress go with it via the R2 cascades.
pub async fn remove(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(raw): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let id = path_id(&raw)?;
    service(&state.db).delete(user.principal(), id).await?;
    Ok(Json(serde_json::json!({ "success": true })))
}
