//! Cross-cutting HTTP concerns: request identity, browser policy, response headers, and
//! the counters that `/metrics` reports.
//!
//! Everything here is a layer on the whole router rather than something a handler opts
//! into, because a protection that only applies where somebody remembered to add it is not
//! a protection.
//!
//! The layering order is documented on [`apply`], and it is subtle enough to get wrong.

use std::sync::atomic::{AtomicU64, Ordering};

use axum::http::{HeaderName, HeaderValue, Request};
use axum::response::{IntoResponse, Response};
use tower_http::{
    catch_panic::CatchPanicLayer,
    cors::{AllowOrigin, CorsLayer},
    request_id::{MakeRequestId, PropagateRequestIdLayer, RequestId, SetRequestIdLayer},
    trace::TraceLayer,
};

use crate::config::Config;

/// Response header carrying the request id, echoed to the caller so a support report can
/// quote it. Also added to the CORS allow-list, or a cross-origin caller could never see it.
pub const REQUEST_ID_HEADER: &str = "x-request-id";

/// Counters exposed on `/metrics`. Deliberately fixed and process-local.
///
/// These are not a metrics backend and there is no time-series store: what a deployment
/// actually needs here is "are requests succeeding, and is the database answering", and both
/// are one `curl` away with these three numbers. Adding a registry would be heavier than the
/// question being asked.
static REQUESTS: AtomicU64 = AtomicU64::new(0);
static ERRORS: AtomicU64 = AtomicU64::new(0);
static IN_FLIGHT: AtomicU64 = AtomicU64::new(0);

pub fn snapshot() -> (u64, u64, u64) {
    (
        REQUESTS.load(Ordering::Relaxed),
        ERRORS.load(Ordering::Relaxed),
        IN_FLIGHT.load(Ordering::Relaxed),
    )
}

/// A request id that the process mints itself.
///
/// Uses the same operating-system entropy as the session token, so there is no new
/// dependency and no new failure mode: if the CSPRNG is unavailable, generating a request id
/// fails exactly as minting a session does. A request id is not a secret, so it is truncated
/// hex rather than anything base64.
#[derive(Clone, Copy)]
struct ProcessRequestId;

impl MakeRequestId for ProcessRequestId {
    fn make_request_id<B>(&mut self, _request: &Request<B>) -> Option<RequestId> {
        let mut bytes = [0u8; 16];
        // A request id is never load-bearing, so an entropy failure must not take a request
        // down with it; it just means this response has no id to correlate.
        if getrandom::fill(&mut bytes).is_err() {
            return None;
        }
        let hex: String = bytes
            .iter()
            .fold(String::with_capacity(32), |mut out, byte| {
                out.push(char::from_digit((*byte >> 4) as u32, 16).unwrap_or('0'));
                out.push(char::from_digit((*byte & 0x0f) as u32, 16).unwrap_or('0'));
                out
            });
        HeaderValue::from_str(&hex).ok().map(RequestId::new)
    }
}

/// A fresh id for every request, ignoring any the caller sent.
///
/// Honouring a client-supplied id would let a caller pin the same id on every request, which
/// makes the correlation worthless exactly when it is needed -- during an incident. The id
/// is for *our* logs, not for the caller's.
fn set_request_id() -> SetRequestIdLayer<ProcessRequestId> {
    SetRequestIdLayer::new(HeaderName::from_static(REQUEST_ID_HEADER), ProcessRequestId)
}

/// The CORS policy: an allowlist, or nothing.
///
/// With an empty allowlist no origin matches, so no `Access-Control-Allow-Origin` is ever
/// emitted and a browser refuses the response. That is the correct default here rather than
/// a missing feature, because the shipped deployment reaches this API same-origin through
/// the `vercel.json` rewrite. Credentials are allowed because the API is cookie
/// authenticated -- which is only safe alongside a non-wildcard allowlist, which is why
/// `allow_credentials` is never combined with `Any`.
fn cors(config: &Config) -> CorsLayer {
    let mut origins: Vec<HeaderValue> = config
        .allowed_origins
        .iter()
        .filter_map(|origin| HeaderValue::from_str(origin.trim()).ok())
        .collect();
    // Duplicates in the variable would be harmless but noisy; sorting also makes the
    // generated layer deterministic, which keeps tests honest.
    origins.sort();
    origins.dedup();

    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::PATCH,
            axum::http::Method::PUT,
            axum::http::Method::DELETE,
            axum::http::Method::OPTIONS,
        ])
        .allow_headers([axum::http::header::CONTENT_TYPE, axum::http::header::ACCEPT])
        .allow_credentials(true)
        // A preflight has to be able to read the id back, or cross-origin error reports
        // lose their correlation.
        .expose_headers([HeaderName::from_static(REQUEST_ID_HEADER)])
}

/// Headers added to every response, including error responses.
///
/// Chosen for what is true of this application rather than applied wholesale:
/// * `nosniff` -- the API returns JSON and an attachment's `mimeType` is attacker-supplied
///   metadata, so a browser must never be left to guess a type;
/// * `DENY` framing -- there is nothing here to frame, and this is a cookie-authenticated
///   API, so clickjacking has nothing to gain;
/// * `no-referrer` -- request URLs here carry ids, and a referrer should not leak them to a
///   third party;
/// * a content type is never set here, because it is per-response and the handlers own it.
///
/// HSTS is deliberately absent: it is only safe to send over a connection the deployment
/// actually serves over HTTPS, and this process cannot know that. `COOKIE_SECURE` exists for
/// the same reason.
fn security_headers() -> [(&'static str, &'static str); 3] {
    [
        ("x-content-type-options", "nosniff"),
        ("x-frame-options", "DENY"),
        ("referrer-policy", "no-referrer"),
    ]
}

/// Builds the whole layer stack for a router.
///
/// **Read the calls bottom-up.** Each `.layer()` wraps what came before it, so the *last*
/// call is the outermost and therefore the first to see a request. That is not a style
/// point: `SetRequestIdLayer` only mints an id when the request carries none, so the layer
/// stripping a caller-supplied id has to sit *outside* it. This ordering was got wrong once
/// here and `request_ids_are_minted_per_request_and_never_trusted` now asserts it.
///
/// ```text
/// TraceLayer                  outermost: a span covers everything below
///   strip_incoming_request_id    the caller's id is discarded
///     set_request_id             a fresh id, ours
///       PropagateRequestId        the id is echoed into the response
///         CorsLayer               fail closed unless the origin is allowlisted
///           require_json_content_type  the CSRF guard, INSIDE CORS so preflights pass
///             record_outcome        counters, and a log line for every 5xx
///             security_headers     on every response, including errors
///               BodyLimit          refuse an oversized body before buffering
///                 CatchPanic       innermost: a panic is a 500, not a dead connection
/// ```
pub fn apply<S>(router: axum::Router<S>, config: &Config) -> axum::Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    router
        // --- innermost first: each `.layer()` wraps everything above it in this list ---
        // A panic in a handler still produces a response rather than an aborted connection
        // the caller has to diagnose.
        .layer(CatchPanicLayer::new())
        .layer(axum::extract::DefaultBodyLimit::max(
            config.body_limit_bytes,
        ))
        .layer(axum::middleware::from_fn(apply_security_headers))
        .layer(axum::middleware::from_fn(record_outcome))
        // Order matters and was wrong once. `.layer()` wraps what came before it, so
        // the LAST call is the OUTERMOST -- which means CORS must be applied *after*
        // the guard to sit outside it. Reversed, the guard ran first and answered the
        // browser's CORS preflight (an OPTIONS with no body and no Content-Type) with
        // 415 before CorsLayer ever saw it, breaking the cross-origin topology
        // `DEPLOYMENT.md` documents. The same-origin deployment never sends a
        // preflight, so it looked fine; a preflight regression test now pins it.
        .layer(axum::middleware::from_fn(require_json_content_type))
        .layer(cors(config))
        // The id is echoed into the response, which is the point: the caller quotes it back
        // and we find the log line.
        .layer(PropagateRequestIdLayer::new(HeaderName::from_static(
            REQUEST_ID_HEADER,
        )))
        .layer(set_request_id())
        // Outside `set_request_id`, because that layer deliberately *keeps* an id already on
        // the request. That is the right default for a proxy forwarding an upstream id, and
        // the wrong one here: it would let a caller pin the same id on every request and make
        // the correlation worthless exactly when an incident needs it.
        .layer(axum::middleware::from_fn(strip_incoming_request_id))
        // Outermost, so a span exists for everything below it.
        .layer(TraceLayer::new_for_http())
}

/// Refuses a state-changing request that does not declare `application/json`.
///
/// # Why this exists at all
///
/// Several handlers take `axum::body::Bytes` and parse JSON by hand, so that a
/// malformed body produces the same clean 400 as a missing field instead of Axum's 422
/// with a parser's message. That is a deliberate, worthwhile trade -- but it quietly
/// removes the only thing that made this a JSON API, and that thing was the CSRF
/// defence.
///
/// **"It's JSON, so a form cannot post it" is false.** A browser can produce
/// `<form enctype="text/plain">`, which sends a body with no preflight and with
/// `Content-Type: text/plain` -- and if that body happens to be JSON, this API used to
/// accept it. Measured on a live account: a cross-site `PATCH /api/auth/profile`
/// renamed the account, and a cross-site `PATCH /api/auth/security/password` installed
/// a password of the attacker's choosing. Account takeover from a link.
///
/// Requiring `application/json` closes it, because a browser cannot set that
/// Content-Type from a form, and `fetch` cannot set it cross-origin without a preflight
/// that the CORS allowlist refuses. `SameSite=Lax` covers the shipped deployment on its
/// own; this is the layer that holds when a deployment deliberately sets
/// `COOKIE_SAME_SITE=none`.
///
/// # Why the whole API, not just `/auth`
///
/// It was originally scoped to the auth router, because that is where a forged request
/// is a takeover. But the same `Bytes`-and-parse shape exists on ten other
/// cookie-authenticated mutation routes -- notes, progress, the homework compat
/// aliases, teacher homework and the admin-only EduSecure import -- and a forged
/// request to `POST /api/teacher/homework` publishes homework. One layer for the whole
/// API is also fewer places for the next route to forget.
///
/// # What this deliberately does not break
///
/// GET and HEAD are untouched, so links and prefetches keep working. No route in this
/// API accepts `multipart/form-data` (attachments are metadata-only), so nothing here
/// blocks an upload. The shipped frontend sends `Content-Type: application/json` on
/// every mutation it sends to this API, including the bodyless ones -- which is why a
/// handful of test harnesses had to be corrected to match the real client rather than
/// the reverse.
async fn require_json_content_type(
    request: Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> Response {
    use axum::http::header::CONTENT_TYPE;
    use axum::http::{Method, StatusCode};

    if matches!(*request.method(), Method::GET | Method::HEAD) {
        return next.run(request).await;
    }

    let declared_json = request
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        // `application/json; charset=utf-8` is the same thing, and browsers add it.
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"));

    if declared_json {
        return next.run(request).await;
    }

    // 415 rather than 400: the request is well-formed, this server just does not speak
    // that media type, and that is exactly what the status is for.
    (
        StatusCode::UNSUPPORTED_MEDIA_TYPE,
        axum::Json(serde_json::json!({
            "error": "This endpoint only accepts application/json.",
            "code": "UNSUPPORTED_MEDIA_TYPE",
        })),
    )
        .into_response()
}

/// Removes a caller-supplied request id so the one we mint is always the real one.
async fn strip_incoming_request_id(
    mut request: Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> axum::response::Response {
    request.headers_mut().remove(REQUEST_ID_HEADER);
    next.run(request).await
}

/// Adds the static security headers to every response.
///
/// Outside the handlers, so error responses get them too -- a 500 that arrives without
/// `nosniff` is still a response the browser will try to interpret.
async fn apply_security_headers(
    request: Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let mut response = next.run(request).await;
    for (name, value) in security_headers() {
        // Only ever inserted: a handler that set one deliberately keeps its own value.
        if !response.headers().contains_key(name) {
            if let (Ok(name), Ok(value)) = (
                HeaderName::from_bytes(name.as_bytes()),
                HeaderValue::from_str(value),
            ) {
                response.headers_mut().insert(name, value);
            }
        }
    }
    response
}

/// Counts requests, errors and in-flight work.
///
/// Placed outside the handlers and inside tracing, so an error recorded by
/// `ApiError::Internal` is counted the same way a panic is. The status is read from the
/// response, which is why this sits where it does.
async fn record_outcome(
    request: Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> axum::response::Response {
    REQUESTS.fetch_add(1, Ordering::Relaxed);
    IN_FLIGHT.fetch_add(1, Ordering::Relaxed);

    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let response = next.run(request).await;

    IN_FLIGHT.fetch_sub(1, Ordering::Relaxed);
    // 5xx only. A 404 for an unknown route and a 400 for a bad filter are the application
    // working, not a fault; counting them would make the number meaningless.
    if response.status().is_server_error() {
        ERRORS.fetch_add(1, Ordering::Relaxed);
        tracing::error!(
            method = %method,
            path = %path,
            status = response.status().as_u16(),
            "request failed"
        );
    }
    response
}

/// The static header set, exposed so a test can assert the exact values rather than a
/// hand-copied list that could drift from the implementation.
pub fn security_header_values() -> [(&'static str, &'static str); 3] {
    security_headers()
}
