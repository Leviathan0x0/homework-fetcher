pub mod ai;
pub mod attachments;
pub mod auth;
pub mod compat;
pub mod edusecure;
pub mod health;
pub mod homework;
pub mod notes;
pub mod progress;
pub mod subjects;
pub mod teacher_homework;

use axum::Router;

use crate::state::AppState;

/// The prefix the existing client calls. `vercel.json` rewrites `/api/:path*` through to
/// this process without stripping the prefix, so `/api/*` is where the frontend's
/// requests actually arrive.
pub const API_PREFIX: &str = "/api";

/// The whole HTTP surface.
///
/// Auth is served twice, at `/auth/*` and at `/api/auth/*`, because R3 shipped it at
/// `/auth/*` and is frozen while the frontend calls `/api/auth/*`. Every module builds
/// its routes from a prefix string rather than being `nest`ed, because `nest` followed by
/// `merge` on the same router drops the sibling mount in axum 0.8 -- and an explicit
/// prefix makes the two mounts visible in one place anyway.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", axum::routing::get(health::health))
        .route("/ready", axum::routing::get(health::ready))
        .route("/metrics", axum::routing::get(health::metrics))
        .merge(auth::router("/auth"))
        .merge(auth::router(&format!("{API_PREFIX}/auth")))
        .merge(api_router())
        // Every registered route answers a client error as `{error, code}`, but an
        // *unmatched* route used to answer 404 with no body at all. The frontend parses JSON
        // unconditionally, so a missing body silently became an empty object with no `code`
        // -- an error shape the client could not tell apart from any other. R10 makes the
        // 404 speak the same envelope as everything else.
        .fallback(not_found)
        .with_state(state)
}

/// The fallback for a route that does not exist.
///
/// Same shape as [`crate::error::ApiError::not_found`], produced without going through an
/// extractor, so it works for any method and any path.
async fn not_found() -> crate::error::ApiError {
    crate::error::ApiError::not_found("That endpoint does not exist.")
}

/// Everything the student client uses, under one prefix.
fn api_router() -> Router<AppState> {
    let prefix = API_PREFIX;
    Router::new()
        .merge(homework::router(prefix))
        .merge(attachments::router(prefix))
        .merge(subjects::router(prefix))
        .merge(notes::router(prefix))
        .merge(progress::router(prefix))
        .merge(teacher_homework::router(prefix))
        .merge(compat::router(prefix))
        // The AI layer is assistive and optional. Registered unconditionally so turning it
        // on never needs a rebuild; with no credentials every call answers 503 and the rest
        // of the app is untouched.
        .merge(ai::router(prefix))
        // The EduSecure integration is optional and administrator-only, but its routes
        // are always registered: a deployment that turns the integration on must not also
        // need a rebuild, and a deployment that leaves it off gets a clear 503 rather
        // than a 404 it would have to interpret.
        .merge(edusecure::router(prefix))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;
    use tower::ServiceExt;

    /// The route table is the contract, so it is asserted rather than assumed. A route
    /// that silently stops being registered is the kind of break no unit test catches.
    #[tokio::test]
    async fn every_expected_route_is_registered() {
        let app = crate::app(test_state("routes").await);

        for path in [
            "/health",
            "/auth/login",
            "/auth/logout",
            "/auth/me",
            "/auth/profile",
            "/api/auth/login",
            "/api/auth/logout",
            "/api/auth/me",
            "/api/auth/profile",
            "/api/homework",
            "/api/subjects",
            "/api/notes",
            "/api/progress",
            "/api/teacher/homework",
            "/api/teacher/homework/1",
        ] {
            // A GET on a POST-only route answers 405, which still proves the route
            // exists. Only 404 means it is missing.
            let status = app
                .clone()
                .oneshot(
                    axum::http::Request::get(path)
                        .body(axum::body::Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap()
                .status();
            assert_ne!(status, StatusCode::NOT_FOUND, "{path} is not registered");
        }

        // The student data routes are behind the session extractor, so a request with no
        // cookie is 401 rather than 404 -- registered *and* protected.
        for path in [
            "/api/homework",
            "/api/subjects",
            "/api/notes",
            "/api/progress",
            "/api/teacher/homework",
        ] {
            let status = app
                .clone()
                .oneshot(
                    axum::http::Request::get(path)
                        .body(axum::body::Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap()
                .status();
            assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}");
        }

        // `/auth/profile` needs its own request, because a GET on a PATCH-only route is
        // a 405 -- which would say nothing about whether the route is protected.
        //
        // The declared content type is part of the request: `routes::auth` refuses a
        // state-changing request that does not declare JSON, which is the CSRF guard,
        // and that 415 would otherwise mask the 401 this test is actually about.
        let status = app
            .clone()
            .oneshot(
                axum::http::Request::patch("/api/auth/profile")
                    .header("content-type", "application/json")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap()
            .status();
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "/api/auth/profile must be registered and session-guarded"
        );
    }

    async fn test_state(tag: &str) -> AppState {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        AppState::new(crate::config::Config::for_tests(format!(
            "sqlite://{}/mmss.db",
            std::env::temp_dir()
                .join(format!("mmss-routes-{tag}-{unique}"))
                .display()
        )))
        .await
        .unwrap()
    }
}
