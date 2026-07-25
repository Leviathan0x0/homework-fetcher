/**
 * Deployment configuration shared by the Express API.
 *
 * When the frontend is served by this same Express process (local dev, single
 * Node host) no extra configuration is needed. When the frontend is hosted
 * separately (Appwrite Sites, Vercel, Netlify, ...) the browser talks to this
 * API cross-origin, which requires explicit CORS allowances and cookies marked
 * SameSite=None; Secure.
 */
const isProduction = process.env.NODE_ENV === "production";

const stripTrailingSlash = (value) => {
  const trimmed = value.trim();
  let end = trimmed.length;
  while (end > 0 && trimmed[end - 1] === "/") end -= 1;
  return trimmed.slice(0, end);
};

const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.APP_ORIGIN || "")
  .split(",")
  .map(stripTrailingSlash)
  .filter(Boolean);

// A separately hosted frontend means the session cookie is sent cross-site.
const crossSiteCookies = process.env.CROSS_SITE_COOKIES === "true" || allowedOrigins.length > 0;

function isAllowedOrigin(origin) {
  if (!origin) return false;
  return allowedOrigins.includes(stripTrailingSlash(origin));
}

/**
 * Cookie options for the app session cookie.
 * SameSite=None requires Secure, so both flags are enabled together.
 */
function sessionCookieOptions(extra = {}) {
  return {
    httpOnly: true,
    secure: crossSiteCookies || isProduction,
    sameSite: crossSiteCookies ? "none" : "lax",
    path: "/",
    ...extra,
  };
}

module.exports = {
  isProduction,
  allowedOrigins,
  crossSiteCookies,
  isAllowedOrigin,
  sessionCookieOptions,
};
