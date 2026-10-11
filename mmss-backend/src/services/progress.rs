//! Student completion state.
//!
//! Progress is always the signed-in student's, derived from the principal rather than a
//! parameter. Ticking the same box twice is the same state, not an error, which is what
//! the repository's upsert gives us.

use sqlx::SqlitePool;

use crate::api::ProgressView;
use crate::error::ApiResult;
use crate::models::HomeworkProgress;
use crate::repositories::progress as progress_repo;
use crate::services::auth::Principal;

pub struct ProgressService<'a> {
    db: &'a SqlitePool,
}

impl<'a> ProgressService<'a> {
    pub fn new(db: &'a SqlitePool) -> Self {
        Self { db }
    }

    /// Marks an entry done or not done. Idempotent.
    pub async fn set_completed(
        &self,
        principal: &Principal,
        homework_id: i64,
        completed: bool,
    ) -> ApiResult<ProgressView> {
        let row = progress_repo::set_completed(self.db, principal.user_id, homework_id, completed)
            .await?;
        Ok(view(&row))
    }

    /// The student's state for one entry. No row means not done, so a student who has
    /// never ticked anything gets an answer rather than a 404.
    pub async fn get(&self, principal: &Principal, homework_id: i64) -> ApiResult<ProgressView> {
        Ok(
            match progress_repo::find(self.db, principal.user_id, homework_id).await? {
                Some(row) => view(&row),
                None => ProgressView {
                    homework_id,
                    completed: false,
                    updated_at: 0,
                },
            },
        )
    }

    /// Every tick this student has made.
    pub async fn list(&self, principal: &Principal) -> ApiResult<Vec<ProgressView>> {
        Ok(progress_repo::list_by_user(self.db, principal.user_id)
            .await?
            .iter()
            .map(view)
            .collect())
    }
}

fn view(row: &HomeworkProgress) -> ProgressView {
    ProgressView {
        homework_id: row.homework_id,
        completed: row.completed,
        updated_at: row.updated_at,
    }
}
