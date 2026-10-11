//! Student notes.
//!
//! Ownership is never a request parameter. A note id is looked up and then checked against
//! the signed-in student, so there is no route shape that can reach another student's
//! note.

use axum::extract::{Path, State};
use axum::Json;

use crate::api::{CreateNoteBody, NoteBody, NoteView};
use crate::auth::StudentUser;
use crate::error::ApiResult;
use crate::routes::homework::ensure_visible;
use crate::services::notes::NotesService;
use crate::state::AppState;
use crate::validate::{json_body, path_id, text_body, MAX_NOTE_LEN};

pub fn router(prefix: &str) -> axum::Router<AppState> {
    use axum::routing::{get, patch};
    axum::Router::new()
        .route(&format!("{prefix}/notes"), get(list).post(create))
        .route(
            &format!("{prefix}/notes/{{id}}"),
            patch(update).delete(remove),
        )
        .route(
            &format!("{prefix}/notes/homework/{{homeworkId}}"),
            get(list_for_homework).post(set_for_homework),
        )
}

fn service(db: &sqlx::SqlitePool) -> NotesService<'_> {
    NotesService::new(db)
}

/// `GET /api/notes` -- every note this student owns, both kinds, newest first.
pub async fn list(
    State(state): State<AppState>,
    user: StudentUser,
) -> ApiResult<Json<Vec<NoteView>>> {
    Ok(Json(service(&state.db).list(user.0.principal()).await?))
}

/// `GET /api/notes/homework/{homeworkId}` -- only the notes on one entry.
///
/// The homework is checked against the student's class first, so this cannot be used to
/// learn whether another class's entry exists.
pub async fn list_for_homework(
    State(state): State<AppState>,
    user: StudentUser,
    Path(raw): Path<String>,
) -> ApiResult<Json<Vec<NoteView>>> {
    let homework_id = path_id(&raw)?;
    ensure_visible(&state, user.0.principal(), homework_id).await?;
    Ok(Json(
        service(&state.db)
            .list_for_homework(user.0.principal(), homework_id)
            .await?,
    ))
}

/// `POST /api/notes` -- a personal note, not attached to any entry.
///
/// 201 because it is a creation, unlike the in-place edit below.
pub async fn create(
    State(state): State<AppState>,
    user: StudentUser,
    body: axum::body::Bytes,
) -> ApiResult<(axum::http::StatusCode, Json<NoteView>)> {
    let parsed: CreateNoteBody = json_body(&body, "Expected a JSON body with a note body.")?;
    let note = service(&state.db)
        .create_personal(
            user.0.principal(),
            text_body(&parsed.body, "note", MAX_NOTE_LEN)?,
        )
        .await?;
    Ok((axum::http::StatusCode::CREATED, Json(note)))
}

/// `POST /api/notes/homework/{homeworkId}` -- create or replace the note on one entry.
///
/// An upsert, because the client edits a note in place and the schema promises one note
/// per entry.
pub async fn set_for_homework(
    State(state): State<AppState>,
    user: StudentUser,
    Path(raw): Path<String>,
    body: axum::body::Bytes,
) -> ApiResult<Json<NoteView>> {
    let homework_id = path_id(&raw)?;
    ensure_visible(&state, user.0.principal(), homework_id).await?;
    let parsed: NoteBody = json_body(&body, "Expected a JSON body with a note body.")?;
    let body = text_body(&parsed.body, "note", MAX_NOTE_LEN)?;
    let note = service(&state.db)
        .set_for_homework(user.0.principal(), homework_id, body)
        .await?;
    Ok(Json(note))
}

/// `PATCH /api/notes/{id}` -- replace a note's body. Another student's note id is a 404.
pub async fn update(
    State(state): State<AppState>,
    user: StudentUser,
    Path(raw): Path<String>,
    body: axum::body::Bytes,
) -> ApiResult<Json<NoteView>> {
    let id = path_id(&raw)?;
    let parsed: NoteBody = json_body(&body, "Expected a JSON body with a note body.")?;
    let body = text_body(&parsed.body, "note", MAX_NOTE_LEN)?;
    Ok(Json(
        service(&state.db)
            .update(user.0.principal(), id, body)
            .await?,
    ))
}

/// `DELETE /api/notes/{id}`
///
/// 200 with `{"success": true}` rather than 204, matching every other write in this API
/// and keeping the response shape uniform.
pub async fn remove(
    State(state): State<AppState>,
    user: StudentUser,
    Path(raw): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    service(&state.db)
        .delete(user.0.principal(), path_id(&raw)?)
        .await?;
    Ok(Json(serde_json::json!({ "success": true })))
}
