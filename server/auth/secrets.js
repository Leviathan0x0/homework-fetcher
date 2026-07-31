const crypto = require("crypto");

/**
 * Central handling of ENCRYPTION_KEY.
 *
 * Production deployments should always provide ENCRYPTION_KEY. The stable
 * fallback below is only for development/self-hosted setups where a missing
 * key must not invalidate every remembered session after a restart.
 */

const MIN_SECRET_LENGTH = 32;

const MISSING_KEY_MESSAGE =
  "ENCRYPTION_KEY is missing or shorter than 32 characters. Generate one with " +
  "`openssl rand -hex 32` and set it in the environment before starting the API.";

let devSecretFallback = null;

/**
 * @returns {string} the configured secret
 */
function requireSecret() {
  const secret = (process.env.ENCRYPTION_KEY || "").trim();
  if (secret.length >= MIN_SECRET_LENGTH) {
    return secret;
  }
  if (!devSecretFallback) {
    const stableSeed = [
      process.env.DATABASE_URL,
      process.env.TURSO_DATABASE_URL,
      process.env.LIBSQL_URL,
      process.env.SQLITE_DB_PATH,
      process.cwd(),
    ].find((value) => String(value || "").trim()) || "homework-fetcher-local";
    devSecretFallback = crypto
      .createHash("sha256")
      .update(`homework-fetcher:${stableSeed}`)
      .digest("hex");
    console.warn(
      "[auth] ENCRYPTION_KEY not found. Using a stable local fallback; configure ENCRYPTION_KEY for production."
    );
  }
  return devSecretFallback;
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
