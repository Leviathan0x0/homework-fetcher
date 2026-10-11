//! Compatibility aliases for the two homework URLs the shipped client already calls.
//!
//! These are not a second implementation. Each is a shim that validates and delegates to
//! the same service call as its REST equivalent, kept because
//! `homeworkService.toggleCompleted` and `homeworkService.updateNote` in
//! `src/services/api.ts` hardcode these exact paths. When the frontend is switched to
//! the new API, this file can be deleted in one commit.
//!
//! `PATCH /api/homework/{id}/status` -> `PATCH /api/progress/{id}`
//! `PATCH /api/homework/{id}/note`   -> `POST   /api/notes/homework/{id}`
//!
//! One difference from the old behaviour, deliberately: `{"note": null}` used to clear a
//! note. A `null` body now means "delete it", which is the same outcome through the
//! endpoint the client actually used.

use axum::extract::{Path, State};
use axum::Json;

use crate::api::{CompletionBody, LegacyNoteBody, ProgressView};
use crate::auth::StudentUser;
use crate::error::ApiResult;
use crate::routes::homework::ensure_visible;
use crate::services::auth::Principal;
use crate::services::notes::NotesService;
use crate::services::progress::ProgressService;
use crate::state::AppState;
use crate::validate::{json_body, path_id, text_body, MAX_NOTE_LEN};

pub fn router(prefix: &str) -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            &format!("{prefix}/homework/{{id}}/status"),
            axum::routing::patch(set_status),
        )
        .route(
            &format!("{prefix}/homework/{{id}}/note"),
            axum::routing::patch(set_note),
        )
}

/// Alias for `PATCH /api/progress/{id}`.
async fn set_status(
    State(state): State<AppState>,
    user: StudentUser,
    Path(raw): Path<String>,
    body: axum::body::Bytes,
) -> ApiResult<Json<ProgressView>> {
    let homework_id = path_id(&raw)?;
    ensure_visible(&state, user.0.principal(), homework_id).await?;
    let parsed: CompletionBody = json_body(&body, "Expected a JSON body with a completed flag.")?;
    Ok(Json(
        ProgressService::new(&state.db)
            .set_completed(user.0.principal(), homework_id, parsed.completed)
            .await?,
    ))
}

/// Alias for `POST /api/notes/homework/{id}`, plus the legacy "null clears it".
///
/// The old endpoint answered `{success, note}`; the new one answers the note. The client
/// only checks `res.ok` on this call, so the body shape is free to be the honest one.
async fn set_note(
    State(state): State<AppState>,
    user: StudentUser,
    Path(raw): Path<String>,
    body: axum::body::Bytes,
) -> ApiResult<Json<serde_json::Value>> {
    let homework_id = path_id(&raw)?;
    let principal: &Principal = user.0.principal();
    ensure_visible(&state, principal, homework_id).await?;

    let parsed: LegacyNoteBody = json_body(&body, "Expected a JSON body with a note.")?;
    let service = NotesService::new(&state.db);

    let Some(note) = parsed.note else {
        // Clearing: delete the note if there is one. Already absent is a success, so
        // the client's "save an empty box" stays idempotent.
        if let Some(existing) =
            crate::repositories::notes::find_for_homework(&state.db, user.user_id(), homework_id)
                .await?
        {
            crate::repositories::notes::delete(&state.db, existing.id).await?;
        }
        return Ok(Json(serde_json::json!({ "success": true, "note": null })));
    };

    let note = service
        .set_for_homework(
            principal,
            homework_id,
            text_body(&note, "note", MAX_NOTE_LEN)?,
        )
        .await?;
    Ok(Json(
        serde_json::json!({ "success": true, "note": note.body }),
    ))
}
