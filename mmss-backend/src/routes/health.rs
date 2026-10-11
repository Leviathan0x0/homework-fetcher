//! Liveness, readiness and operational counters.
//!
//! These are three different questions and R9 split them, because the old single endpoint
//! answered all three badly.
//!
//! * `/health` -- **liveness**: is this process running? It touches no dependency, so a
//!   slow database can never cause an orchestrator to kill an otherwise healthy process and
//!   restart it into the same slow database.
//! * `/ready` -- **readiness**: should this process receive traffic? It checks the database
//!   and returns **503** when the database is unusable.
//! * `/metrics` -- counters, in Prometheus text format, for a scraper.
//!
//! The bug this fixes: `/health` previously ran `SELECT 1` and returned `200 OK` with
//! `"status": "degraded"` when the query failed. A load balancer reads the status code, so a
//! process that cannot reach its database was reported as healthy and kept receiving traffic.
//! A degraded body on a 200 is invisible to the only thing that decides where to send
//! requests.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Serialize;

use crate::middleware;
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub status: &'static str,
}

/// `GET /health` -- liveness only.
///
/// Deliberately does not touch the database. "Am I running?" and "can I serve?" are
/// different questions with different right answers during an outage.
pub async fn health() -> Json<Health> {
    Json(Health { status: "ok" })
}

/// `GET /ready` -- readiness, including the database.
///
/// 200 when the database answers, **503 when it does not**, so a load balancer stops sending
/// traffic here. The body never says what went wrong: a readiness probe is unauthenticated,
/// and a database error message is exactly the kind of internal detail that must not be
/// readable by anyone who can reach the port.
pub async fn ready(State(state): State<AppState>) -> impl IntoResponse {
    let database_ok = sqlx::query_scalar::<_, i64>("SELECT 1")
        .fetch_one(&state.db)
        .await
        .is_ok();

    let (status, body) = if database_ok {
        (StatusCode::OK, Health { status: "ok" })
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Health {
                status: "unavailable",
            },
        )
    };
    (status, Json(body))
}

/// `GET /metrics` -- Prometheus text format.
///
/// Three process-local counters and the pool's own size, which is the whole operational
/// question for a single-writer SQLite deployment: are requests succeeding, and is anything
/// stuck holding the database.
///
/// No labels on the paths. A per-path label would let an unauthenticated caller inflate a
/// time-series database with arbitrary URL segments, which is a denial-of-service in
/// everything but name.
pub async fn metrics(State(state): State<AppState>) -> impl IntoResponse {
    let (requests, errors, in_flight) = middleware::snapshot();
    let body = format!(
        "# HELP mmss_requests_total Requests received since start.\n\
         # TYPE mmss_requests_total counter\n\
         mmss_requests_total {requests}\n\
         # HELP mmss_errors_total Responses with a 5xx status.\n\
         # TYPE mmss_errors_total counter\n\
         mmss_errors_total {errors}\n\
         # HELP mmss_requests_in_flight Requests currently being served.\n\
         # TYPE mmss_requests_in_flight gauge\n\
         mmss_requests_in_flight {in_flight}\n\
         # HELP mmss_db_pool_connections Connections currently open in the pool.\n\
         # TYPE mmss_db_pool_connections gauge\n\
         mmss_db_pool_connections {}\n\
         # HELP mmss_db_pool_idle Connections idle in the pool.\n\
         # TYPE mmss_db_pool_idle gauge\n\
         mmss_db_pool_idle {}\n",
        state.db.size(),
        state.db.num_idle(),
    );
    (
        StatusCode::OK,
        [(
            axum::http::header::CONTENT_TYPE,
            "text/plain; version=0.0.4",
        )],
        body,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;

    async fn state(tag: &str) -> AppState {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        AppState::new(Config::for_tests(format!(
            "sqlite://{}/mmss-{tag}.db",
            std::env::temp_dir()
                .join(format!("mmss-test-health-{}-{unique}", std::process::id()))
                .display()
        )))
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn liveness_is_ok_and_readiness_is_ok_against_a_working_database() {
        let state = state("ready-ok").await;
        let response = ready(State(state)).await.into_response();
        assert_eq!(response.status(), StatusCode::OK);

        let Json(health) = health().await;
        assert_eq!(health.status, "ok");
    }

    #[tokio::test]
    async fn readiness_turns_503_when_the_database_is_gone() {
        let state = state("ready-broken").await;
        // Close the pool underneath the probe. This is the outage case the old `/health`
        // answered with 200 and "degraded".
        state.db.close().await;

        let response = ready(State(state)).await.into_response();
        assert_eq!(
            response.status(),
            StatusCode::SERVICE_UNAVAILABLE,
            "a process that cannot reach its database must not report itself ready"
        );
    }

    #[tokio::test]
    async fn metrics_are_prometheus_shaped_and_carry_no_path_labels() {
        let state = state("metrics").await;
        let response = metrics(State(state)).await.into_response();
        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let text = String::from_utf8(body.to_vec()).unwrap();

        for expected in [
            "mmss_requests_total",
            "mmss_errors_total",
            "mmss_requests_in_flight",
            "mmss_db_pool_connections",
        ] {
            assert!(text.contains(expected), "missing {expected} in:\n{text}");
        }
        assert!(
            !text.contains("path="),
            "a per-path label would let a caller inflate a time-series database:\n{text}"
        );
    }
}
