//! The authentication HTTP surface: sign in, sign out, and "who am I".
//!
//! Handlers here do no authentication work of their own. They parse a request, hand
//! the credentials to [`AuthService`], and shape a response.

use axum::extract::State;
use axum::http::header::SET_COOKIE;
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::AuthenticatedUser;
use crate::cookies::{clear_session_cookie, session_cookie, session_token_from_headers};
use crate::error::{ApiError, ApiResult};
use crate::models::Role;
use crate::services::accounts::AccountsService;
use crate::services::auth::{AuthError, AuthService, Principal};
use crate::state::AppState;
use crate::validate;

/// Routes only, so [`crate::routes`] can mount them at two paths without duplicating the
/// route table.
pub fn router(prefix: &str) -> axum::Router<AppState> {
    use axum::routing::{get, patch, post};
    axum::Router::new()
        .route(&format!("{prefix}/login"), post(login))
        .route(&format!("{prefix}/logout"), post(logout))
        .route(&format!("{prefix}/profile"), patch(update_profile))
        .route(&format!("{prefix}/password"), patch(change_password))
        // The one route in the file that is deliberately unauthenticated. The setup token
        // in the body *is* the identity verification: it is 256 bits of CSPRNG, stored
        // only as a digest, single-use and expiring. An account with no password cannot
        // present anything else, which is the whole reason this flow exists.
        .route(&format!("{prefix}/password/setup"), post(complete_setup))
        .route(&format!("{prefix}/me"), get(me))
}

/// Kept as the old backend's field name so an existing client that still sends
/// `studentId` keeps working unchanged.
#[derive(Deserialize)]
pub struct LoginRequest {
    /// The old client sends `studentId`. The aliases let a client that prefers the
    /// domain's own wording use it without a second endpoint.
    #[serde(rename = "studentId", alias = "schoolId", alias = "username")]
    pub student_id: String,
    pub password: String,
}

/// The user object the existing frontend reads: `mapAuthUser` consumes exactly these
/// fields. Nothing secret is in it, and nothing internal is either.
///
/// camelCase because that is the wire shape the old client already parses; renaming the
/// fields in Rust is not a reason to break it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    pub id: i64,
    pub student_id: String,
    pub display_name: Option<String>,
    pub class_id: Option<i64>,
    /// The class **name** -- `"9-F"` -- not the id.
    ///
    /// Added in R10. The existing frontend reads `user.section` in six places and derives
    /// its "is this account's section actually known?" flag from it; it sends `classId`
    /// alone, so every student arrived with `section: null` and the frontend concluded it
    /// did not know the student's section. The name is what the old free-text column held
    /// and what the UI displays, so the id alone was never a substitute.
    pub section: Option<String>,
    pub role: Role,
    pub is_admin: bool,
    pub is_teacher: bool,
}

impl From<&Principal> for AccountView {
    fn from(principal: &Principal) -> Self {
        Self::with_section(principal, None)
    }
}

impl AccountView {
    /// The same view, with the class name resolved.
    ///
    /// Kept separate from [`From`] so resolving the name stays an explicit, awaited step in
    /// the two handlers that need it, and `Principal` -- which R3 froze as "enough for
    /// authorization, nothing secret" -- does not grow a presentation field.
    fn with_section(principal: &Principal, section: Option<String>) -> Self {
        Self {
            id: principal.user_id,
            student_id: principal.school_id.clone(),
            display_name: principal.display_name.clone(),
            class_id: principal.class_id,
            section,
            role: principal.role,
            // The old client derived these from the role and the school ID, and reads
            // them back off the response. Deriving them here keeps a client that
            // trusts them working without teaching it to derive anything itself.
            is_admin: principal.role == Role::Admin,
            is_teacher: matches!(principal.role, Role::Teacher | Role::Admin),
        }
    }
}

/// Builds the account view with the class name resolved.
///
/// One indexed primary-key lookup, on two routes, in exchange for the frontend being able
/// to name the section it is already rendering. A database failure here is *not* fatal: the
/// account is still the account, and a missing class name degrades the UI rather than
/// signing someone out.
async fn account_view(db: &sqlx::SqlitePool, principal: &Principal) -> AccountView {
    let section = match principal.class_id {
        Some(class_id) => crate::repositories::classes::find_by_id(db, class_id)
            .await
            .ok()
            .flatten()
            .map(|class| class.name),
        None => None,
    };
    AccountView::with_section(principal, section)
}

#[derive(Serialize)]
struct LoginResponse {
    authenticated: bool,
    /// The session token, also delivered as a cookie. The old client expected it in
    /// the body for the benefit of clients that cannot hold cookies; the browser
    /// flow never needs it.
    token: String,
    user: AccountView,
}

/// A failed login. `authenticated: false` is what the existing client looks for, and
/// `error` is the message it shows verbatim.
#[derive(Serialize)]
struct LoginFailure {
    authenticated: bool,
    error: String,
}

#[derive(Serialize)]
struct LogoutResponse {
    success: bool,
    authenticated: bool,
}

#[derive(Serialize)]
struct MeAuthenticated {
    authenticated: bool,
    user: AccountView,
}

#[derive(Serialize)]
struct MeAnonymous {
    authenticated: bool,
}

/// `POST /auth/login`
///
/// A missing or blank field is a 400 that names the field, because the old client
/// puts that text straight into the form. Anything that fails to authenticate is a
/// 401 with one message, whether the school ID is unknown, the password is wrong, or
/// the account has no credential here.
pub async fn login(State(state): State<AppState>, body: axum::body::Bytes) -> ApiResult<Response> {
    // The body is decoded here rather than with `Json<T>` so a malformed request gets
    // the same clean 400 as a missing field. Axum's own rejection would answer 422
    // with the parser's message, which is an internal detail the caller has no use
    // for -- and the old client shows whatever text arrives here verbatim.
    let request: LoginRequest = serde_json::from_slice(&body).map_err(|_| {
        ApiError::bad_request("Expected a JSON body with a school ID and a password.")
    })?;

    let service = AuthService::new(&state.db, &state.config);
    let school_id = AuthService::normalize_school_id(&request.student_id);

    let principal = match service.authenticate(&school_id, &request.password).await {
        Ok(principal) => principal,
        Err(error) => {
            let api_error: ApiError = error.into();
            let status = api_error.status();
            let body = match &api_error {
                ApiError::Client { message, .. } => message.clone(),
                // A 500 is already logged and must not be re-described here.
                ApiError::Internal(_) => "An unexpected error occurred during login.".into(),
            };
            return Ok(failure(status, body));
        }
    };

    let session = service.create_session(principal.user_id).await?;
    let cookie = session_cookie(&session.token, service.ttl_seconds(), &state.config.cookie);
    let user = account_view(&state.db, &principal).await;

    Ok((
        [(SET_COOKIE, cookie)],
        Json(LoginResponse {
            authenticated: true,
            token: session.token,
            user,
        }),
    )
        .into_response())
}

/// `GET /auth/me`
///
/// Returns 200 with `authenticated: false` when there is no usable session, and 200
/// with the account when there is. That is not a softer answer than a 401: no user
/// data is disclosed either way. It is 200 because the existing client checks
/// `res.ok` before it looks at the body, so a 401 here would surface as a session
/// *error* instead of as a signed-out state.
pub async fn me(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Some(token) = session_token_from_headers(&headers) else {
        return anonymous();
    };

    match AuthService::new(&state.db, &state.config)
        .validate_session(&token)
        .await
    {
        Ok(Some(principal)) => Json(MeAuthenticated {
            authenticated: true,
            user: account_view(&state.db, &principal).await,
        })
        .into_response(),
        // A database failure is a server problem, not a signed-out answer, and must
        // not be reported as "you are not logged in".
        Ok(None) => anonymous(),
        Err(AuthError::Database(error)) => ApiError::internal(error).into_response(),
        Err(error) => ApiError::from(error).into_response(),
    }
}

/// `POST /auth/logout`
///
/// Revokes the session server-side and then expires the cookie. Both halves matter:
/// deleting only the cookie leaves a token that still works if it was copied, and
/// deleting only the row leaves a browser sending a cookie that is refused forever.
///
/// Signing out with no session, or twice in a row, is a 200 and a no-op.
pub async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(token) = session_token_from_headers(&headers) {
        let service = AuthService::new(&state.db, &state.config);
        if let Err(error) = service.logout(&token).await {
            // The cookie is expired either way, so the caller still ends up signed
            // out. Log the cause and answer as a success.
            tracing::warn!(error = %error, "could not revoke session during logout");
        }
    }

    (
        [(SET_COOKIE, clear_session_cookie(&state.config.cookie))],
        Json(LogoutResponse {
            success: true,
            authenticated: false,
        }),
    )
        .into_response()
}

/// `PATCH /auth/profile`
///
/// The one profile endpoint the existing client genuinely depends on: `AppShell` prompts
/// any student who has no display name to set one, and without this route that prompt
/// produced a 404 and a toast telling the student their name could not be saved.
///
/// Self-service only, and the scope is the caller's own row. There is no
/// `displayName`-accepting field anywhere else in this API, so there is no second door
/// through which a caller could name somebody else -- which is why there is no
/// administrator-only variant either. An administrator renaming another account is an
/// admin feature, and admin features were not asked for.
#[derive(Deserialize)]
struct ProfileRequest {
    #[serde(rename = "displayName")]
    display_name: String,
}

#[derive(Serialize)]
struct ProfileResponse {
    /// The full account, not just the name: the client runs the response back through
    /// `mapAuthUser` and rebuilds its whole session state from it.
    user: AccountView,
}

pub async fn update_profile(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    body: axum::body::Bytes,
) -> ApiResult<Response> {
    let request: ProfileRequest = serde_json::from_slice(&body)
        .map_err(|_| ApiError::bad_request("Expected a JSON body with a display name."))?;
    // Blank is refused rather than stored: an empty name is what the client is asking the
    // user to replace, and writing it would make the prompt reappear with no way out.
    let display_name = validate::text_body(
        &request.display_name,
        "displayName",
        validate::MAX_DISPLAY_NAME_LEN,
    )?;

    let updated = crate::repositories::users::update_display_name(
        &state.db,
        user.user_id(),
        Some(&display_name),
    )
    .await?
    .ok_or_else(|| ApiError::not_found("Your account no longer exists."))?;

    Ok(Json(ProfileResponse {
        user: account_view(&state.db, &Principal::from(updated)).await,
    })
    .into_response())
}

/// `PATCH /auth/password`
///
/// The caller changes **their own** password. There is no user id, no school id and no
/// role in the body, so there is no second door: the target is always the session, and
/// `userId` in a request is simply not a field.
///
/// The current password is required. A session alone is not sufficient authority to
/// change a credential -- whoever holds a stolen session could otherwise change the
/// password and lock the real owner out permanently -- so a session plus the current
/// password is what it takes.
///
/// Every session the account held is revoked and a replacement is issued for this
/// browser in the same response. Dropping all of them is what evicts an attacker who
/// already had one; re-issuing is what stops the person who just changed their own
/// password from being logged out by it.
#[derive(Deserialize)]
struct ChangePasswordRequest {
    #[serde(rename = "currentPassword", alias = "current_password")]
    current_password: String,
    #[serde(rename = "newPassword", alias = "new_password")]
    new_password: String,
}

/// `success`, plus the same account shape as `/auth/me`, so a client can rebuild its
/// session state without a second round trip.
///
/// Deliberately carries no password in either direction, and the request is not echoed
/// into any log or error.
#[derive(Serialize)]
struct PasswordChangedResponse {
    success: bool,
    user: AccountView,
}

pub async fn change_password(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    body: axum::body::Bytes,
) -> ApiResult<Response> {
    let request: ChangePasswordRequest = serde_json::from_slice(&body)
        .map_err(|_| ApiError::bad_request("Expected your current password and a new one."))?;

    let service = AccountsService::new(&state.db, &state.config);
    let session = service
        .change_password(
            user.user_id(),
            &user.0.school_id,
            &request.current_password,
            &request.new_password,
        )
        .await?;

    let principal = user.0.clone();
    Ok((
        [(
            SET_COOKIE,
            session_cookie(&session.token, service.ttl_seconds(), &state.config.cookie),
        )],
        Json(PasswordChangedResponse {
            success: true,
            user: account_view(&state.db, &principal).await,
        }),
    )
        .into_response())
}

/// `POST /auth/password/setup`
///
/// Sets a first password using a setup token, and signs the account in.
///
/// Unauthenticated by necessity -- an account with no password cannot hold a session --
/// and safe because of what the token is: 256 bits from the operating system CSPRNG,
/// stored only as a SHA-256 digest, consumed in a single SQL statement so it cannot be
/// spent twice, and refused once its deadline passes. There is no way to obtain one from
/// this API.
///
/// **What this does not solve:** getting the token to the student. It cannot be done
/// safely without a school-controlled channel, so `ACCOUNT_LIFECYCLE.md` records that as
/// a deployment prerequisite and nothing here pretends otherwise.
#[derive(Deserialize)]
struct SetupRequest {
    token: String,
    #[serde(rename = "newPassword", alias = "new_password")]
    new_password: String,
}

pub async fn complete_setup(
    State(state): State<AppState>,
    body: axum::body::Bytes,
) -> ApiResult<Response> {
    let request: SetupRequest = serde_json::from_slice(&body)
        .map_err(|_| ApiError::bad_request("Expected a setup token and a new password."))?;

    let service = AccountsService::new(&state.db, &state.config);
    let (session, user) = service
        .complete_setup(&request.token, &request.new_password)
        .await?;

    Ok((
        [(
            SET_COOKIE,
            session_cookie(&session.token, service.ttl_seconds(), &state.config.cookie),
        )],
        Json(LoginResponse {
            authenticated: true,
            token: session.token,
            user: account_view(&state.db, &Principal::from(user)).await,
        }),
    )
        .into_response())
}

/// A route guarded only by the extractor, so that later phases have a worked example
/// of the pattern: taking [`AuthenticatedUser`] *is* the authentication requirement.
pub async fn whoami(user: AuthenticatedUser) -> Json<AccountView> {
    Json(AccountView::from(&user.0))
}

fn anonymous() -> Response {
    Json(MeAnonymous {
        authenticated: false,
    })
    .into_response()
}

fn failure(status: axum::http::StatusCode, error: String) -> Response {
    let body = LoginFailure {
        authenticated: false,
        error,
    };
    let mut response = Json(body).into_response();
    *response.status_mut() = status;
    response
}
