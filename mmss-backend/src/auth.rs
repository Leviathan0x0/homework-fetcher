//! Everything a route needs to require a signed-in caller.
//!
//! Four extractors, all built on one resolver:
//!
//! | Type | Means |
//! | --- | --- |
//! | [`AuthenticatedUser`] | any valid session |
//! | [`StudentUser`] | a valid session belonging to a student |
//! | [`TeacherUser`] | a valid session belonging to a teacher |
//! | [`AdminUser`] | a valid session belonging to an administrator |
//!
//! Using extractors rather than route middleware is a deliberate choice. A handler
//! that takes `TeacherUser` cannot be reached by a student, the requirement is
//! visible in the signature, and the check happens after argument extraction rather
//! than before. A role guard written as middleware has to thread the resolved
//! principal back through request extensions to be usable at all, and `from_fn`'s
//! opaque return type makes even that awkward. The cost of this choice is that the
//! check runs after the extractor, not before; the benefit is that the compiler
//! enforces it instead of a reviewer having to notice it.

use axum::extract::{FromRef, FromRequestParts};
use axum::http::request::Parts;

use crate::cookies::session_token_from_headers;
use crate::error::ApiError;
use crate::models::Role;
use crate::services::auth::{AuthService, Principal};
use crate::state::AppState;

/// The signed-in caller, as far as a handler is concerned.
///
/// It carries no credential and no token: the session value has already been
/// exchanged for a user by the time a handler sees it, and nothing downstream needs
/// to be able to replay it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthenticatedUser(pub Principal);

impl AuthenticatedUser {
    pub fn user_id(&self) -> i64 {
        self.0.user_id
    }

    pub fn role(&self) -> Role {
        self.0.role
    }

    pub fn class_id(&self) -> Option<i64> {
        self.0.class_id
    }

    pub fn display_name(&self) -> Option<&str> {
        self.0.display_name.as_deref()
    }

    pub fn principal(&self) -> &Principal {
        &self.0
    }
}

/// A signed-in student.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StudentUser(pub AuthenticatedUser);

/// A signed-in teacher.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TeacherUser(pub AuthenticatedUser);

/// A signed-in administrator.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminUser(pub AuthenticatedUser);

/// The role wrappers are transparent about what they hold, so a handler can ask for
/// `user_id()` without unwrapping the newtype at every use.
macro_rules! delegate_to_authenticated {
    ($($wrapper:ty),+ $(,)?) => {
        $(
            impl std::ops::Deref for $wrapper {
                type Target = AuthenticatedUser;
                fn deref(&self) -> &Self::Target {
                    &self.0
                }
            }
        )+
    };
}

delegate_to_authenticated!(StudentUser, TeacherUser, AdminUser);

fn unauthenticated() -> ApiError {
    ApiError::unauthorized("UNAUTHENTICATED", "Not authenticated.")
}

fn wrong_role() -> ApiError {
    ApiError::forbidden("Your account is not allowed to use this resource.")
}

/// Reads the session token and resolves it to a user.
///
/// A caller with no cookie is refused without touching the database, which is the
/// common case on any public route. An expired or revoked session is refused and, in
/// the expired case, deleted on the way past.
async fn resolve(state: &AppState, headers: &axum::http::HeaderMap) -> Result<Principal, ApiError> {
    let token = session_token_from_headers(headers).ok_or_else(unauthenticated)?;
    AuthService::new(&state.db, &state.config)
        .validate_session(&token)
        .await?
        .ok_or_else(unauthenticated)
}

impl<S> FromRequestParts<S> for AuthenticatedUser
where
    S: Send + Sync,
    AppState: FromRef<S>,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let state = AppState::from_ref(state);
        Ok(Self(resolve(&state, &parts.headers).await?))
    }
}

impl<S> FromRequestParts<S> for StudentUser
where
    S: Send + Sync,
    AppState: FromRef<S>,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let user = AuthenticatedUser::from_request_parts(parts, state).await?;
        if user.role() != Role::Student {
            return Err(wrong_role());
        }
        Ok(Self(user))
    }
}

impl<S> FromRequestParts<S> for TeacherUser
where
    S: Send + Sync,
    AppState: FromRef<S>,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let user = AuthenticatedUser::from_request_parts(parts, state).await?;
        if user.role() != Role::Teacher {
            return Err(wrong_role());
        }
        Ok(Self(user))
    }
}

impl<S> FromRequestParts<S> for AdminUser
where
    S: Send + Sync,
    AppState: FromRef<S>,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let user = AuthenticatedUser::from_request_parts(parts, state).await?;
        if user.role() != Role::Admin {
            return Err(wrong_role());
        }
        Ok(Self(user))
    }
}
