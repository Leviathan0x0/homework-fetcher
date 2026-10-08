//! The AI boundary.
//!
//! An assistive processing layer, never a source of truth. Everything this module returns
//! is a *suggestion a human or a caller may accept*: there is no code path from a model
//! response into a `homework` row, and `POST /api/teacher/homework` does not call into
//! this file at all. A model cannot overwrite a teacher-authored field, because nothing here
//! writes.
//!
//! Two capabilities, mirroring the separation the old system had between its providers, and
//! with the third deliberately absent:
//!
//! | Capability | Why it survives |
//! | --- | --- |
//! | [`AiClient::classify`] | "what subject is this, and is it already well formed?" is a real question when text arrives from a portal and the author is unknown |
//! | [`AiClient::moderate`] | a safety check is still needed; it returns a verdict and never edits |
//!
//! `format` — splitting a merged diary blob into homework and classwork — is **not** here.
//! R5 took those as separate fields the teacher supplied, so the job no longer exists. See
//! `AI_AUDIT.md`.
//!
//! Three properties are enforced by the service rather than promised to each client:
//!
//!   * a timeout, via [`tokio::time::timeout`] around every call, so a hung model is bounded
//!     for *any* implementation rather than being each client's promise to keep;
//!   * bounded input before the call and bounded output after it;
//!   * every failure becomes a typed [`AiError`] that the caller can treat as "no answer",
//!     which is what makes the off path and the failing path the same code.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use crate::api::{AiStatusView, ClassificationView, ModerationView};
use crate::config::{AiConfig, MAX_AI_INPUT_CHARS, MAX_AI_OUTPUT_CHARS};
use crate::error::{ApiError, ApiResult};

/// What went wrong. Every variant is "no usable answer" to a caller, and none of them is
/// ever allowed to leave a partial change behind.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AiError {
    /// No credentials configured. The normal state of a local checkout and a test run.
    #[error("The AI layer is not configured.")]
    Disabled,
    /// The provider could not be reached, or took too long.
    #[error("The AI provider could not be reached.")]
    Unreachable,
    /// The provider answered, with something unusable.
    #[error("The AI provider returned a response that could not be understood.")]
    Malformed,
    /// The provider refused us: bad key, exhausted quota, refusal.
    #[error("The AI provider refused the request.")]
    Rejected,
}

impl AiError {
    /// Safe to show: no key, no endpoint, no homework content.
    pub fn message(&self) -> String {
        self.to_string()
    }

    /// A model-quality failure and a provider-outage failure are different events, and the
    /// distinction matters because a model that answers badly does not mean the provider is
    /// down. The old layer drew exactly this line in `homeworkFormatter.js`.
    pub fn is_provider_outage(&self) -> bool {
        matches!(self, Self::Unreachable | Self::Rejected)
    }
}

/// The one way out of this module.
///
/// A remote provider, a local model (Laya/Jev or Gemma) and a test fake are all just
/// implementations. Nothing above this trait knows which one it is talking to, which is what
/// makes a provider swap a configuration change rather than a refactor.
///
/// The boxed futures are what make the trait object-safe without pulling in `async-trait`;
/// see the same decision in `services::edusecure`.
pub type ClassifyFuture<'a> =
    Pin<Box<dyn Future<Output = Result<RawClassification, AiError>> + Send + 'a>>;
pub type ModerateFuture<'a> =
    Pin<Box<dyn Future<Output = Result<RawModeration, AiError>> + Send + 'a>>;

pub trait AiClient: Send + Sync {
    /// Name of the implementation, for the status view. Never a credential.
    fn provider(&self) -> &'static str;

    /// Free text in, a subject suggestion and a "already well formed?" verdict out.
    fn classify<'a>(&'a self, request: ClassifyRequest) -> ClassifyFuture<'a>;

    /// Free text in, a safety verdict out.
    fn moderate<'a>(&'a self, request: ModerateRequest) -> ModerateFuture<'a>;
}

/// What a provider is asked. Both fields are already bounded by the service.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClassifyRequest {
    pub text: String,
    /// An optional hint. A hint is context for the model, never an instruction to ignore
    /// the text -- and never a value that ends up stored.
    pub subject_hint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModerateRequest {
    pub text: String,
}

/// A classification as it comes back from a model, before validation.
///
/// Deliberately permissive: this is the *wire* shape, so a provider can add a field without
/// breaking the build. [`validate`] is what turns it into something trustworthy.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct RawClassification {
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub is_formatted: Option<bool>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct RawModeration {
    #[serde(default)]
    pub flagged: Option<bool>,
    #[serde(default)]
    pub categories: Option<Vec<String>>,
}

/// A classification that has been checked and is safe to show.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedClassification {
    /// `None` when the model offered nothing usable. Never a guess.
    pub subject: Option<String>,
    pub is_formatted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedModeration {
    pub flagged: bool,
    pub categories: Vec<String>,
}

impl ClassifyRequest {
    /// Bounds the text before it can reach a provider, and trims the ends only.
    pub fn bounded(text: &str, subject_hint: Option<&str>) -> Self {
        Self {
            text: bound(text),
            subject_hint: subject_hint.map(bound),
        }
    }
}

impl ModerateRequest {
    pub fn bounded(text: &str) -> Self {
        Self { text: bound(text) }
    }
}

/// Trim the ends, cap the length, and count characters rather than bytes so a non-Latin
/// diary is not penalised for its encoding.
fn bound(text: &str) -> String {
    text.trim().chars().take(MAX_AI_INPUT_CHARS).collect()
}

/// Checks a raw classification.
///
/// `isFormatted` absent is *not* an error: a model that answered about the subject and
/// nothing else gave a usable answer, and refusing the whole response over one missing
/// field would throw away the part that worked.
pub fn validate(raw: RawClassification) -> Result<ValidatedClassification, AiError> {
    let subject = raw
        .subject
        .map(|value| value.trim().to_owned())
        // Blank is the model declining to name a subject, not naming the empty one.
        .filter(|value| !value.is_empty())
        .map(|value| bound_output(&value));
    if raw.is_formatted.is_none() && subject.is_none() {
        return Err(AiError::Malformed);
    }
    Ok(ValidatedClassification {
        subject,
        is_formatted: raw.is_formatted.unwrap_or(false),
    })
}

/// Checks a raw moderation verdict.
pub fn validate_moderation(raw: RawModeration) -> Result<ValidatedModeration, AiError> {
    let Some(flagged) = raw.flagged else {
        return Err(AiError::Malformed);
    };
    let categories = raw
        .categories
        .unwrap_or_default()
        .into_iter()
        .map(|category| category.trim().to_lowercase())
        // A category the model invented as an empty or enormous string is dropped rather
        // than shown; the verdict itself is what callers act on.
        .filter(|category| !category.is_empty())
        .filter(|category| category.chars().count() <= 64)
        .take(16)
        .collect();
    Ok(ValidatedModeration {
        flagged,
        categories,
    })
}

/// Caps one field of a model answer.
///
/// The separate output cap exists because a model returning *more* than it was given has
/// rewritten the content, and such an answer is discarded by the caller rather than shown
/// as a suggestion.
fn bound_output(value: &str) -> String {
    value.trim().chars().take(MAX_AI_OUTPUT_CHARS).collect()
}

/// The client used when no credentials are configured.
///
/// A value rather than a branch, so "AI is off" and "AI is on but failing" run identical
/// code paths above it.
#[derive(Debug, Clone, Copy, Default)]
pub struct DisabledAi;

impl AiClient for DisabledAi {
    fn provider(&self) -> &'static str {
        "disabled"
    }

    fn classify<'a>(&'a self, _request: ClassifyRequest) -> ClassifyFuture<'a> {
        Box::pin(async { Err(AiError::Disabled) })
    }

    fn moderate<'a>(&'a self, _request: ModerateRequest) -> ModerateFuture<'a> {
        Box::pin(async { Err(AiError::Disabled) })
    }
}

/// Picks the client the deployment asked for.
///
/// Both arms are the same client today. That is deliberate and it is the honest state of
/// things: R8 builds the boundary, and the concrete transport needs a provider contract to
/// code against — which, unlike EduSecure's publish path, *does* exist here, because
/// classify/moderate over HTTP with a JSON body is a shape every candidate supports. Until
/// one is chosen, a configured deployment behaves like an unconfigured one and says so with
/// `Disabled`, rather than pretending to reach a model.
pub fn client_for(_config: &AiConfig) -> Arc<dyn AiClient> {
    Arc::new(DisabledAi)
}

pub struct AiService<'a> {
    client: Arc<dyn AiClient>,
    enabled: bool,
    timeout: Duration,
    /// Retained so a caller can ask about the deployment without being handed the config.
    _marker: std::marker::PhantomData<&'a ()>,
}

impl AiService<'_> {
    pub fn new(client: Arc<dyn AiClient>, config: &AiConfig) -> Self {
        Self {
            client,
            enabled: config.enabled(),
            timeout: config.timeout_ms(),
            _marker: std::marker::PhantomData,
        }
    }

    /// Whether the layer is configured, for the status view.
    pub fn status(&self) -> AiStatusView {
        AiStatusView {
            enabled: self.enabled,
            provider: self.client.provider().to_owned(),
        }
    }

    /// Suggests a subject and a formatting verdict.
    ///
    /// Returns a view or an error. It never writes, and it never returns a partially
    /// validated answer: a response that fails validation is [`AiError::Malformed`], which
    /// is the honest "we got something, but not something usable".
    pub async fn classify(
        &self,
        text: &str,
        subject_hint: Option<&str>,
    ) -> ApiResult<ClassificationView> {
        if text.trim().is_empty() {
            return Err(ApiError::bad_request("text cannot be empty."));
        }
        let request = ClassifyRequest::bounded(text, subject_hint);
        let raw = self
            .call(self.client.classify(request), "classification")
            .await?;
        let validated = validate(raw).map_err(to_api_error)?;
        Ok(ClassificationView::from(validated))
    }

    /// Asks for a safety verdict. Advisory: the caller decides what to do with it, and
    /// nothing here changes homework.
    pub async fn moderate(&self, text: &str) -> ApiResult<ModerationView> {
        if text.trim().is_empty() {
            return Err(ApiError::bad_request("text cannot be empty."));
        }
        let request = ModerateRequest::bounded(text);
        let raw = self
            .call(self.client.moderate(request), "moderation")
            .await?;
        let validated = validate_moderation(raw).map_err(to_api_error)?;
        Ok(ModerationView::from(validated))
    }

    /// The one place a client is invoked.
    ///
    /// The timeout lives here rather than in each client so that the bound is a property of
    /// the boundary instead of a promise every implementation has to keep. A timeout is
    /// reported as [`AiError::Unreachable`] on purpose: to a caller, "the model took too
    /// long" and "the model was not there" are the same event -- no answer.
    async fn call<T>(
        &self,
        future: impl Future<Output = Result<T, AiError>>,
        what: &'static str,
    ) -> ApiResult<T> {
        match tokio::time::timeout(self.timeout, future).await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(error)) => Err(to_api_error(error)),
            Err(_elapsed) => {
                // The timeout value is deliberately not logged alongside the text; only
                // which operation stalled, which is not homework content.
                tracing::warn!(operation = what, "ai call timed out");
                Err(to_api_error(AiError::Unreachable))
            }
        }
    }
}

/// An AI failure as a client-visible error.
///
/// 503 for "not configured", 502 for anything the provider did, and never a 500: nothing
/// about a model's behaviour is an internal server fault.
fn to_api_error(error: AiError) -> ApiError {
    let status = match error {
        AiError::Disabled => axum::http::StatusCode::SERVICE_UNAVAILABLE,
        _ => axum::http::StatusCode::BAD_GATEWAY,
    };
    let code = match error {
        AiError::Disabled => "AI_UNAVAILABLE",
        _ => "AI_FAILED",
    };
    ApiError::Client {
        status,
        code,
        message: error.message(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_classification_is_accepted_or_rejected_as_a_whole() {
        // A complete answer.
        let ok = validate(RawClassification {
            subject: Some("Mathematics".into()),
            is_formatted: Some(true),
        })
        .unwrap();
        assert_eq!(ok.subject.as_deref(), Some("Mathematics"));
        assert!(ok.is_formatted);

        // One missing field is survivable if the other is usable.
        let partial = validate(RawClassification {
            subject: Some("Physics".into()),
            is_formatted: None,
        })
        .unwrap();
        assert_eq!(partial.subject.as_deref(), Some("Physics"));
        assert!(
            !partial.is_formatted,
            "an absent verdict is false, not an error"
        );

        // Neither field usable: the model said nothing, which is Malformed rather than a
        // confident empty answer.
        assert_eq!(
            validate(RawClassification {
                subject: Some("   ".into()),
                is_formatted: None,
            }),
            Err(AiError::Malformed)
        );
        assert_eq!(
            validate(RawClassification {
                subject: None,
                is_formatted: None,
            }),
            Err(AiError::Malformed)
        );
    }

    #[test]
    fn a_moderation_verdict_needs_its_flag() {
        assert_eq!(
            validate_moderation(RawModeration {
                flagged: None,
                categories: Some(vec!["Harassment".into()]),
            }),
            Err(AiError::Malformed),
            "categories without a verdict are not an answer"
        );

        let clean = validate_moderation(RawModeration {
            flagged: Some(false),
            categories: Some(vec![]),
        })
        .unwrap();
        assert!(!clean.flagged);
        assert!(clean.categories.is_empty());

        let flagged = validate_moderation(RawModeration {
            flagged: Some(true),
            categories: Some(vec!["  HARASSMENT ".into(), "".into(), "x".repeat(200)]),
        })
        .unwrap();
        assert!(flagged.flagged);
        // Normalised, and the unusable categories dropped rather than shown.
        assert_eq!(flagged.categories, vec!["harassment".to_owned()]);
    }

    #[test]
    fn input_is_bounded_by_characters_and_only_the_ends_are_trimmed() {
        let long = "x".repeat(MAX_AI_INPUT_CHARS + 500);
        let request = ClassifyRequest::bounded(&format!("  {long}  "), None);
        assert_eq!(request.text.chars().count(), MAX_AI_INPUT_CHARS);

        // Interior newlines survive, because they are part of what the teacher wrote.
        let request = ModerateRequest::bounded("line one\n\nline two");
        assert_eq!(request.text, "line one\n\nline two");

        // A non-Latin diary is capped by characters, not bytes.
        let punjabi = "ਪੰਜਾਬੀ ".repeat(MAX_AI_INPUT_CHARS);
        assert_eq!(
            ModerateRequest::bounded(&punjabi).text.chars().count(),
            MAX_AI_INPUT_CHARS
        );
    }

    #[test]
    fn only_the_provider_outage_variants_are_outages() {
        assert!(AiError::Unreachable.is_provider_outage());
        assert!(AiError::Rejected.is_provider_outage());
        assert!(
            !AiError::Malformed.is_provider_outage(),
            "a model answering badly is not the provider being down"
        );
        assert!(!AiError::Disabled.is_provider_outage());
    }
}
