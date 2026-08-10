const express = require("express");
const { requireAuth } = require("../auth/requireAuth");
const sessionService = require("../auth/sessionService");
const { SchoolSessionExpiredError } = require("../edusecure/homeworkService");
const {
  fetchSchoolNoticesForSession,
  getNoticeSource,
} = require("../edusecure/schoolNoticesService");

const router = express.Router();
const cache = new Map();
const refreshesInFlight = new Map();
const CACHE_MAX_AGE_MS =
  (parseInt(process.env.SCHOOL_NOTICES_CACHE_MAX_AGE_MINUTES || "15", 10) || 15) *
  60 *
  1000;

function cacheKey(userId, kind) {
  return `${userId}:${kind}`;
}

function cachedFor(userId, kind) {
  return cache.get(cacheKey(userId, kind)) || null;
}

function isStale(cached) {
  return !cached || Date.now() - cached.updatedAt > CACHE_MAX_AGE_MS;
}

async function refreshFromEduSecure(userId, kind) {
  const key = cacheKey(userId, kind);
  const running = refreshesInFlight.get(key);
  if (running) return running;

  const pending = (async () => {
    const eduSession = await sessionService.getEduSecureSession(userId);
    if (!eduSession?.sessionCookies) throw new SchoolSessionExpiredError();

    const data = await fetchSchoolNoticesForSession(eduSession.sessionCookies, kind);
    const next = { notices: data.notices, updatedAt: Date.now() };
    cache.set(key, next);
    return next;
  })().finally(() => {
    refreshesInFlight.delete(key);
  });

  refreshesInFlight.set(key, pending);
  return pending;
}

function invalidKind(res) {
  return res.status(404).json({ error: "Unknown school update type." });
}

function expiredResponse(res, notices = []) {
  return res.status(401).json({
    error: "Your school session has expired. Reconnect with your school password to continue.",
    code: "SCHOOL_SESSION_EXPIRED",
    count: notices.length,
    notices,
  });
}

// GET /api/school-updates/:kind - cached Circulars or Important messages.
router.get("/school-updates/:kind", requireAuth, async (req, res) => {
  const source = getNoticeSource(req.params.kind);
  if (!source) return invalidKind(res);

  const userId = req.user.id;
  const cached = cachedFor(userId, source.kind);
  if (cached) {
    const stale = isStale(cached);
    if (stale) {
      refreshFromEduSecure(userId, source.kind).catch((err) => {
        console.error(`Background ${source.kind} refresh error:`, err.message);
      });
    }
    return res.json({
      count: cached.notices.length,
      notices: cached.notices,
      isStale: stale,
    });
  }

  try {
    const fresh = await refreshFromEduSecure(userId, source.kind);
    return res.json({ count: fresh.notices.length, notices: fresh.notices, isStale: false });
  } catch (err) {
    if (err instanceof SchoolSessionExpiredError || err?.code === "SCHOOL_SESSION_EXPIRED") {
      return expiredResponse(res);
    }
    console.error(`GET /school-updates/${source.kind}:`, err);
    return res.status(err?.statusCode === 502 ? 502 : 500).json({
      error: "Unable to load school updates from EduSecure.",
      notices: [],
      count: 0,
    });
  }
});

// POST /api/school-updates/:kind/refresh - explicit refresh, with cached fallback.
router.post("/school-updates/:kind/refresh", requireAuth, async (req, res) => {
  const source = getNoticeSource(req.params.kind);
  if (!source) return invalidKind(res);

  const userId = req.user.id;
  try {
    const fresh = await refreshFromEduSecure(userId, source.kind);
    return res.json({ count: fresh.notices.length, notices: fresh.notices, isStale: false });
  } catch (err) {
    const cached = cachedFor(userId, source.kind);
    if (err instanceof SchoolSessionExpiredError || err?.code === "SCHOOL_SESSION_EXPIRED") {
      return expiredResponse(res, cached?.notices || []);
    }
    if (cached) {
      console.error(`POST /school-updates/${source.kind}/refresh; serving cache:`, err);
      return res.json({
        count: cached.notices.length,
        notices: cached.notices,
        isStale: true,
        refreshFailed: true,
      });
    }
    console.error(`POST /school-updates/${source.kind}/refresh:`, err);
    return res.status(err?.statusCode === 502 ? 502 : 500).json({
      error: "Unable to refresh school updates from EduSecure.",
      notices: [],
      count: 0,
    });
  }
});

module.exports = router;
