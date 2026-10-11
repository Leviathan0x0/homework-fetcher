//! JSON error type shared by every handler.
//!
//! Two kinds of failure, and the split is the whole point of the type: a
//! [`ApiError::Client`] carries a status code, a machine-readable code and a message
//! that is safe to show a caller, while [`ApiError::Internal`] carries a cause that is
//! logged and never serialised.

use axum::{http::StatusCode, response::IntoResponse, Json};
use serde::Serialize;

use crate::services::auth::AuthError;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    /// A failure the caller is meant to see. The message is written to be safe to
    /// display, so a session token or a password must never be part of one.
    #[error("{message}")]
    Client {
        status: StatusCode,
        code: &'static str,
        message: String,
    },
    /// Abuse protection refused the request. Its own variant rather than a `Client`
    /// with a header attached, because "come back in N seconds" is part of the answer
    /// and every layer between here and the socket would otherwise have to remember
    /// to add the header.
    #[error("{message}")]
    RateLimited {
        /// Seconds until the caller may try again. Always at least one.
        retry_after_seconds: i64,
        message: String,
    },
    /// Anything unexpected. The cause is logged; the body is a fixed string.
    #[error("internal server error")]
    Internal(#[from] anyhow::Error),
}

impl ApiError {
    /// 400: the request could not be understood or was missing a required field.
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::Client {
            status: StatusCode::BAD_REQUEST,
            code: "BAD_REQUEST",
            message: message.into(),
        }
    }

    /// 401: no session, or credentials that did not verify.
    ///
    /// `code` distinguishes "there is no session" from "the session is not valid" so a
    /// client can react differently, without the message revealing anything about the
    /// account.
    pub fn unauthorized(code: &'static str, message: impl Into<String>) -> Self {
        Self::Client {
            status: StatusCode::UNAUTHORIZED,
            code,
            message: message.into(),
        }
    }

    /// 403: authenticated, but not allowed to do this.
    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::Client {
            status: StatusCode::FORBIDDEN,
            code: "FORBIDDEN",
            message: message.into(),
        }
    }

    /// 404: the thing asked for does not exist, or the caller may not know that it does.
    ///
    /// Used for both cases on purpose -- "no such id" and "not yours" share one answer,
    /// because telling them apart lets a caller discover that an id exists somewhere it
    /// is not allowed to reach.
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::Client {
            status: StatusCode::NOT_FOUND,
            code: "NOT_FOUND",
            message: message.into(),
        }
    }

    /// 429: too many attempts. Carries how long to wait, which becomes `Retry-After`.
    ///
    /// Never a 503 and never a 401. The request was understood, the service is fine,
    /// and answering either of those would tell a legitimate user their password is
    /// wrong when it is their *timing* that is.
    pub fn too_many_requests(retry_after_seconds: i64) -> Self {
        Self::RateLimited {
            // A zero would say "come straight back", which is the one value that
            // makes the header worse than not sending it at all.
            retry_after_seconds: retry_after_seconds.max(1),
            message: "Too many attempts. Wait a few minutes and try again.".into(),
        }
    }

    /// A database failure, logged with its cause and answered with a flat 500.
    pub fn internal(error: impl Into<anyhow::Error>) -> Self {
        Self::Internal(error.into())
    }

    pub fn status(&self) -> StatusCode {
        match self {
            Self::Client { status, .. } => *status,
            Self::RateLimited { .. } => StatusCode::TOO_MANY_REQUESTS,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

#[derive(Serialize)]
struct ClientErrorBody<'a> {
    error: &'a str,
    code: &'a str,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        match self {
            // A client error is already safe to display, so it is returned as-is.
            Self::Client {
                status,
                code,
                message,
            } => (
                status,
                Json(ClientErrorBody {
                    error: &message,
                    code,
                }),
            )
                .into_response(),
            Self::RateLimited {
                retry_after_seconds,
                message,
            } => {
                let mut response = (
                    StatusCode::TOO_MANY_REQUESTS,
                    Json(ClientErrorBody {
                        error: &message,
                        code: "TOO_MANY_REQUESTS",
                    }),
                )
                    .into_response();
                // Set rather than inserted, so nothing downstream can find it stale.
                if let Ok(value) =
                    axum::http::HeaderValue::from_str(&retry_after_seconds.to_string())
                {
                    response
                        .headers_mut()
                        .insert(axum::http::header::RETRY_AFTER, value);
                }
                response
            }
            // Log the cause, return nothing sensitive. A SQL error can name tables
            // and columns, which is exactly what must not reach a client.
            Self::Internal(error) => {
                tracing::error!(error = %error, "request failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "error": "internal server error",
                        "code": "INTERNAL",
                    })),
                )
                    .into_response()
            }
        }
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        Self::internal(error)
    }
}

impl From<AuthError> for ApiError {
    /// A failed authentication collapses into one 401 with one message. The caller
    /// learns that the credentials did not work and nothing else: not whether the
    /// school ID exists, not whether the account is provisioned for local passwords,
    /// not which of the two was wrong.
    fn from(error: AuthError) -> Self {
        match error {
            // A missing field is a client mistake, not an authentication failure, and
            // saying which field is what lets a form highlight it.
            AuthError::BadRequest(message) => Self::bad_request(message),
            AuthError::InvalidCredentials => {
                Self::unauthorized("INVALID_CREDENTIALS", "Invalid school ID or password.")
            }
            AuthError::Database(error) => Self::internal(error),
        }
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_internal_error_never_serialises_its_cause() {
        let body = serde_json::to_string(&ClientErrorBody {
            error: "internal server error",
            code: "INTERNAL",
        })
        .unwrap();
        assert!(!body.contains("SQL") && !body.contains("sqlite"));
    }

    #[test]
    fn invalid_credentials_are_one_answer() {
        let error: ApiError = AuthError::InvalidCredentials.into();
        assert_eq!(error.status(), StatusCode::UNAUTHORIZED);

        // A wrong password and an unknown school ID produce the identical response.
        let from_wrong_password: ApiError = AuthError::InvalidCredentials.into();
        assert_eq!(
            format!("{error:?}"),
            format!("{from_wrong_password:?}"),
            "the two failures must be indistinguishable"
        );
    }

    #[test]
    fn a_missing_field_is_a_client_error_not_an_auth_failure() {
        let error: ApiError = AuthError::BadRequest("Password is required.").into();
        assert_eq!(error.status(), StatusCode::BAD_REQUEST);
    }
}
