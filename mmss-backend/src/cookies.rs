//! Opaque session tokens and the session cookie.
//!
//! Everything here is deliberately small and self-contained: the token is base64url
//! random bytes, the digest is plain SHA-256 over those bytes, and the cookie is
//! built by hand. No cookie library, because the only cookie in the system is one
//! value we generate ourselves, and the tests assert the exact `Set-Cookie` header
//! rather than trusting a serialiser.

use axum::http::header::{HeaderMap, HeaderValue, COOKIE};

use crate::config::{CookieConfig, SameSite};

/// Kept for compatibility with the old backend and its documentation. The frontend
/// never names the cookie, so this is not a hard constraint, but changing it for no
/// reason would make every existing setup's saved cookie silently useless.
pub const SESSION_COOKIE: &str = "app_session";

/// 32 bytes = 256 bits. Session IDs are never sequential, never derived from a user
/// ID, and never encode one; a guessable ID is the whole attack.
const TOKEN_BYTES: usize = 32;

/// 16 bytes = 128 bits. Used for the *public* session identifier a client names when
/// it wants to revoke one of its sessions.
///
/// Half the size of the token is not a shortcut: 128 bits is far more than enough to
/// make the id unguessable, and it is the id that travels in an API response, so a
/// smaller one is a smaller thing to leak in a log. It grants nothing on its own --
/// revocation is authorised by the caller's own session, never by holding this.
const SESSION_ID_BYTES: usize = 16;

/// A 256-bit cryptographically secure random session token, unpadded base64url.
///
/// Unpadded base64url is all `A-Z a-z 0-9 - _`, so it needs no percent-encoding in a
/// cookie value and can be compared verbatim against the stored digest.
pub fn new_session_token() -> String {
    let mut bytes = [0u8; TOKEN_BYTES];
    os_random(&mut bytes);
    base64url(&bytes)
}

/// A 128-bit public session identifier, in the same alphabet as [`new_session_token`].
///
/// Not a secret and not a credential. It exists so a client can say "revoke *that*
/// session" without ever being told the cookie value, and it is stored in the clear
/// next to the token digest.
pub fn new_session_id() -> String {
    let mut bytes = [0u8; SESSION_ID_BYTES];
    os_random(&mut bytes);
    base64url(&bytes)
}

fn os_random(bytes: &mut [u8]) {
    // `getrandom` reads the operating system CSPRNG (`getrandom(2)` /
    // `BCryptGenRandom` / `getentropy(3)`). There is deliberately no fallback to a
    // userspace PRNG: a session ID that can be predicted is a session ID that can be
    // guessed, so failing to load entropy fails the call instead.
    getrandom::fill(bytes).expect("operating system random source is unavailable");
}

/// Base64url without padding, matching the alphabet `std` does not provide.
fn base64url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let bits = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        let sextets = [
            (bits >> 18) & 63,
            (bits >> 12) & 63,
            (bits >> 6) & 63,
            bits & 63,
        ];
        // Drop the padding sextets this chunk did not need.
        for (i, &s) in sextets.iter().enumerate() {
            if i <= chunk.len() {
                out.push(ALPHABET[s as usize] as char);
            }
        }
    }
    out
}

/// SHA-256 of the token, hex encoded. This is what the `sessions` table stores.
///
/// A digest rather than the token itself: a leaked database dump then contains no
/// value that can be pasted into a cookie. It costs one hash per authenticated
/// request, and it only has to be unguessable, not slow — the token behind it is
/// 256 bits of entropy.
pub fn hash_token(token: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(token.as_bytes());
    let mut hex = String::with_capacity(64);
    for byte in digest {
        // Two hex digits per byte, lowercase.
        hex.push(char::from_digit((byte >> 4) as u32, 16).unwrap_or('0'));
        hex.push(char::from_digit((byte & 0x0f) as u32, 16).unwrap_or('0'));
    }
    hex
}

/// Reads the session token from the request's cookies.
///
/// A `Cookie` header can carry several cookies, so the name is matched rather than
/// assumed. Malformed headers yield `None`, which is an unauthenticated request, not
/// an error.
pub fn session_token_from_headers(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(COOKIE)?.to_str().ok()?;
    for pair in raw.split(';') {
        let (name, value) = pair.split_once('=')?;
        if name.trim() == SESSION_COOKIE {
            let value = value.trim();
            if !value.is_empty() {
                return Some(value.to_owned());
            }
        }
    }
    None
}

/// A `Set-Cookie` value carrying a fresh session.
///
/// `HttpOnly` keeps the cookie out of reach of page scripts, `Secure` keeps it off
/// plaintext connections, `SameSite` blunts cross-site submission, and `Path=/`
/// scopes it to the whole app. `Max-Age` mirrors the stored `expires_at` so the
/// browser stops sending a token the server will refuse.
pub fn session_cookie(token: &str, max_age_seconds: i64, config: &CookieConfig) -> HeaderValue {
    let cookie = format!(
        "{SESSION_COOKIE}={token}; Path=/; HttpOnly; Max-Age={max_age_seconds}{}{}",
        if config.secure { "; Secure" } else { "" },
        same_site_attribute(config.same_site),
    );
    HeaderValue::from_str(&cookie).expect("session cookie is built from a base64url token")
}

/// A `Set-Cookie` value that removes the session cookie from the browser.
///
/// The attributes must match the ones the cookie was set with or the browser keeps
/// the original, so the same `config` is used. `Max-Age=0` is what actually
/// expires it.
pub fn clear_session_cookie(config: &CookieConfig) -> HeaderValue {
    let cookie = format!(
        "{SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT{secure}{same_site}",
        secure = if config.secure { "; Secure" } else { "" },
        same_site = same_site_attribute(config.same_site),
    );
    HeaderValue::from_str(&cookie).expect("clear cookie is a constant")
}

fn same_site_attribute(same_site: SameSite) -> &'static str {
    match same_site {
        SameSite::Lax => "; SameSite=Lax",
        SameSite::Strict => "; SameSite=Strict",
        SameSite::None => "; SameSite=None",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn base64url_is_unpadded_and_url_safe() {
        assert_eq!(base64url(b""), "");
        assert_eq!(base64url(b"f"), "Zg");
        assert_eq!(base64url(b"fo"), "Zm8");
        assert_eq!(base64url(b"foo"), "Zm9v");
        assert_eq!(base64url(b"foob"), "Zm9vYg");
        assert_eq!(base64url(b"fooba"), "Zm9vYmE");
        assert_eq!(base64url(b"foobar"), "Zm9vYmFy");
        let encoded = base64url(&[0xfb, 0xff, 0xbe]);
        assert!(!encoded.contains('='));
        assert!(!encoded.contains('+') && !encoded.contains('/'));
    }

    #[test]
    fn tokens_are_unique_and_url_safe() {
        let tokens: HashSet<String> = (0..500).map(|_| new_session_token()).collect();
        assert_eq!(tokens.len(), 500, "tokens must not repeat");
        for token in &tokens {
            assert_eq!(
                token.len(),
                43,
                "32 bytes must encode to 43 base64url chars"
            );
            assert!(token
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        }
    }

    #[test]
    fn session_ids_are_unique_shorter_than_tokens_and_url_safe() {
        let ids: HashSet<String> = (0..500).map(|_| new_session_id()).collect();
        assert_eq!(ids.len(), 500, "session ids must not repeat");
        for id in &ids {
            assert_eq!(id.len(), 22, "16 bytes must encode to 22 base64url chars");
            assert!(id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        }
        // Different entropy, different length: a token and an id must never be
        // confusable by a caller that handles both.
        assert!(new_session_id().len() < new_session_token().len());
    }

    #[test]
    fn hashing_is_stable_and_hides_the_token() {
        let token = new_session_token();
        let hash = hash_token(&token);
        assert_eq!(hash, hash_token(&token));
        assert_eq!(hash.len(), 64);
        assert!(hash
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_uppercase()));
        assert_ne!(hash, hash_token(&new_session_token()));
        assert!(!hash.contains(&token));
    }

    #[test]
    fn session_token_is_read_out_of_a_shared_cookie_header() {
        let mut headers = HeaderMap::new();
        headers.insert(
            COOKIE,
            HeaderValue::from_static("theme=dark; app_session=abc123; x=1"),
        );
        assert_eq!(
            session_token_from_headers(&headers).as_deref(),
            Some("abc123")
        );

        headers.insert(COOKIE, HeaderValue::from_static("app_session=only"));
        assert_eq!(
            session_token_from_headers(&headers).as_deref(),
            Some("only")
        );

        headers.insert(COOKIE, HeaderValue::from_static("other=1"));
        assert_eq!(session_token_from_headers(&headers), None);

        headers.insert(COOKIE, HeaderValue::from_static("app_session="));
        assert_eq!(session_token_from_headers(&headers), None);

        assert_eq!(session_token_from_headers(&HeaderMap::new()), None);
    }
}
