const { isServerless } = require("./uploads");

// Serverless platforms cap the request body (Vercel rejects anything above
// ~4.5 MB before the function runs), so uploads must stay below that or the
// client gets an opaque failure. A normal Node host has no such limit.
const MAX_UPLOAD_BYTES = isServerless ? 4 * 1024 * 1024 : 10 * 1024 * 1024;

const MAX_MESSAGE_CHARS = 4000;
const MAX_REQUEST_TITLE_CHARS = 120;
const MAX_REQUEST_BODY_CHARS = 2000;
const MAX_DISPLAY_NAME_CHARS = 40;
const MAX_SEARCH_QUERY_CHARS = 64;

const buckets = new Map();

/**
 * Best-effort in-process rate limiter.
 *
 * On serverless hosts each instance keeps its own counters, so this is a guard
 * against runaway clients and accidental request loops rather than a strict
 * quota. A shared store (Redis) would be needed for hard enforcement.
 *
 * @param {{windowMs: number, max: number, name: string}} options
 */
function rateLimit({ windowMs, max, name }) {
  return function rateLimitMiddleware(req, res, next) {
    const identity = req.user?.id || req.ip || "anonymous";
    const key = `${name}:${identity}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    if (bucket.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        error: "Too many requests. Please slow down and try again in a moment.",
      });
    }

    // Opportunistic cleanup so the map cannot grow without bound.
    if (buckets.size > 5000) {
      for (const [existingKey, existingBucket] of buckets) {
        if (now > existingBucket.resetAt) buckets.delete(existingKey);
      }
    }

    next();
  };
}

/**
 * Trims a string field and enforces a maximum length.
 * @returns {{value: string, tooLong: boolean}}
 */
function limitText(value, maxChars) {
  const text = typeof value === "string" ? value.trim() : "";
  return { value: text.slice(0, maxChars), tooLong: text.length > maxChars };
}

module.exports = {
  MAX_UPLOAD_BYTES,
  MAX_MESSAGE_CHARS,
  MAX_REQUEST_TITLE_CHARS,
  MAX_REQUEST_BODY_CHARS,
  MAX_DISPLAY_NAME_CHARS,
  MAX_SEARCH_QUERY_CHARS,
  rateLimit,
  limitText,
};
