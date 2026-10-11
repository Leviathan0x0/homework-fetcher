//! Authenticated encryption for secrets that must stay recoverable.
//!
//! The MMSS64 password is hashed, because nothing ever needs to read it back. The
//! EduSecure credential is not: the backend has to hand the real password to the
//! school portal in order to fetch homework. A hash cannot do that job, so this
//! module exists for exactly one value and does one thing well.
//!
//! # The rule this module enforces
//!
//! **No plaintext, ever.** [`seal`] is the only way to produce a stored value and
//! there is no plaintext fallback anywhere. A deployment with no key cannot store a
//! credential, which is a loud failure at the point of use rather than a quiet
//! plaintext row in a table an operator will one day dump.
//!
//! # Cipher
//!
//! AES-256-GCM, which is AEAD: the ciphertext carries its own authentication tag, so
//! a row that was edited, truncated or rolled back from a different key fails to
//! decrypt instead of returning garbage that would then be sent to the portal as a
//! password. A fresh 96-bit nonce per seal, from the same operating system CSPRNG the
//! session tokens use. Hex rather than base64 because the codebase already encodes hex
//! and hand-rolling a base64 *decoder* is exactly the kind of thing that is subtly
//! wrong in a way only a corrupted row would ever reveal.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};

/// Version prefix on every stored value. A scheme change later becomes "decrypt with
/// the old one" rather than "fail everywhere at once".
const PREFIX: &str = "v1";

/// AES-GCM standard nonce: 96 bits.
const NONCE_LEN: usize = 12;

/// The 32-byte key an `Aes256Gcm` is built from.
#[derive(Clone, PartialEq, Eq)]
pub struct CredentialKey([u8; 32]);

impl std::fmt::Debug for CredentialKey {
    /// Redacted, because `Config` is `Debug` and a key printed in a startup log is a
    /// key in a log aggregator. The EduSecure password does the same thing.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("CredentialKey(<redacted>)")
    }
}

impl CredentialKey {
    /// Parses a key from its environment representation: 64 hex characters, which is
    /// `openssl rand -hex 32` and the only form documented.
    ///
    /// Rejects anything else rather than deriving from a weak string. A short or
    /// misspelt `CREDENTIAL_ENCRYPTION_KEY` must fail the boot or the setup flow --
    /// never silently become a predictable key.
    pub fn from_hex(raw: &str) -> Result<Self, CryptoError> {
        let trimmed = raw.trim();
        if trimmed.len() != 64 {
            return Err(CryptoError::Key);
        }
        let mut bytes = [0u8; 32];
        for (index, byte) in bytes.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&trimmed[index * 2..index * 2 + 2], 16)
                .map_err(|_| CryptoError::Key)?;
        }
        Ok(Self(bytes))
    }

    fn cipher(&self) -> Aes256Gcm {
        Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.0))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum CryptoError {
    /// No usable `CREDENTIAL_ENCRYPTION_KEY`. Never recoverable into a stored value.
    #[error("secure credential storage is not configured on this server")]
    Key,
    /// The value could not be encrypted. Almost always "the OS has no entropy", which
    /// is the same condition that stops a session token being minted.
    #[error("could not encrypt the credential")]
    Seal,
    /// The stored value is not something this key can open: wrong key, truncated
    /// value, a row edited by hand, or a value sealed under a different scheme.
    #[error("could not decrypt the stored credential")]
    Open,
}

/// Encrypts `plaintext` into the stored `v1.<nonce>.<ciphertext>` form.
///
/// Never returns the plaintext in the output, never logs it, and never touches the
/// database: the caller decides when the sealed string is safe to persist.
pub fn seal(key: &CredentialKey, plaintext: &str) -> Result<String, CryptoError> {
    let mut nonce_bytes = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce_bytes).map_err(|_| CryptoError::Seal)?;

    // The nonce is authenticated as the AEAD's associated data, so it cannot be
    // swapped between two rows without the tag failing.
    let sealed = key
        .cipher()
        .encrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload {
                msg: plaintext.as_bytes(),
                aad: PREFIX.as_bytes(),
            },
        )
        .map_err(|_| CryptoError::Seal)?;

    Ok(format!(
        "{PREFIX}.{}.{}",
        to_hex(&nonce_bytes),
        to_hex(&sealed)
    ))
}

/// Recovers the plaintext from a stored value.
///
/// The only caller permitted to do this is the backend, and only on the path that
/// needs the real password to fetch homework. The returned `String` is the caller's
/// to drop as soon as the request that needs it is over.
pub fn open(key: &CredentialKey, sealed: &str) -> Result<String, CryptoError> {
    let mut parts = sealed.split('.');
    let (Some(version), Some(nonce), Some(ciphertext), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(CryptoError::Open);
    };
    if version != PREFIX {
        return Err(CryptoError::Open);
    }
    let nonce = from_hex::<NONCE_LEN>(nonce)?;
    let ciphertext = from_hex_vec(ciphertext)?;

    let plaintext = key
        .cipher()
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: version.as_bytes(),
            },
        )
        .map_err(|_| CryptoError::Open)?;
    String::from_utf8(plaintext).map_err(|_| CryptoError::Open)
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut out, byte| {
        use std::fmt::Write as _;
        let _ = write!(out, "{byte:02x}");
        out
    })
}

fn from_hex<const N: usize>(raw: &str) -> Result<[u8; N], CryptoError> {
    let bytes = from_hex_vec(raw)?;
    bytes.try_into().map_err(|_| CryptoError::Open)
}

fn from_hex_vec(raw: &str) -> Result<Vec<u8>, CryptoError> {
    if !raw.len().is_multiple_of(2) {
        return Err(CryptoError::Open);
    }
    (0..raw.len() / 2)
        .map(|index| {
            u8::from_str_radix(&raw[index * 2..index * 2 + 2], 16).map_err(|_| CryptoError::Open)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> CredentialKey {
        CredentialKey::from_hex(&"ab".repeat(32)).unwrap()
    }

    #[test]
    fn a_sealed_value_round_trips() {
        let key = key();
        let sealed = seal(&key, "hunter2").unwrap();
        assert_eq!(open(&key, &sealed).unwrap(), "hunter2");
    }

    #[test]
    fn the_stored_value_is_never_the_plaintext() {
        let sealed = seal(&key(), "correct horse battery staple").unwrap();
        assert!(!sealed.contains("correct"));
        assert!(!sealed.contains("horse"));
        assert!(sealed.starts_with("v1."));
    }

    #[test]
    fn the_same_secret_seals_differently_every_time() {
        let key = key();
        let a = seal(&key, "hunter2").unwrap();
        let b = seal(&key, "hunter2").unwrap();
        assert_ne!(
            a, b,
            "a fresh nonce per seal, or GCM leaks equal plaintexts"
        );
        assert_eq!(open(&key, &a).unwrap(), open(&key, &b).unwrap());
    }

    #[test]
    fn a_different_key_cannot_open_the_value() {
        let sealed = seal(&key(), "hunter2").unwrap();
        let other = CredentialKey::from_hex(&"cd".repeat(32)).unwrap();
        assert_eq!(open(&other, &sealed).unwrap_err(), CryptoError::Open);
    }

    #[test]
    fn tampering_with_any_part_of_the_value_is_refused() {
        let key = key();
        let sealed = seal(&key, "hunter2").unwrap();

        // Flip one hex digit of the ciphertext: GCM's tag must catch it.
        let mut tampered = sealed.clone();
        let last = tampered.pop().unwrap();
        tampered.push(if last == 'a' { 'b' } else { 'a' });
        assert_eq!(open(&key, &tampered).unwrap_err(), CryptoError::Open);

        // Truncated, empty, or shaped wrong in every other way.
        for broken in [
            "",
            "v1",
            "v1.00",
            "v2.00.00",
            "hunter2",
            &sealed[..sealed.len() - 2],
        ] {
            assert!(open(&key, broken).is_err(), "{broken:?} must not open");
        }
    }

    #[test]
    fn a_key_that_is_not_thirty_two_bytes_is_refused_rather_than_padded() {
        for bad in [
            "",
            "ab",
            &"ab".repeat(31),
            &"ab".repeat(33),
            &"zz".repeat(32),
        ] {
            assert_eq!(
                CredentialKey::from_hex(bad).unwrap_err(),
                CryptoError::Key,
                "{bad:?} must not become a key"
            );
        }
        // Surrounding whitespace is a shell export habit, not a mistake.
        assert!(CredentialKey::from_hex(&format!("  {}  ", "ab".repeat(32))).is_ok());
    }

    #[test]
    fn a_key_never_prints_itself() {
        let rendered = format!("{:?}", key());
        assert_eq!(rendered, "CredentialKey(<redacted>)");
        assert!(!rendered.contains("abab"));
    }
}
