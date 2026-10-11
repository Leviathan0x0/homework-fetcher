//! Shared application state. Cloned cheaply into each handler via Axum's
//! `State` extractor; add services to `AppState` as phases need them.

use std::path::Path;
use std::str::FromStr;

use anyhow::{Context, Result};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
use std::sync::Arc;
use tracing::debug;

use crate::config::Config;
use crate::ratelimit::RateLimiter;

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub db: SqlitePool,
    /// Abuse protection for the password-taking endpoints.
    ///
    /// Held here rather than in a `static` so each `AppState` -- and therefore each
    /// test -- gets its own counts. A process-wide limiter would let one test's login
    /// attempts lock out a later test in the same binary, which is a confusing failure
    /// that looks like a product bug.
    pub limiter: Arc<RateLimiter>,
}

impl AppState {
    pub async fn new(config: Config) -> Result<Self> {
        let db = connect(&config.database_url).await?;
        sqlx::migrate!("./migrations")
            .run(&db)
            .await
            .context("failed to run database migrations")?;
        Ok(Self {
            config,
            db,
            limiter: Arc::new(RateLimiter::default()),
        })
    }

    /// A state for environments with no persistent filesystem, such as a Vercel
    /// preview function.
    ///
    /// The pool is **lazy** and points at a path that can never be opened, so this
    /// constructor creates no file and runs no migrations: liveness (`/health`) and
    /// the process counters (`/metrics`) keep answering, `/ready` reports 503, and
    /// every database-backed request fails with the standard 500 envelope instead of
    /// silently reading and writing a disposable per-instance database that vanishes
    /// on the next cold start. Sessions and logins therefore cannot work here, which
    /// is the honest answer for a filesystem-less deployment.
    ///
    /// `DATABASE_URL` is ignored on purpose: no configured path is safe to open from
    /// an instance that does not own its storage.
    pub fn preview(config: Config) -> Self {
        // `/dev/null` is a file, so `/dev/null/mmss.db` can never exist (ENOTDIR) on
        // any unix target, and the pool has `create_if_missing` off.
        let options = SqliteConnectOptions::from_str("sqlite:////dev/null/mmss.db")
            .expect("the preview database URL is a constant");
        let db = SqlitePoolOptions::new().connect_lazy_with(options);
        Self {
            config,
            db,
            limiter: Arc::new(RateLimiter::default()),
        }
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
                "account lifecycle",
                "account security"
            ]
        );
    }

    #[tokio::test]
    async fn preview_state_never_creates_a_database_and_fails_queries_loudly() {
        let state = AppState::preview(Config::for_tests("sqlite://./should-never-be-created.db"));

        // No file, not even the configured one: the preview pool must not touch a disk.
        assert!(!Path::new("./should-never-be-created.db").exists());

        // The pool refuses a connection instead of inventing a disposable database.
        let result = sqlx::query_scalar::<_, i64>("SELECT 1")
            .fetch_one(&state.db)
            .await;
        assert!(
            result.is_err(),
            "a preview query must fail loudly, never serve from an empty database"
        );
    }
}
