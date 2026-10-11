pub mod api;
pub mod auth;
pub mod bootstrap;
pub mod clock;
pub mod config;
pub mod cookies;
pub mod crypto;
pub mod devices;
pub mod error;
pub mod lifecycle_cli;
pub mod middleware;
pub mod models;
pub mod provisioning;
pub mod ratelimit;
pub mod repositories;
pub mod routes;
pub mod services;
pub mod state;
pub mod validate;

use axum::Router;
use state::AppState;

/// Builds the application router over shared state.
///
/// R9 moved the cross-cutting concerns into [`middleware::apply`]: request ids, a fail-closed
/// CORS allowlist, security headers, a deliberate body limit and the panic guard. They were
/// previously two layers on this function, which left the process with no request
/// correlation, no browser policy and an accidental 2 MiB body limit.
pub fn app(state: AppState) -> Router {
    let config = state.config.clone();
    let router = Router::new().merge(routes::router(state));
    middleware::apply(router, &config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    async fn test_state(tag: &str) -> AppState {
        // A unique directory per test and per run: reusing one path would make
        // these tests race each other and depend on the last run's schema.
        let url = format!(
            "sqlite://{}/mmss.db",
            std::env::temp_dir()
                .join(format!("mmss-test-app-{}-{tag}", std::process::id()))
                .display()
        );
        AppState::new(Config::for_tests(url)).await.unwrap()
    }

    #[tokio::test]
    async fn health_returns_ok() {
        let response = app(test_state("health").await)
            .oneshot(Request::get("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(body.as_ref(), br#"{"status":"ok"}"#);
    }

    #[tokio::test]
    async fn unknown_route_is_404() {
        let response = app(test_state("404").await)
            .oneshot(Request::get("/nope").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
