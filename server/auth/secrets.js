const crypto = require("crypto");

/**
 * Central handling of ENCRYPTION_KEY.
 *
 * There is deliberately no fallback value: a default committed to the
 * repository would let anyone forge session cookies and decrypt stored school
 * portal sessions. The API refuses to serve requests until a real key is set.
 */

const MIN_SECRET_LENGTH = 32;

const MISSING_KEY_MESSAGE =
  "ENCRYPTION_KEY is missing or shorter than 32 characters. Generate one with " +
  "`openssl rand -hex 32` and set it in the environment before starting the API.";

/**
 * @returns {string} the configured secret
 * @throws {Error} when no usable secret is configured
 */
function requireSecret() {
  const secret = (process.env.ENCRYPTION_KEY || "").trim();
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(MISSING_KEY_MESSAGE);
  }
  return secret;
}

/**
 * Derives a purpose-specific key from ENCRYPTION_KEY.
 *
 * Each purpose gets its own HKDF `info` label, so the cookie signing key and
 * the data encryption key cannot be derived from one another.
 * @param {string} purpose
 * @param {number} [length]
 * @returns {Buffer}
 */
function deriveKey(purpose, length = 32) {
  return Buffer.from(
    crypto.hkdfSync("sha256", requireSecret(), "homework-fetcher-hkdf-salt", purpose, length)
  );
}

/**
 * @returns {boolean} whether a usable ENCRYPTION_KEY is configured
 */
function isConfigured() {
  try {
    requireSecret();
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  MISSING_KEY_MESSAGE,
  deriveKey,
  isConfigured,
  requireSecret,
};
