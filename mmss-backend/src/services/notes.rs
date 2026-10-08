//! Student notes.
//!
//! Two kinds, and they stay distinguishable: a note about the student themselves
//! (`homework_id` null) and a note on one homework entry. Ownership is never a
//! parameter here -- it comes from the principal -- so there is no way for a caller to
//! reach another student's notes by passing an id.

use sqlx::SqlitePool;

use crate::api::NoteView;
use crate::error::{ApiError, ApiResult};
use crate::models::NewNote;
use crate::repositories::notes as notes_repo;
use crate::services::auth::Principal;

pub struct NotesService<'a> {
    db: &'a SqlitePool,
}

impl<'a> NotesService<'a> {
    pub fn new(db: &'a SqlitePool) -> Self {
        Self { db }
    }

    /// The student's own notes, newest first, both kinds together.
    pub async fn list(&self, principal: &Principal) -> ApiResult<Vec<NoteView>> {
        Ok(notes_repo::list_by_user(self.db, principal.user_id)
            .await?
            .iter()
            .map(NoteView::from)
            .collect())
    }

    /// Only the notes attached to homework.
    pub async fn list_for_homework(
        &self,
        principal: &Principal,
        homework_id: i64,
    ) -> ApiResult<Vec<NoteView>> {
        Ok(
            notes_repo::list_by_user_and_homework(self.db, principal.user_id, &[homework_id])
                .await?
                .iter()
                .map(NoteView::from)
                .collect(),
        )
    }

    /// Creates a personal note, not attached to any entry.
    ///
    /// Takes the body, not a `NewNote`, so the owner is decided here rather than by the
    /// caller. A signature that accepted a user id would be one refactor away from
    /// letting a request write into somebody else's notes.
    pub async fn create_personal(
        &self,
        principal: &Principal,
        body: String,
    ) -> ApiResult<NoteView> {
        let note = notes_repo::create(
            self.db,
            &NewNote {
                user_id: principal.user_id,
                homework_id: None,
                body,
            },
        )
        .await?;
        Ok(NoteView::from(&note))
    }

    /// Creates or replaces the student's note on one entry.
    ///
    /// An upsert rather than a create, because the client edits a note in place and
    /// `UNIQUE (user_id, homework_id)` already promises one per entry. It is a single
    /// statement, so two concurrent edits of the same note cannot both decide the note
    /// does not exist yet and collide on the unique index -- see
    /// [`notes_repo::upsert_for_homework`]. Replacing the body keeps `created_at`, which
    /// is what makes it an edit rather than a new note.
    pub async fn set_for_homework(
        &self,
        principal: &Principal,
        homework_id: i64,
        body: String,
    ) -> ApiResult<NoteView> {
        let note =
            notes_repo::upsert_for_homework(self.db, principal.user_id, homework_id, &body).await?;
        Ok(NoteView::from(&note))
    }

    /// Replaces a note's body. Scoped to the owner, so another student's note id is a
    /// 404 rather than an edit.
    pub async fn update(
        &self,
        principal: &Principal,
        note_id: i64,
        body: String,
    ) -> ApiResult<NoteView> {
        let note = self.owned(principal, note_id).await?;
        let updated = notes_repo::update(self.db, note.id, &body).await?;
        Ok(NoteView::from(&updated.ok_or_else(|| {
            ApiError::not_found("That note was not found.")
        })?))
    }

    /// Deletes a note. Scoped to the owner, and idempotent: a note that is already gone is
    /// a 404, which is what a second delete gets.
    pub async fn delete(&self, principal: &Principal, note_id: i64) -> ApiResult<()> {
        let note = self.owned(principal, note_id).await?;
        notes_repo::delete(self.db, note.id).await?;
        Ok(())
    }

    /// Reads a note the caller owns.
    async fn owned(&self, principal: &Principal, note_id: i64) -> ApiResult<crate::models::Note> {
        let note = notes_repo::find_by_id(self.db, note_id)
            .await?
            .ok_or_else(|| ApiError::not_found("That note was not found."))?;
        if note.user_id != principal.user_id {
            // 404, not 403: confirming that the id belongs to someone else is itself a
            // disclosure about another account.
            return Err(ApiError::not_found("That note was not found."));
        }
        Ok(note)
    }
}
