//! Vercel Function entry point: the MMSS64 backend behind `/api/preview/*`.
//!
//! Vercel's officially supported Rust runtime turns every `api/*.rs` file into a
//! function (see <https://vercel.com/docs/functions/runtimes/rust> and the Rust Axum
//! template). This adapter mounts the *existing* Axum application — the real router,
//! middleware stack, error envelopes, auth extractors and body limits from
//! `mmss_backend` — under the `/api/preview` prefix, so a preview deployment can
//! exercise the genuine API surface without touching the frontend's `/api/*`
//! traffic, which `vercel.json` still rewrites to the Azure VPS.
//!
//! Vercel Function instances have no persistent filesystem, so [`AppState::preview`]
//! hands the router a lazy database pool that can never open a file: `/health`
//! answers, `/metrics` reports process counters, `/ready` says 503, and every
//! database-backed route fails closed with the standard `500` envelope. No database
//! file is ever created and no login or session can survive the instance — the
//! preview is for API-shape testing, not for persistent authentication. See
//! `mmss-backend/DEPLOYMENT.md`, "Vercel preview deployments".
//!
//! Requests arrive as `/api/preview/<path>` (rewritten by `vercel.json` to this
//! function's own path) and are handed to the backend with the prefix stripped, so
//! the preview surface is exactly the backend's own route table.

use std::str::FromStr;

use axum::body::Body;
use axum::http::{Request, Uri};
use axum::response::Response;
use axum::Router;
use mmss_backend::{app, config::Config, state::AppState};
use tower::ServiceBuilder;
use tracing_subscriber::EnvFilter;
use vercel_runtime::axum::VercelLayer;
use vercel_runtime::{run, Error};

/// The prefixes this function may be invoked under.
///
/// `/api/preview` is the public contract. `/api/mmss` is the function's own path that
/// `vercel.json` rewrites to; stripping it too means routing does not depend on
/// whether Vercel hands over the original or the rewritten path.
const FUNCTION_PREFIXES: [&str; 2] = ["/api/preview", "/api/mmss"];

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let config = Config::from_env()
        .map_err(|error| Error::from(format!("configuration error: {error:#}")))?;

    let service = ServiceBuilder::new()
        .layer(VercelLayer::new())
        .service(preview_router(config));
    run(service).await
}

/// The backend router behind the function prefix.
///
/// `AppState::preview` is a lazy pool: no file, no migrations. A preview instance must
/// never bootstrap a disposable database it would then silently serve logins from.
fn preview_router(config: Config) -> Router {
    let state = AppState::preview(config);
    Router::new()
        .fallback_service(app(state))
        .layer(axum::middleware::from_fn(strip_function_prefix))
}

/// Rewrites `/api/preview/<path>` to `/<path>` before the backend router sees it.
async fn strip_function_prefix(
    mut request: Request<Body>,
    next: axum::middleware::Next,
) -> Response {
    let target = strip_prefix(request.uri()).map(|path| match request.uri().query() {
        Some(query) => format!("{path}?{query}"),
        None => path.to_owned(),
    });
    if let Some(target) = target {
        if let Ok(path_and_query) = axum::http::uri::PathAndQuery::from_str(&target) {
            let mut parts = request.uri().clone().into_parts();
            parts.path_and_query = Some(path_and_query);
            if let Ok(uri) = Uri::from_parts(parts) {
                *request.uri_mut() = uri;
            }
        }
    }
    next.run(request).await
}

/// `/api/preview/homework` -> `/homework`, `/api/preview` -> `/`.
///
/// A prefix only counts at a path-segment boundary, so `/api/previewfoo` is left alone.
fn strip_prefix(uri: &Uri) -> Option<&str> {
    let path = uri.path();
    FUNCTION_PREFIXES.iter().find_map(|prefix| {
        let rest = path.strip_prefix(prefix)?;
        (rest.is_empty() || rest.starts_with('/')).then_some(if rest.is_empty() {
            "/"
        } else {
            rest
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;
    use tower::ServiceExt;

    fn uri(path: &str) -> Uri {
        Uri::from_str(path).unwrap()
    }

    #[test]
    fn the_function_prefix_is_stripped_only_at_a_segment_boundary() {
        assert_eq!(strip_prefix(&uri("/api/preview/health")), Some("/health"));
        assert_eq!(strip_prefix(&uri("/api/preview")), Some("/"));
        assert_eq!(strip_prefix(&uri("/api/preview/")), Some("/"));
        assert_eq!(
            strip_prefix(&uri("/api/mmss/api/homework")),
            Some("/api/homework")
        );
        assert_eq!(strip_prefix(&uri("/api/previewfoo")), None);
        assert_eq!(strip_prefix(&uri("/health")), None);
    }

    /// The whole preview flow, minus only the Vercel request bridge: liveness answers,
    /// auth still rejects anonymous callers without a database, and a forged session
    /// fails closed instead of ever reading from a disposable database.
    #[tokio::test]
    async fn health_answers_and_database_routes_fail_closed_behind_the_prefix() {
        let router = preview_router(Config::for_tests("sqlite://./unused-preview.db"));

        let response = router
            .clone()
            .oneshot(
                Request::get("/api/preview/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let response = router
            .clone()
            .oneshot(
                Request::get("/api/preview/api/homework")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::UNAUTHORIZED,
            "no cookie must be refused without touching any database"
        );

        let response = router
            .oneshot(
                Request::get("/api/preview/api/homework")
                    .header("cookie", "app_session=forged")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::INTERNAL_SERVER_ERROR,
            "a session lookup with no database must fail closed, never succeed"
        );
    }
}
