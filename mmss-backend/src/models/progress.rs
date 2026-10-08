use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// One student's tick state for one homework entry. Absence of a row means not
/// completed, so nothing is written until a student actually ticks or unticks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct HomeworkProgress {
    pub id: i64,
    pub user_id: i64,
    pub homework_id: i64,
    pub completed: bool,
    pub created_at: i64,
    pub updated_at: i64,
}
