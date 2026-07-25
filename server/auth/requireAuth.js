const sessionService = require("./sessionService");

/**
 * Reads the session token from either transport.
 *
 * Browsers use the httpOnly `app_session` cookie. Native mobile clients cannot
 * rely on cookie storage, so they send the same signed token in an
 * `Authorization: Bearer <token>` header. Both resolve to the same session.
 *
 * @param {import("express").Request} req
 * @returns {string|null}
 */
function getRequestToken(req) {
  const header = req.get("authorization") || req.get("Authorization");
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match) return match[1].trim();
  }
  return req.cookies?.app_session || null;
}

/**
 * Resolves the session for a request, or null when unauthenticated.
 * @param {import("express").Request} req
 */
async function getRequestSession(req) {
  return sessionService.getAppSession(getRequestToken(req));
}

/** Express middleware that rejects unauthenticated requests. */
async function requireAuth(req, res, next) {
  try {
    const activeSession = await getRequestSession(req);
    if (!activeSession) {
      return res.status(401).json({ code: "UNAUTHENTICATED", message: "Not authenticated." });
    }
    req.user = activeSession.user;
    req.sessionToken = activeSession.token;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth, getRequestSession, getRequestToken };
