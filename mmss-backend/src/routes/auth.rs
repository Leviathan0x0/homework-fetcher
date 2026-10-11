//! The authentication HTTP surface: sign in, sign out, account security, and "who am I".
//!
//! Handlers here do no authentication work of their own. They parse a request, hand
//! the credentials to a service, and shape a response.
//!
//! # Two passwords, and which route uses which
//!
//! | Route | Password it takes | Verifier |
//! | --- | --- | --- |
//! | `POST /auth/login` | MMSS64, or EduSecure on the legacy path | argon2id, or the portal |
//! | `POST /auth/password/setup` | EduSecure (to prove identity) + MMSS64 (new) | the portal |
//! | `PATCH /auth/password` | MMSS64 (current) + MMSS64 (new) | argon2id |
//! | `POST /auth/security/edusecure` | MMSS64 (to prove identity) + EduSecure (new) | argon2id, then the portal |
//!
//! The MMSS64 password is never sent to EduSecure from this file. The only value that
//! crosses that boundary is an EduSecure password, and only to `verify_credentials`.

use axum::extract::{Path, Query, State};
use axum::http::header::{HeaderMap, SET_COOKIE};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::AuthenticatedUser;
use crate::cookies::{clear_session_cookie, session_cookie, session_token_from_headers};
use crate::devices::DeviceInfo;
use crate::error::{ApiError, ApiResult};
use crate::models::Role;
use crate::ratelimit::{RateLimiter, BUCKET_ADDRESS, BUCKET_GLOBAL, BUCKET_LOGIN, BUCKET_PASSWORD};
use crate::services::account_security::{
    self, SecurityError, SecurityStatus, SessionListView, SessionPageRequest,
};
use crate::services::accounts::AccountsService;
use crate::services::auth::{AuthError, AuthService, Principal};
use crate::services::edusecure::can_verify_credentials;
use crate::state::AppState;
use crate::validate;

/// Routes only, so [`crate::routes`] can mount them at two paths without duplicating the
/// route table.
pub fn router(prefix: &str) -> axum::Router<AppState> {
    use axum::routing::{delete, get, patch, post};
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
        // Account security. Every one of these takes `AuthenticatedUser`, which is the
        // requirement: the target is always the caller's own account, and `userId` is
        // not a field in any of these bodies.
        .route(&format!("{prefix}/security"), get(security_status))
        .route(
            &format!("{prefix}/security/password"),
            post(setup_password).patch(change_mmss_password),
        )
        .route(
            &format!("{prefix}/security/edusecure"),
            post(update_edusecure_credentials),
        )
        .route(&format!("{prefix}/sessions"), get(list_sessions))
        .route(&format!("{prefix}/sessions/{{id}}"), delete(revoke_session))
        .route(
            &format!("{prefix}/sessions/others"),
            delete(revoke_other_sessions),
        )
        .route(
            &format!("{prefix}/sessions/all"),
            delete(revoke_all_sessions),
        )
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
///
/// **Two paths, one endpoint.** An account with its own MMSS64 password verifies it
/// locally and the password never leaves this process. An account still on the legacy
/// path has no local credential, so the same password is verified against the school
/// portal instead and -- only if that succeeds -- sealed and stored for later homework
/// fetches. That store-and-continue is the migration path, and it is why a legacy user
/// keeps working: they sign in exactly as they always did, and gain a separate
/// password when they choose to in Account Security.
pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> ApiResult<Response> {
    // The body is decoded here rather than with `Json<T>` so a malformed request gets
    // the same clean 400 as a missing field. Axum's own rejection would answer 422
    // with the parser's message, which is an internal detail the caller has no use
    // for -- and the old client shows whatever text arrives here verbatim.
    let request: LoginRequest = serde_json::from_slice(&body).map_err(|_| {
        ApiError::bad_request("Expected a JSON body with a school ID and a password.")
    })?;

    let service = AuthService::new(&state.db, &state.config);
    let school_id = AuthService::normalize_school_id(&request.student_id);

    if school_id.is_empty() || request.password.is_empty() {
        // Checked before the limiter so an empty field cannot be used to spend another
        // account's budget -- and so the caller gets the same message it always got.
        return Ok(failure(
            StatusCode::BAD_REQUEST,
            if school_id.is_empty() {
                "School ID is required."
            } else {
                "Password is required."
            },
        ));
    }

    // Three budgets, each covering a different shape of attack.
    //
    // Per school ID catches somebody grinding one account. Per address catches bulk
    // guessing from one source. The process-wide ceiling catches the only case neither
    // of the other two can see: attempts spread thinly across thousands of different
    // school IDs, which costs this server a full argon2id verification each and would
    // otherwise be unbounded work.
    //
    // The address comes from a proxy header, so it is a hint a determined caller could
    // forge. That is acceptable because this is defence in depth: the per-account and
    // global budgets are keyed by values the caller *cannot* choose, so forging the
    // header only costs the forger the convenience of the address budget.
    if let Some(address) = client_address(&headers) {
        enforce(&state.limiter, BUCKET_ADDRESS, &address)?;
    }
    // No address at all means a proxy stripped the headers. The other two budgets still
    // apply; inventing a shared "unknown" subject here would let one caller lock out
    // every other caller behind the same proxy.
    enforce(&state.limiter, BUCKET_GLOBAL, GLOBAL_SUBJECT)?;
    enforce(&state.limiter, BUCKET_LOGIN, &school_id)?;

    let principal = match service.authenticate(&school_id, &request.password).await {
        Ok(principal) => principal,
        // The account may exist but have no MMSS64 password of its own. That is the
        // legacy path rather than a failure -- but only the portal can decide, and the
        // portal being unavailable is a 503 rather than a wrong-password 401.
        Err(AuthError::InvalidCredentials) if can_verify_credentials(&state.config.edusecure) => {
            match legacy_login(&state, &school_id, &request.password).await {
                Ok(principal) => principal,
                Err(error) => return Ok(login_failure(ApiError::from(error))),
            }
        }
        // Without a portal client there is no legacy path to take, and this must fall
        // through to the *same* generic 401 as a wrong password. Answering 503 here
        // would tell a caller that this school ID exists and has no local credential --
        // the account-enumeration oracle this endpoint is careful not to be. The
        // 503 appears only on the flows where a user has deliberately asked to store or
        // change a portal credential, so nothing about it is inferred by probing.
        Err(AuthError::InvalidCredentials) => {
            return Ok(login_failure(ApiError::from(AuthError::InvalidCredentials)))
        }
        Err(error) => return Ok(login_failure(ApiError::from(error))),
    };

    let session = service
        .create_session(principal.user_id, &DeviceInfo::from_headers(&headers))
        .await?;
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

/// The legacy path: verify with the school portal, keep the credential, sign in.
///
/// **Blocked by design until a portal client exists.** There is no offline way to check
/// an EduSecure password -- the portal holds the hash -- so with no client this answers
/// `EDUSECURE_UNAVAILABLE` rather than guessing. The password is stored only after the
/// portal has confirmed it, so an account can never end up holding a credential nobody
/// verified.
///
/// The guard in step 3 is the important one. Without it, a *wrong* MMSS64 password
/// would fall through to this function and be sent to the school portal -- which is
/// precisely the "MMSS64 password is never sent to EduSecure" rule this whole split
/// exists to keep. The two checks below are what make the fall-through safe: the
/// account must exist, must be active, and must have **no** MMSS64 password.
async fn legacy_login(
    state: &AppState,
    school_id: &str,
    password: &str,
) -> Result<Principal, SecurityError> {
    // 1. The same lookup `Authenticate` does, so both paths agree about who a school
    //    ID names: exact first, then case-insensitive.
    let user = match crate::repositories::users::find_by_school_id(&state.db, school_id).await? {
        Some(user) => Some(user),
        None => {
            crate::repositories::users::find_by_school_id_ignore_case(&state.db, school_id).await?
        }
    };

    // 2. Unknown, deactivated: the same generic answer as everywhere else.
    let Some(user) = user.filter(crate::models::User::is_active) else {
        return Err(SecurityError::ReauthenticationFailed);
    };

    // 3. The account has its own MMSS64 password, so the value that failed is an
    //    MMSS64 password and must never cross to the portal. See the note above.
    if crate::repositories::credentials::find_password_hash(&state.db, user.id)
        .await?
        .is_some()
    {
        return Err(SecurityError::ReauthenticationFailed);
    }

    // 4. Verify first, store second: an unverified password never reaches the database.
    account_security::service(state)
        .store_verified_credential(user.id, school_id, password)
        .await?;
    Ok(Principal::from(user))
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
/// The caller changes **their own** MMSS64 password. There is no user id, no school id
/// and no role in the body, so there is no second door: the target is always the
/// session, and `userId` in a request is simply not a field.
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
    /// Optional so a client written before this existed keeps working; checked whenever
    /// it is sent, and always sent by the shipped frontend.
    #[serde(rename = "confirmPassword", alias = "confirm_password", default)]
    confirm_password: Option<String>,
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
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> ApiResult<Response> {
    let request: ChangePasswordRequest = serde_json::from_slice(&body)
        .map_err(|_| ApiError::bad_request("Expected your current password and a new one."))?;
    enforce(&state.limiter, BUCKET_PASSWORD, &user.user_id().to_string())?;

    let confirm = request
        .confirm_password
        .clone()
        .unwrap_or_else(|| request.new_password.clone());
    // Checked *before* anything is written. An empty confirmation defaults to the new
    // password so a client written before this field existed keeps working, but a
    // client that sends a genuinely different one is refused without the credential
    // having been rotated underneath it.
    if confirm.trim() != request.new_password.trim() {
        return Err(ApiError::bad_request("The two passwords do not match."));
    }

    // Delegates to the same service call as `PATCH /auth/security/password` rather than
    // re-implementing it. Two routes for one operation is fine; two *implementations* of
    // "verify, hash, revoke every session, re-issue" is how one of them ends up not
    // revoking.
    let service = account_security::service(&state);
    let session = service
        .change_password(
            user.user_id(),
            &user.0.school_id,
            &request.current_password,
            &request.new_password,
            &confirm,
            &DeviceInfo::from_headers(&headers),
        )
        .await?;

    let principal = user.0.clone();
    Ok((
        [(
            SET_COOKIE,
            session_cookie(
                &session.token,
                AuthService::new(&state.db, &state.config).ttl_seconds(),
                &state.config.cookie,
            ),
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
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> ApiResult<Response> {
    let request: SetupRequest = serde_json::from_slice(&body)
        .map_err(|_| ApiError::bad_request("Expected a setup token and a new password."))?;

    let service = AccountsService::new(&state.db, &state.config);
    let (session, user) = service
        .complete_setup(
            &request.token,
            &request.new_password,
            &DeviceInfo::from_headers(&headers),
        )
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

// ------------------------------------------------------- account security

/// `GET /auth/security`
///
/// Which controls the Account Security page should offer. Three booleans: whether this
/// account has its own MMSS64 password, whether a portal credential is stored, and
/// whether this deployment can verify one at all.
///
/// Reports configuration and never a credential -- not the value, not a length, not a
/// last-updated timestamp that could be used as an oracle.
pub async fn security_status(
    State(state): State<AppState>,
    user: AuthenticatedUser,
) -> ApiResult<Json<SecurityStatus>> {
    Ok(Json(
        account_security::service(&state)
            .status(user.user_id())
            .await?,
    ))
}

/// `GET /auth/sessions`
///
/// The caller's own live sessions. `userId` is not a parameter, and there is no route
/// that takes one: the account is the session.
pub async fn list_sessions(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    params: Query<PageParams>,
) -> ApiResult<Json<SessionListView>> {
    let service = account_security::service(&state);
    Ok(Json(
        service
            .list_sessions(
                user.user_id(),
                user.0.session_id.as_deref(),
                SessionPageRequest::parse(params.limit, params.offset),
            )
            .await?,
    ))
}

/// The page window a caller asked for. Both are optional and both are clamped, so a
/// client that ignores the contract gets a useful page rather than a 400.
#[derive(Debug, Default, Deserialize)]
pub struct PageParams {
    limit: Option<i64>,
    offset: Option<i64>,
}

/// `DELETE /auth/sessions/{id}`
///
/// Revokes one of the caller's sessions, requiring the caller's password first.
///
/// **Why reauthentication.** A stolen session is exactly what this page exists to end.
/// If a session alone could revoke every other session, the attacker who stole one
/// would use it to lock the real owner out before the owner noticed, and the page
/// would have made the theft permanent instead of recoverable. Requiring the password
/// is what makes "sign out everywhere" something only the owner can do.
///
/// The `id` in the path is looked up with `user_id` in the same statement, so editing
/// it in the request changes which row is examined and finds nothing. A not-found and
/// a not-yours answer identically.
#[derive(Deserialize)]
struct ReauthenticateRequest {
    #[serde(
        rename = "currentPassword",
        alias = "current_password",
        alias = "password"
    )]
    current_password: String,
}

/// The same shape for every reauthenticated action, with the outcome the client shows.
#[derive(Serialize)]
struct RevokedResponse {
    success: bool,
    revoked: u64,
}

pub async fn revoke_session(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(id): Path<String>,
    body: axum::body::Bytes,
) -> ApiResult<Response> {
    let request: ReauthenticateRequest = reauthenticate_request(&body)?;
    enforce(&state.limiter, BUCKET_PASSWORD, &user.user_id().to_string())?;
    let service = account_security::service(&state);
    service
        .reauthenticate(user.user_id(), &user.0.school_id, &request.current_password)
        .await?;

    // Revoking the session you are standing on is the same as logging out, so the
    // cookie is cleared as well; otherwise the browser keeps presenting a dead token.
    let is_current = user.0.session_id.as_deref() == Some(id.as_str());
    let revoked = service
        .revoke_session(user.user_id(), &id)
        .await
        .map(u64::from)?;

    let mut response = (Json(RevokedResponse {
        success: true,
        revoked,
    }),)
        .into_response();
    if is_current {
        response
            .headers_mut()
            .insert(SET_COOKIE, clear_session_cookie(&state.config.cookie));
    }
    Ok(response)
}

/// `DELETE /auth/sessions/others`
///
/// Signs out every device but this one. Reauthenticated, for the reason above.
///
/// The session that survives is the one identified by the resolved principal, never by
/// anything in the request, so this endpoint cannot be talked into signing the caller
/// out of its own browser.
pub async fn revoke_other_sessions(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    body: axum::body::Bytes,
) -> ApiResult<Response> {
    let request: ReauthenticateRequest = reauthenticate_request(&body)?;
    enforce(&state.limiter, BUCKET_PASSWORD, &user.user_id().to_string())?;
    let service = account_security::service(&state);
    service
        .reauthenticate(user.user_id(), &user.0.school_id, &request.current_password)
        .await?;

    let current = user.0.session_id.clone().unwrap_or_default();
    let revoked = service
        .revoke_other_sessions(user.user_id(), &current)
        .await?;
    Ok(Json(RevokedResponse {
        success: true,
        revoked,
    })
    .into_response())
}

/// `DELETE /auth/sessions/all`
///
/// Signs out everywhere, this browser included, and clears the cookie.
pub async fn revoke_all_sessions(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    body: axum::body::Bytes,
) -> ApiResult<Response> {
    let request: ReauthenticateRequest = reauthenticate_request(&body)?;
    enforce(&state.limiter, BUCKET_PASSWORD, &user.user_id().to_string())?;
    let service = account_security::service(&state);
    service
        .reauthenticate(user.user_id(), &user.0.school_id, &request.current_password)
        .await?;

    let revoked = service.revoke_all_sessions(user.user_id()).await?;
    Ok((
        [(SET_COOKIE, clear_session_cookie(&state.config.cookie))],
        Json(RevokedResponse {
            success: true,
            revoked,
        }),
    )
        .into_response())
}

/// `POST /auth/security/password`
///
/// **Set up** an MMSS64 password for an account that does not have one.
///
/// The EduSecure password is verified through the portal *before* anything is stored,
/// then sealed and saved, then the MMSS64 password is hashed. A failure at any step
/// leaves the account able to sign in exactly as it did before.
///
/// This is the only place an EduSecure password and an MMSS64 password appear in the
/// same request, and they are never compared with each other: one proves identity, the
/// other is the new credential.
#[derive(Deserialize)]
struct SetupPasswordRequest {
    #[serde(
        rename = "edusecurePassword",
        alias = "edusecure_password",
        alias = "schoolPassword"
    )]
    edusecure_password: String,
    #[serde(rename = "newPassword", alias = "new_password")]
    new_password: String,
    #[serde(rename = "confirmPassword", alias = "confirm_password")]
    confirm_password: String,
}

pub async fn setup_password(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> ApiResult<Response> {
    let request: SetupPasswordRequest = serde_json::from_slice(&body).map_err(|_| {
        ApiError::bad_request("Expected your school password and a new MMSS64 password.")
    })?;
    enforce(&state.limiter, BUCKET_PASSWORD, &user.user_id().to_string())?;

    let service = account_security::service(&state);
    let session = service
        .set_up_password(
            user.user_id(),
            &user.0.school_id,
            &request.edusecure_password,
            &request.new_password,
            &request.confirm_password,
            &DeviceInfo::from_headers(&headers),
        )
        .await?;

    Ok((
        [(
            SET_COOKIE,
            session_cookie(
                &session.token,
                AuthService::new(&state.db, &state.config).ttl_seconds(),
                &state.config.cookie,
            ),
        )],
        Json(serde_json::json!({
            "success": true,
            "separatePasswordEnabled": true,
            "edusecureCredentialConfigured": true,
        })),
    )
        .into_response())
}

/// `PATCH /auth/security/password`
///
/// **Change** an MMSS64 password that already exists. Thin wrapper over the shared
/// implementation in [`AccountSecurityService::change_password`]; see there for why the
/// ordering and the session rotation are not restated here.
///
/// The encrypted EduSecure credential is not read, not written and not rotated.
pub async fn change_mmss_password(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> ApiResult<Response> {
    let request: ChangePasswordRequest = serde_json::from_slice(&body)
        .map_err(|_| ApiError::bad_request("Expected your current password and a new one."))?;
    enforce(&state.limiter, BUCKET_PASSWORD, &user.user_id().to_string())?;

    let service = account_security::service(&state);
    let session = service
        .change_password(
            user.user_id(),
            &user.0.school_id,
            &request.current_password,
            &request.new_password,
            &request
                .confirm_password
                .clone()
                .unwrap_or_else(|| request.new_password.clone()),
            &DeviceInfo::from_headers(&headers),
        )
        .await?;

    Ok((
        [(
            SET_COOKIE,
            session_cookie(
                &session.token,
                AuthService::new(&state.db, &state.config).ttl_seconds(),
                &state.config.cookie,
            ),
        )],
        Json(serde_json::json!({
            "success": true,
            "separatePasswordEnabled": true,
            "edusecureCredentialConfigured": service.has_stored_credential(user.user_id()).await?,
        })),
    )
        .into_response())
}

/// `POST /auth/security/edusecure`
///
/// Replaces the stored portal credential after the school verifies the replacement.
///
/// **A valid saved credential is never overwritten by an unverified one.** The
/// replacement is confirmed with the portal first, and the write happens in its own
/// transaction afterwards, so a wrong password, an unreachable portal or a failed
/// write all leave the existing credential exactly as it was.
///
/// The caller's MMSS64 password is required as well: changing what the backend will
/// send to the school portal is not something a borrowed session should be able to do.
#[derive(Deserialize)]
struct UpdateEduSecureRequest {
    #[serde(
        rename = "currentPassword",
        alias = "current_password",
        alias = "password"
    )]
    current_password: String,
    #[serde(
        rename = "newPassword",
        alias = "new_password",
        alias = "edusecurePassword"
    )]
    new_password: String,
}

pub async fn update_edusecure_credentials(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    body: axum::body::Bytes,
) -> ApiResult<Response> {
    let request: UpdateEduSecureRequest = serde_json::from_slice(&body).map_err(|_| {
        ApiError::bad_request("Expected your current password and your new school password.")
    })?;
    enforce(&state.limiter, BUCKET_PASSWORD, &user.user_id().to_string())?;

    let service = account_security::service(&state);
    service
        .reauthenticate(user.user_id(), &user.0.school_id, &request.current_password)
        .await?;
    service
        .store_verified_credential(user.user_id(), &user.0.school_id, &request.new_password)
        .await?;

    Ok(Json(serde_json::json!({
        "success": true,
        "edusecureCredentialConfigured": true,
    }))
    .into_response())
}

/// Reads the reauthentication field, refusing a missing or blank one.
///
/// Parsed by hand rather than with `Json<T>` so a malformed body is the same clean 400
/// every other handler here gives, instead of Axum's 422 with a parser's message.
fn reauthenticate_request(body: &axum::body::Bytes) -> ApiResult<ReauthenticateRequest> {
    let request: ReauthenticateRequest = serde_json::from_slice(body)
        .map_err(|_| ApiError::bad_request("Expected your password to confirm this change."))?;
    if request.current_password.trim().is_empty() {
        return Err(ApiError::bad_request("Your password is required."));
    }
    Ok(request)
}

/// The single subject the process-wide sign-in ceiling is counted against.
///
/// A constant, because that is the point: it is the one budget whose key the caller
/// has no influence over, which is what makes it the one budget a flood cannot route
/// around.
const GLOBAL_SUBJECT: &str = "all";

/// The caller's address, as the nearest proxy reported it.
///
/// `X-Forwarded-For` is a list and the *leftmost* entry is the original client, so that
/// is the one used -- taking the rightmost would just report the proxy itself and lump
/// every caller behind it into a single budget. `X-Real-IP` is the single-value
/// equivalent some proxies set instead.
///
/// Returns `None` when neither header is present or usable. Callers must treat that as
/// "no address known" rather than substituting a placeholder, because a shared
/// placeholder is a shared budget and therefore a denial-of-service.
fn client_address(headers: &HeaderMap) -> Option<String> {
    let forwarded = headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(address) = forwarded {
        return Some(address.to_owned());
    }
    headers
        .get("x-real-ip")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

/// Turns a limiter verdict into the response, or lets the request through.
///
/// `subject` is the normalised school id for login and the user id for everything else.
/// Nothing here ever sees a password.
fn enforce(limiter: &RateLimiter, bucket: &str, subject: &str) -> ApiResult<()> {
    let verdict = limiter.check(bucket, subject);
    if verdict.allowed {
        return Ok(());
    }
    Err(ApiError::too_many_requests(verdict.retry_after_seconds))
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

/// The login failure shape: `authenticated: false` plus the message the existing
/// client shows verbatim.
fn login_failure(error: ApiError) -> Response {
    failure(error.status(), &login_failure_message(&error))
}

fn failure(status: StatusCode, error: &str) -> Response {
    let body = LoginFailure {
        authenticated: false,
        error: error.to_owned(),
    };
    let mut response = Json(body).into_response();
    *response.status_mut() = status;
    response
}

fn login_failure_message(error: &ApiError) -> String {
    match error {
        ApiError::Client { message, .. } | ApiError::RateLimited { message, .. } => message.clone(),
        // A 500 is already logged and must not be re-described here.
        ApiError::Internal(_) => "An unexpected error occurred during login.".into(),
    }
}
