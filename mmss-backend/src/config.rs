//! Typed configuration, loaded once at startup from the environment.

use std::net::IpAddr;

use anyhow::{Context, Result};

/// Session lifetime. The old system used 30 days deliberately, so that a student
/// returning to the app weeks later is still signed in, and only an explicit logout
/// (or a credential change) ends a session early.
const DEFAULT_SESSION_TTL_DAYS: i64 = 30;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub host: IpAddr,
    pub port: u16,
    pub database_url: String,
    pub session_ttl_ms: i64,
    pub cookie: CookieConfig,
    pub edusecure: EduSecureConfig,
    pub ai: AiConfig,
    /// Browser origins allowed to call this API cross-origin.
    ///
    /// Empty means **deny every cross-origin browser call**, which is the correct default
    /// for the shipped deployment: `vercel.json` rewrites `/api/*` through to this process
    /// same-origin, so no origin needs allowing. The old backend had the same allowlist
    /// (`ALLOWED_ORIGINS`) purely to support a separately hosted frontend, and it failed
    /// closed for anything unlisted.
    pub allowed_origins: Vec<String>,
    /// Largest request body accepted, in bytes.
    ///
    /// The old Express API limited JSON bodies to 256kb. Axum's default is 2 MiB for the
    /// whole body, so without this the new backend would silently accept eight times
    /// more than the contract the frontend was built against. A homework entry is capped
    /// at 20 000 characters by `validate`, so nothing legitimate approaches this.
    pub body_limit_bytes: usize,
}

/// Everything the optional AI layer needs, and nothing more.
///
/// One trait, one set of variables, read once here. The old system read `OPENAI_API_KEY`,
/// `AI_STUDIO_API_KEY` / `GEMINI_API_KEY` and `LAYA_URL` / `GEMMA_URL` from inside four
/// separate provider modules with the model ids hardcoded in source; this is the opposite
/// of that, and it is why swapping a provider is a configuration change rather than a
/// refactor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiConfig {
    /// Base URL of the model service. Absent means the whole layer is off.
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    /// Free-form model name. Deliberately not defaulted: the old code hardcoded
    /// `gemma-4-26b-a4b-it` and `jev-latest` in two files, which is what makes a provider
    /// swap look like a code change.
    pub model: Option<String>,
    /// Wall-clock ceiling for one call, enforced by the service rather than trusted to
    /// each client.
    pub timeout_ms: i64,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            base_url: None,
            api_key: None,
            model: None,
            timeout_ms: DEFAULT_AI_TIMEOUT_MS,
        }
    }
}

/// Generous enough for a model that reasons before answering, short enough that a hung
/// process cannot hold a request open indefinitely. The old local layer used 3s and the
/// remote formatter 60s; one number is chosen over two, because the point of the timeout
/// is a bound, not an accurate prediction.
pub const DEFAULT_AI_TIMEOUT_MS: i64 = 5_000;

/// Longest text handed to a model. Mirrors the old `MAX_INPUT_CHARS`.
pub const MAX_AI_INPUT_CHARS: usize = 4_000;

/// Longest output accepted back. A model that returns more than it was given has been
/// rewritten, and its answer is discarded rather than stored.
pub const MAX_AI_OUTPUT_CHARS: usize = 8_000;

impl AiConfig {
    /// Only when the integration is fully configured.
    ///
    /// Partial configuration is disabled rather than an error, for the same reason as the
    /// EduSecure config: a half-configured deployment should serve the whole local app
    /// instead of refusing to boot.
    pub fn enabled(&self) -> bool {
        self.base_url.is_some() && self.api_key.is_some() && self.model.is_some()
    }

    /// Whether a secret is present, without exposing it. The only sanctioned way to ask.
    pub fn has_api_key(&self) -> bool {
        self.api_key.is_some()
    }

    /// The effective timeout, clamped so a hand-edited variable cannot disable the bound.
    pub fn timeout_ms(&self) -> std::time::Duration {
        let ms = self.timeout_ms.clamp(100, 60_000);
        std::time::Duration::from_millis(ms as u64)
    }
}

/// Everything the EduSecure integration needs, and nothing more.
///
/// The integration is optional by construction: with any of these unset the client is
/// disabled and every EduSecure route answers "not configured" while the rest of the app
/// behaves exactly as it does without the integration. Nothing outside this module reads
/// these variables, which is what keeps portal credentials out of the domain logic.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EduSecureConfig {
    pub base_url: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    /// An academic session to publish into, e.g. `"2026-2027"`.
    pub session: Option<String>,
}

impl EduSecureConfig {
    /// Only when the integration is fully configured.
    ///
    /// Partial configuration is treated as disabled rather than as an error, so a
    /// half-configured deployment starts and serves the whole local app instead of
    /// refusing to boot. The reason is not secret and is safe to show.
    pub fn enabled(&self) -> bool {
        self.base_url.is_some() && self.username.is_some() && self.password.is_some()
    }

    /// Whether `Debug` can leak the password: it can, so this is the one place allowed to
    /// say so, and nothing logs a whole `EduSecureConfig`.
    pub fn has_password(&self) -> bool {
        self.password.is_some()
    }
}

/// The session cookie's transport attributes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CookieConfig {
    /// Adds `Secure`. A browser refuses to store a `Secure` cookie over plain HTTP,
    /// so this must be off for local development over http:// and on everywhere the
    /// app is served over HTTPS.
    pub secure: bool,
    pub same_site: SameSite,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SameSite {
    Lax,
    Strict,
    None,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Self::from_getter(|key| std::env::var(key).ok())
    }

    /// `get` returns `None` for unset variables, so defaults apply.
    pub fn from_getter(get: impl Fn(&str) -> Option<String>) -> Result<Self> {
        let text = |key: &str, default: &str| get(key).unwrap_or_else(|| default.to_owned());
        let flag = |key: &str, default: bool| match get(key) {
            Some(value) => value.trim().eq_ignore_ascii_case("true") || value.trim() == "1",
            None => default,
        };

        // `Secure` defaults on unless the deployment says the app is served over
        // plain HTTP. Failing towards Secure means a forgotten variable produces a
        // cookie the browser will not return over http, which is visible, rather
        // than a session cookie sent in the clear, which is not.
        //
        // NODE_ENV carries a value rather than a boolean, so it cannot go through the
        // same flag check.
        let node_env = get("NODE_ENV").unwrap_or_default();
        let production =
            node_env.trim().eq_ignore_ascii_case("production") || flag("PRODUCTION", false);
        let secure = flag("COOKIE_SECURE", production);

        // `SameSite=None` is only honoured by a browser alongside `Secure`, so asking
        // for None without Secure is a configuration mistake worth refusing at boot
        // rather than a cookie that silently never arrives.
        let same_site = match text("COOKIE_SAME_SITE", "lax")
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "lax" => SameSite::Lax,
            "strict" => SameSite::Strict,
            "none" => SameSite::None,
            other => anyhow::bail!("COOKIE_SAME_SITE must be lax, strict or none, not {other:?}"),
        };
        if same_site == SameSite::None && !secure {
            anyhow::bail!("COOKIE_SAME_SITE=none requires COOKIE_SECURE=true");
        }

        let session_ttl_days: i64 = text("SESSION_TTL_DAYS", &DEFAULT_SESSION_TTL_DAYS.to_string())
            .trim()
            .parse()
            .context("SESSION_TTL_DAYS is not a number of days")?;
        anyhow::ensure!(session_ttl_days > 0, "SESSION_TTL_DAYS must be positive");

        // Empty and whitespace-only count as unset, so an empty variable in a `.env` file
        // disables the integration instead of producing an empty base URL.
        let opt = |key: &str| {
            get(key)
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
        };

        Ok(Self {
            host: text("HOST", "127.0.0.1")
                .parse()
                .context("HOST is not a valid IP address")?,
            port: text("PORT", "3001")
                .parse()
                .context("PORT is not a valid port number")?,
            database_url: text("DATABASE_URL", "sqlite://./data/mmss.db"),
            session_ttl_ms: session_ttl_days * 24 * 60 * 60 * 1000,
            cookie: CookieConfig { secure, same_site },
            edusecure: EduSecureConfig {
                base_url: opt("EDUSECURE_BASE_URL"),
                username: opt("EDUSECURE_USERNAME"),
                password: opt("EDUSECURE_PASSWORD"),
                session: opt("EDUSECURE_SESSION"),
            },
            ai: AiConfig {
                base_url: opt("AI_BASE_URL"),
                api_key: opt("AI_API_KEY"),
                model: opt("AI_MODEL"),
                timeout_ms: match opt("AI_TIMEOUT_MS") {
                    Some(raw) => raw.parse().unwrap_or(DEFAULT_AI_TIMEOUT_MS),
                    None => DEFAULT_AI_TIMEOUT_MS,
                },
            },
            // Comma-separated, whitespace-trimmed, empty entries dropped -- so
            // `ALLOWED_ORIGINS=""` is the same as not setting it, which is what someone
            // clearing the value in a `.env` file means.
            allowed_origins: get("ALLOWED_ORIGINS")
                .unwrap_or_default()
                .split(',')
                .map(|origin| origin.trim().to_owned())
                .filter(|origin| !origin.is_empty())
                .collect(),
            body_limit_bytes: match get("BODY_LIMIT_BYTES")
                .and_then(|raw| raw.trim().parse::<usize>().ok())
            {
                Some(limit) => limit.clamp(1_024, 8 * 1024 * 1024),
                // The old backend's 256kb, adopted deliberately rather than left to Axum's
                // 2 MiB default.
                None => 256 * 1024,
            },
        })
    }

    pub fn addr(&self) -> (IpAddr, u16) {
        (self.host, self.port)
    }

    /// A configuration for a test database: loopback, an ephemeral port, the default
    /// 30-day session lifetime and development cookie settings (not `Secure`, because
    /// a browser would refuse to send it over the plain-HTTP loopback the tests use).
    ///
    /// Production always builds this from the environment with [`Config::from_env`].
    pub fn for_tests(database_url: impl Into<String>) -> Self {
        let database_url = database_url.into();
        Self::from_getter(|key| (key == "DATABASE_URL").then(|| database_url.clone()))
            .expect("test configuration is always valid")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_apply_when_unset() {
        let cfg = Config::from_getter(|_| None).unwrap();
        assert_eq!(
            cfg,
            Config {
                host: "127.0.0.1".parse().unwrap(),
                port: 3001,
                database_url: "sqlite://./data/mmss.db".into(),
                session_ttl_ms: 30 * 24 * 60 * 60 * 1000,
                cookie: CookieConfig {
                    secure: false,
                    same_site: SameSite::Lax,
                },
                // The integration is off unless a deployment configures it, so a test or
                // a local checkout needs no EduSecure credentials at all.
                edusecure: EduSecureConfig::default(),
                // Likewise the AI layer: off, with the default timeout.
                ai: AiConfig::default(),
                // No browser origin is cross-origin-callable unless a deployment says so,
                // and the body limit matches the old backend's 256kb.
                allowed_origins: Vec::new(),
                body_limit_bytes: 256 * 1024,
            }
        );
    }

    #[test]
    fn edusecure_is_disabled_unless_fully_configured() {
        let off = Config::from_getter(|_| None).unwrap();
        assert!(!off.edusecure.enabled());
        assert!(!off.edusecure.has_password());

        // Partial configuration is disabled, not broken.
        for partial in [
            ("EDUSECURE_BASE_URL", "https://portal.invalid/ParentApp"),
            ("EDUSECURE_USERNAME", "svc"),
        ] {
            let cfg = Config::from_getter(|k| (k == partial.0).then(|| partial.1.into())).unwrap();
            assert!(
                !cfg.edusecure.enabled(),
                "{} alone must not enable it",
                partial.0
            );
        }

        let on = Config::from_getter(|k| match k {
            "EDUSECURE_BASE_URL" => Some("https://portal.invalid/ParentApp".into()),
            "EDUSECURE_USERNAME" => Some("svc".into()),
            "EDUSECURE_PASSWORD" => Some("hunter2".into()),
            _ => None,
        })
        .unwrap();
        assert!(on.edusecure.enabled());
        assert!(on.edusecure.has_password());
        // The session year is optional: it only matters to a real portal client.
        assert_eq!(on.edusecure.session, None);
    }

    #[test]
    fn blank_environment_values_count_as_unset() {
        let cfg =
            Config::from_getter(|k| (k == "EDUSECURE_USERNAME").then(|| "   ".into())).unwrap();
        assert!(!cfg.edusecure.enabled());
        assert_eq!(cfg.edusecure.username, None);
    }

    #[test]
    fn ai_is_disabled_unless_fully_configured() {
        let off = Config::from_getter(|_| None).unwrap();
        assert!(!off.ai.enabled(), "no API key means the AI layer is off");
        assert!(!off.ai.has_api_key());
        assert_eq!(off.ai.timeout_ms(), std::time::Duration::from_millis(5_000));

        // Every partial combination stays off. This is the property that lets a developer
        // set one AI_* variable without accidentally enabling a model.
        let full = [
            ("AI_BASE_URL", "http://127.0.0.1:8001"),
            ("AI_API_KEY", "secret"),
            ("AI_MODEL", "some-local-model"),
        ];
        for skip in 0..full.len() {
            let cfg = Config::from_getter(|k| {
                full.iter()
                    .enumerate()
                    .find(|(index, (name, _))| *index != skip && *name == k)
                    .map(|(_, (_, value))| (*value).to_owned())
            })
            .unwrap();
            assert!(
                !cfg.ai.enabled(),
                "omitting {} must leave the AI layer off",
                full[skip].0
            );
        }

        let on = Config::from_getter(|k| {
            full.iter()
                .find(|(name, _)| *name == k)
                .map(|(_, value)| (*value).to_owned())
        })
        .unwrap();
        assert!(on.ai.enabled());
        assert!(on.ai.has_api_key());
    }

    #[test]
    fn the_ai_timeout_is_clamped_so_it_cannot_be_disabled() {
        let cfg = Config::from_getter(|k| match k {
            "AI_BASE_URL" => Some("http://127.0.0.1:8001".into()),
            "AI_API_KEY" => Some("secret".into()),
            "AI_MODEL" => Some("m".into()),
            "AI_TIMEOUT_MS" => Some("0".into()),
            _ => None,
        })
        .unwrap();
        assert_eq!(cfg.ai.timeout_ms(), std::time::Duration::from_millis(100));

        let absurd = Config::from_getter(|k| match k {
            "AI_BASE_URL" => Some("http://127.0.0.1:8001".into()),
            "AI_API_KEY" => Some("secret".into()),
            "AI_MODEL" => Some("m".into()),
            "AI_TIMEOUT_MS" => Some("999999999".into()),
            _ => None,
        })
        .unwrap();
        assert_eq!(
            absurd.ai.timeout_ms(),
            std::time::Duration::from_millis(60_000)
        );

        // A non-numeric timeout falls back to the default instead of failing to boot.
        let junk = Config::from_getter(|k| (k == "AI_TIMEOUT_MS").then(|| "soon".into())).unwrap();
        assert_eq!(
            junk.ai.timeout_ms(),
            std::time::Duration::from_millis(5_000)
        );
    }

    #[test]
    fn environment_overrides_defaults() {
        let cfg = Config::from_getter(|k| match k {
            "HOST" => Some("0.0.0.0".into()),
            "PORT" => Some("8080".into()),
            "DATABASE_URL" => Some("sqlite://./x.db".into()),
            "SESSION_TTL_DAYS" => Some("7".into()),
            "COOKIE_SECURE" => Some("true".into()),
            "COOKIE_SAME_SITE" => Some("strict".into()),
            _ => None,
        })
        .unwrap();
        assert_eq!(cfg.addr(), ("0.0.0.0".parse().unwrap(), 8080));
        assert_eq!(cfg.database_url, "sqlite://./x.db");
        assert_eq!(cfg.session_ttl_ms, 7 * 24 * 60 * 60 * 1000);
        assert!(cfg.cookie.secure);
        assert_eq!(cfg.cookie.same_site, SameSite::Strict);
    }

    #[test]
    fn production_implies_a_secure_cookie() {
        let cfg = Config::from_getter(|k| (k == "NODE_ENV").then(|| "production".into())).unwrap();
        assert!(cfg.cookie.secure, "a production cookie must be Secure");

        // An explicit setting still wins, which is how a plain-HTTP staging host
        // stays usable.
        let cfg = Config::from_getter(|k| match k {
            "NODE_ENV" => Some("production".into()),
            "COOKIE_SECURE" => Some("false".into()),
            _ => None,
        })
        .unwrap();
        assert!(!cfg.cookie.secure);
    }

    #[test]
    fn same_site_none_requires_secure() {
        assert!(Config::from_getter(|k| (k == "COOKIE_SAME_SITE").then(|| "none".into())).is_err());
        assert!(Config::from_getter(|k| match k {
            "COOKIE_SAME_SITE" => Some("none".into()),
            "COOKIE_SECURE" => Some("true".into()),
            _ => None,
        })
        .is_ok());
    }

    #[test]
    fn invalid_values_are_rejected() {
        assert!(Config::from_getter(|k| (k == "PORT").then(|| "not-a-port".into())).is_err());
        assert!(
            Config::from_getter(|k| (k == "COOKIE_SAME_SITE").then(|| "sideways".into())).is_err()
        );
        assert!(Config::from_getter(|k| (k == "SESSION_TTL_DAYS").then(|| "0".into())).is_err());
        assert!(
            Config::from_getter(|k| (k == "SESSION_TTL_DAYS").then(|| "forever".into())).is_err()
        );
    }
}
