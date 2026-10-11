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

function extractHostname(val) {
  if (!val) return null;
  try {
    return new URL(val.includes("://") ? val : `https://${val}`).hostname;
  } catch {
    return null;
  }
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  const cleanOrigin = stripTrailingSlash(origin);
  if (allowedOrigins.length > 0) {
    if (allowedOrigins.includes("*") || allowedOrigins.includes(cleanOrigin)) return true;
  }
  try {
    const url = new URL(cleanOrigin);
    const hostname = url.hostname;
    const vercelHostnames = [
      "mmss64.vercel.app",
      extractHostname(process.env.VERCEL_URL),
      extractHostname(process.env.VERCEL_PROJECT_PRODUCTION_URL),
      extractHostname(process.env.VERCEL_BRANCH_URL),
    ].filter(Boolean);

    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname.endsWith(".localhost") ||
      vercelHostnames.includes(hostname) ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^10\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)
    ) {
      return true;
    }
  } catch {
    // Ignore URL parse errors
  }
  return false;
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

/**
 * Whether a state-changing request came from the same origin the browser addressed.
 *
 * The host the browser used is NOT the `Host` header the server sees once a proxy is
 * in front. Vercel's external rewrite forwards `/api/*` to this VPS by IP, so `Host`
 * arrives as the rewrite destination while the browser's `Origin` is the Vercel
 * domain. Comparing those rejected every logged-in POST/PATCH/DELETE from the real
 * app with 403 "Cross-site request blocked."
 *
 * `xForwardedHost` is what the trusted edge says the client addressed, and nginx
 * passes it through unchanged, so it is preferred; `host` is only the fallback for a
 * direct connection with no proxy. Allowing the forward header does not weaken the
 * defence: the browser sets `Origin` and an attacker's page cannot forge it, so a
 * request from evil.com still arrives with an Origin this function rejects.
 *
 * @param {string|null|undefined} origin   the request's Origin header
 * @param {{host?: string, forwardedHost?: string}} hosts
 * @returns {boolean}
 */
function isSameOriginRequest(origin, { host, forwardedHost } = {}) {
  if (!origin) return false;
  const rawClientHost = (forwardedHost || host || "").split(",")[0].trim();
  if (!rawClientHost) return false;
  try {
    const originUrl = new URL(origin);
    const cleanClientHost = rawClientHost.replace(/:(80|443)$/, "");
    const cleanOriginHost = originUrl.host.replace(/:(80|443)$/, "");
    if (cleanOriginHost === cleanClientHost) return true;
  } catch {
    // Fall back to string check below
  }
  const cleanOrigin = stripTrailingSlash(origin);
  return cleanOrigin.endsWith(`://${rawClientHost}`);
}

module.exports = {
  isProduction,
  allowedOrigins,
  crossSiteCookies,
  isAllowedOrigin,
  isSameOriginRequest,
  sessionCookieOptions,
};
