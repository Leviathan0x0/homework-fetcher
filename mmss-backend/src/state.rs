//! Shared application state. Cloned cheaply into each handler via Axum's
//! `State` extractor; add services to `AppState` as phases need them.

use std::path::Path;

use anyhow::{Context, Result};
use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use tracing::debug;

use crate::config::Config;

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub db: SqlitePool,
}

impl AppState {
    pub async fn new(config: Config) -> Result<Self> {
        let db = connect(&config.database_url).await?;
        sqlx::migrate!("./migrations")
            .run(&db)
            .await
            .context("failed to run database migrations")?;
        Ok(Self { config, db })
    }
}

/// Opens a SQLite pool, creating the parent directory if the URL is a file path.
async fn connect(database_url: &str) -> Result<SqlitePool> {
    let options = database_url
        .parse::<SqliteConnectOptions>()
        .context("DATABASE_URL is not a valid SQLite URL")?
        .create_if_missing(true)
        .foreign_keys(true)
        .busy_timeout(std::time::Duration::from_secs(5))
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);

    if let Some(dir) = parent_dir(database_url) {
        std::fs::create_dir_all(dir)
            .with_context(|| format!("failed to create database directory {dir:?}"))?;
    }
    debug!(database_url, "connecting to database");
    SqlitePool::connect_with(options)
        .await
        .context("failed to connect to database")
}

/// `sqlite://./data/mmss.db` -> `data`
fn parent_dir(database_url: &str) -> Option<&str> {
    let path = Path::new(database_url.strip_prefix("sqlite://")?).parent()?;
    match path.to_str() {
        Some(dir) if !dir.is_empty() => Some(dir),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parent_dir_is_extracted() {
        assert_eq!(parent_dir("sqlite://./data/mmss.db"), Some("./data"));
        assert_eq!(parent_dir("sqlite://mmss.db"), None);
        assert_eq!(parent_dir("sqlite::memory:"), None);
    }

    #[tokio::test]
    async fn connects_creates_dir_and_runs_migrations() {
        let dir = std::env::temp_dir().join("mmss-backend-test-db");
        let _ = std::fs::remove_dir_all(&dir);
        let url = format!("sqlite://{}/mmss.db", dir.display());

        let state = AppState::new(Config::for_tests(url)).await.unwrap();

        assert!(dir.join("mmss.db").exists());
        // Every migration in `migrations/`, applied by startup alone. The count is
        // asserted rather than the names so that adding a migration is a deliberate
        // edit here too, instead of silently drifting.
        let applied: Vec<String> =
            sqlx::query_scalar("SELECT description FROM _sqlx_migrations ORDER BY version")
                .fetch_all(&state.db)
                .await
                .unwrap();
        assert_eq!(
            applied,
            [
                "initial schema",
                "auth",
                "teacher classes",
                "edusecure publications",
                "account lifecycle"
            ]
        );
    }
}
