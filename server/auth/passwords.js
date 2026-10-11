"use strict";

/**
 * MMSS64 password hashing.
 *
 * Node's built-in `crypto.scrypt`, deliberately: no native dependency, so this runs
 * unchanged on Vercel serverless functions where a compiled addon would need a
 * rebuild per runtime version. `scrypt` is memory-hard, which matters here because the
 * stored hashes protect a school-wide account database on a host an attacker can read.
 *
 * # Format
 *
 *   scrypt$<N>$<r>$<p>$<base64 salt>$<base64 hash>
 *
 * The version and the cost parameters travel *inside* the stored string. A future
 * change to the cost cannot silently reinterpret existing hashes, and an old hash
 * written before a parameter change keeps verifying: `verify` parses the parameters
 * from the string it was given rather than from the current constants.
 *
 * # What this never does
 *
 * - Store or log a plaintext password, at any point, including on failure.
 * - Compare with `===`. Verification is `timingSafeEqual` over equal-length buffers,
 *   so a wrong password costs the same time as a right one to within a byte.
 * - Truncate or repair a malformed hash. A hash this cannot parse is a rejection, not
 *   a fallback to the EduSecure path -- see the login route for why that matters.
 */

const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);

/** Bumped only alongside a change in how an existing string is interpreted. */
const ALGORITHM = "scrypt";

/**
 * Cost parameters. N=2^15 keeps a single hash near ~100 ms on a small VM, which is
 * slow enough to make an offline guess of 48 student passwords expensive and fast
 * enough that a legitimate login stays unnoticeable. r=8, p=1 are the interactive
 * defaults; the memory-hardness comes from N, not from raising p.
 */
const PARAMS = { N: 32768, r: 8, p: 1, keylen: 64 };

/** Salt length in bytes. 16 is the conventional scrypt default. */
const SALT_BYTES = 16;

/**
 * Password length limits, counted in Unicode code points rather than UTF-16 units so
 * an emoji or a Devanagari character costs one character, not two.
 *
 * The maximum exists because the hash is derived from the whole input: an unbounded
 * body would let one request burn CPU on a gigabyte of password. The minimum matches
 * the Rust backend and the wording already shown in the settings panel, because two
 * different answers to "how short is too short" is how an account gets locked out of
 * one deployment by a rule it passed in another. Login deliberately does not enforce
 * this: a student still signing in through EduSecure types their school password,
 * whatever length the school chose.
 */
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 1024;

/** scrypt needs headroom above its 32 MB working set plus the caller's password. */
const MAX_KEYMEM = 128 * 1024 * 1024;

/**
 * @param {unknown} password
 * @returns {string} the length of the password in code points
 */
function passwordLength(password) {
  return typeof password === "string" ? [...password].length : 0;
}

/**
 * Whether a password is acceptable to store.
 *
 * @param {unknown} password
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function validatePassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    return { ok: false, error: "Enter a new password." };
  }
  if (passwordLength(password) < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (passwordLength(password) > MAX_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Use at most ${MAX_PASSWORD_LENGTH} characters.`,
    };
  }
  // Only whitespace is never a password. Leading/trailing spaces are allowed because
  // users paste them, and silently stripping them produces a password nobody typed.
  if (password.trim().length === 0) {
    return { ok: false, error: "Enter a new password." };
  }
  return { ok: true };
}

/**
 * Derives a hash for `password` under the given parameters.
 *
 * @param {string} password
 * @param {{ N?: number, r?: number, p?: number, keylen?: number }} [params]
 * @returns {Promise<string>} the encoded representation, ready to store
 */
async function hashPassword(password, params = PARAMS) {
  const { N, r, p, keylen } = { ...PARAMS, ...params };
  if (typeof password !== "string" || password.length === 0) {
    throw new TypeError("hashPassword requires a non-empty string");
  }
  if (passwordLength(password) > MAX_PASSWORD_LENGTH) {
    throw new TypeError("password exceeds the maximum length");
  }

  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, keylen, { N, r, p, maxmem: MAX_KEYMEM });

  return [
    ALGORITHM,
    N,
    r,
    p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Parses an encoded hash, or returns null when it is not one this build wrote.
 *
 * A malformed value is treated as "no usable password" rather than as an error to
 * throw: a corrupt row must not be able to turn into a crash on the login path.
 *
 * @param {unknown} encoded
 * @returns {{ N: number, r: number, p: number, salt: Buffer, hash: Buffer } | null}
 */
function parseHash(encoded) {
  if (typeof encoded !== "string") return null;
  const parts = encoded.split("$");
  if (parts.length !== 6) return null;
  const [algorithm, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  if (algorithm !== ALGORITHM) return null;

  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  // A stored hash is untrusted input: these bounds stop a tampered row from asking
  // for a 2^30 scrypt that would pin a function instance until it is killed.
  if (N < 2 || N > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16) return null;

  let salt;
  let hash;
  try {
    salt = Buffer.from(rawSalt, "base64");
    hash = Buffer.from(rawHash, "base64");
  } catch {
    return null;
  }
  if (salt.length === 0 || hash.length === 0) return null;

  // `Buffer.from(x, "base64")` is lenient: it silently skips characters outside the
  // alphabet and stops at the first invalid one, so "onlyfour" decodes to six bytes
  // and the string parses. Every hash this module writes is canonical base64 that
  // round-trips exactly, so requiring that rules out the whole class of
  // almost-but-not-quite values without rejecting anything genuine.
  if (salt.toString("base64") !== rawSalt || hash.toString("base64") !== rawHash) {
    return null;
  }

  return { N, r, p, salt, hash };
}

/**
 * Verifies a password against an encoded hash.
 *
 * Always false for a null, empty or malformed hash -- there is no "no hash configured"
 * branch here, because the caller must decide what an absent password means (the
 * login route sends those accounts to EduSecure) rather than having it decided here.
 *
 * @param {string} password
 * @param {unknown} encoded
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, encoded) {
  const parsed = parseHash(encoded);
  if (!parsed) return false;
  if (typeof password !== "string" || password.length === 0) return false;
  if (passwordLength(password) > MAX_PASSWORD_LENGTH) return false;

  let derived;
  try {
    // Parameters come from the stored string, so raising the cost later does not
    // invalidate accounts created before the change.
    derived = await scrypt(password, parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: MAX_KEYMEM,
    });
  } catch {
    return false;
  }

  if (derived.length !== parsed.hash.length) return false;
  return crypto.timingSafeEqual(derived, parsed.hash);
}

module.exports = {
  ALGORITHM,
  PARAMS,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  validatePassword,
  hashPassword,
  verifyPassword,
  parseHash,
};
