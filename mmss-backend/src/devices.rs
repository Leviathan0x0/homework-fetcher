//! Best-effort device labels.
//!
//! A `User-Agent` header is a string the client chose to send. It is not a device
//! identity, it is trivially spoofed, and two people on the same phone model produce
//! the same one. Everything this module produces is therefore an estimate, used for
//! exactly one thing: letting the account owner recognise their own rows in the device
//! list and say "that one is not mine".
//!
//! No access decision anywhere reads this value. Revocation is authorised by the
//! caller's own session, not by anything here.
//!
//! Hand-rolled rather than pulled in as a `user-agent` parser dependency, because that
//! ecosystem is a regex table whose entire output is these two strings, and the
//! application already does a little substring matching elsewhere.

/// What a sign-in looked like from the outside.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceInfo {
    /// For example `"Chrome on macOS"`, or [`DeviceInfo::UNKNOWN`] when the header
    /// said nothing usable.
    pub label: String,
}

impl DeviceInfo {
    /// The value recorded when there is no header, or one that identifies nothing.
    ///
    /// A constant rather than a per-request string, so the device list does not fill
    /// up with a hundred rows that all say "Unknown device" and differ only by an
    /// invisible character.
    pub const UNKNOWN: &'static str = "Unknown device";

    pub fn unknown() -> Self {
        Self {
            label: Self::UNKNOWN.to_owned(),
        }
    }

    /// Reads the label out of a request's headers, or falls back to [`Self::unknown`].
    pub fn from_headers(headers: &axum::http::HeaderMap) -> Self {
        headers
            .get(axum::http::header::USER_AGENT)
            .and_then(|value| value.to_str().ok())
            .map(Self::from_user_agent)
            .unwrap_or_else(Self::unknown)
    }

    /// Derives a label from a raw `User-Agent` string.
    ///
    /// Clipped to [`MAX_AGENT_LEN`] first, so a caller cannot make the process do a
    /// megabyte of substring searching by sending a megabyte header.
    pub fn from_user_agent(raw: &str) -> Self {
        // Clipped on a character boundary, not a byte boundary: slicing a multi-byte
        // character in half would panic, and a panic on a request path is a 500
        // produced by a header the caller never had to make well-formed.
        let mut end = raw.len().min(MAX_AGENT_LEN);
        while !raw.is_char_boundary(end) {
            end -= 1;
        }
        let agent = &raw[..end];
        match (browser(agent), operating_system(agent)) {
            // One known half is still more useful than "Unknown device": "Safari" on
            // its own tells somebody which of their two browsers this is.
            (Some(browser), Some(system)) => Self {
                label: format!("{browser} on {system}"),
            },
            (Some(browser), None) => Self {
                label: format!("{browser} (browser only)"),
            },
            (None, Some(system)) => Self {
                label: format!("Unknown browser on {system}"),
            },
            (None, None) => Self::unknown(),
        }
    }
}

/// Longest `User-Agent` prefix examined. Every real one is under 400 bytes; anything
/// longer is either a bot or an attempt to make this function expensive.
const MAX_AGENT_LEN: usize = 512;

/// Browser names, most specific first.
///
/// Order matters twice over: Edge and Opera both claim to be Chrome, Chrome claims to
/// be Safari, and iOS Safari claims to be all three, so the tokens that *contain*
/// another browser's name have to be tested before the one they impersonate.
const BROWSERS: &[(&str, &str)] = &[
    ("Edg/", "Edge"),
    ("EdgA/", "Edge"),
    ("OPR/", "Opera"),
    ("SamsungBrowser", "Samsung Internet"),
    ("Firefox", "Firefox"),
    ("Chrome", "Chrome"),
    ("Safari", "Safari"),
];

/// Operating systems, most specific first for the same reason: a browser on iOS also
/// says `Safari` and `Mac OS X`, so the iOS tokens have to win.
const SYSTEMS: &[(&str, &str)] = &[
    ("Windows", "Windows"),
    ("Android", "Android"),
    ("iPhone", "iPhone"),
    ("iPad", "iPad"),
    ("iPod", "iPod"),
    ("CrOS", "Chrome OS"),
    ("Mac OS X", "macOS"),
    ("Macintosh", "macOS"),
    ("X11", "Linux"),
];

fn browser(agent: &str) -> Option<&'static str> {
    BROWSERS
        .iter()
        .find(|(token, _)| agent.contains(token))
        .map(|(_, name)| *name)
}

fn operating_system(agent: &str) -> Option<&'static str> {
    SYSTEMS
        .iter()
        .find(|(token, _)| agent.contains(token))
        .map(|(_, name)| *name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::header::USER_AGENT;
    use axum::http::{HeaderMap, HeaderValue};

    const SAFARI_MAC: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
    const CHROME_WINDOWS: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    const EDGE_WINDOWS: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
    const CHROME_IOS: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1";

    fn label_of(agent: &str) -> String {
        DeviceInfo::from_user_agent(agent).label
    }

    #[test]
    fn the_common_combinations_read_the_way_a_person_would_say_them() {
        assert_eq!(label_of(SAFARI_MAC), "Safari on macOS");
        assert_eq!(label_of(CHROME_WINDOWS), "Chrome on Windows");
        assert_eq!(label_of(EDGE_WINDOWS), "Edge on Windows");
    }

    #[test]
    fn a_browser_that_claims_to_be_another_one_is_named_correctly() {
        // Edge ships a Chrome token and Chrome ships a Safari token, so testing
        // most-specific-first is what makes these two right.
        assert!(!label_of(EDGE_WINDOWS).starts_with("Chrome"));
        assert!(!label_of(CHROME_WINDOWS).starts_with("Safari"));
        // An iOS browser is on an iPhone, even though its header also says "Mac OS X".
        assert!(
            label_of(CHROME_IOS).ends_with("on iPhone"),
            "{}",
            label_of(CHROME_IOS)
        );
    }

    #[test]
    fn a_half_known_agent_says_what_it_knows_and_admits_the_rest() {
        // Platform but no recognised browser.
        assert_eq!(
            label_of("Mozilla/5.0 (compatible; Agent/1.0; Windows NT 10.0)"),
            "Unknown browser on Windows"
        );
        // Neither half is recognised, so nothing is claimed. Bots and command-line
        // clients land here, and a device list is better off not guessing for them.
        assert_eq!(label_of("curl/8.4.0"), DeviceInfo::UNKNOWN);
        assert_eq!(
            label_of("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
            DeviceInfo::UNKNOWN
        );
    }

    #[test]
    fn a_multi_byte_header_is_clipped_without_panicking() {
        // The cut lands mid-string; slicing on bytes alone would panic here.
        assert_eq!(label_of(&"é".repeat(MAX_AGENT_LEN)), DeviceInfo::UNKNOWN);
        // A short non-ASCII header still parses.
        assert_eq!(
            label_of("Chrome/1.0 (Windows; cafe\u{e9})"),
            "Chrome on Windows"
        );
    }

    #[test]
    fn an_absent_or_unreadable_header_is_unknown_not_a_crash() {
        assert_eq!(
            DeviceInfo::from_headers(&HeaderMap::new()).label,
            DeviceInfo::UNKNOWN
        );

        let mut headers = HeaderMap::new();
        // Not valid UTF-8 as a header value: `to_str` fails and the label is unknown.
        headers.insert(USER_AGENT, HeaderValue::from_bytes(&[0xff, 0xfe]).unwrap());
        assert_eq!(
            DeviceInfo::from_headers(&headers).label,
            DeviceInfo::UNKNOWN
        );

        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static(CHROME_WINDOWS));
        assert_eq!(
            DeviceInfo::from_headers(&headers).label,
            "Chrome on Windows"
        );
    }
}
