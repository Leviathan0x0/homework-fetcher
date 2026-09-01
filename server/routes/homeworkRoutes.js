const express = require("express");
const sessionService = require("../auth/sessionService");
const { isAdminAccount } = require("../auth/sessionService");
const { requireAuth } = require("../auth/requireAuth");
const {
  fetchHomeworkForSession,
  SchoolSessionExpiredError,
} = require("../edusecure/homeworkService");
const homeworkCacheService = require("../homework/homeworkCacheService");

const router = express.Router();

/**
 * EduSecure refreshes in flight, keyed by user.
 *
 * Scraping the school portal is by far the slowest thing this API does, and the
 * dashboard can ask for homework several times in a row (initial load, tab
 * switch, manual refresh). Without this, each of those starts its own scrape and
 * they queue up behind each other; sharing the promise makes the extra callers
 * wait on the one request that is already running.
 */
const refreshesInFlight = new Map();

function refreshFromSchool(userId, sessionCookies) {
  const running = refreshesInFlight.get(userId);
  if (running) return running;

  const pending = (async () => {
    const data = await fetchHomeworkForSession(sessionCookies);
    return homeworkCacheService.upsertHomework(userId, data.homework);
  })().finally(() => {
    refreshesInFlight.delete(userId);
  });

  refreshesInFlight.set(userId, pending);
  return pending;
}

/**
 * Middleware to authenticate requests via HTTP-only app_session cookie.
 * SECURITY: Never trusts userId from query or body.
 */

// GET /api/homework
// GET /api/homework
// Returns cached homework immediately from SQLite (<10ms). If cache is stale, triggers background EduSecure refresh.
router.get("/homework", requireAuth, async (req, res) => {
  const userId = req.user.id;

  // Administrators have no EduSecure account behind them, so there is no diary
  // to scrape and no school session that could expire. Falling through would
  // answer with SCHOOL_SESSION_EXPIRED and send them to a reconnect prompt that
  // is guaranteed to refuse them.
  if (isAdminAccount(req.user)) {
    return res.json({
      count: 0,
      homework: [],
      isStale: false,
      isRefreshing: false,
      schoolSessionExpired: false,
    });
  }

  // 1. Retrieve cached homework from SQLite, check staleness and load the
  // school session in the same breath - they are independent reads, so waiting
  // on them one after the other multiplies the latency of every cache hit.
  let cachedHomework;
  let cacheStale = true;
  let eduSession = null;
  try {
    [cachedHomework, cacheStale, eduSession] = await Promise.all([
      homeworkCacheService.getCachedHomework(userId),
      homeworkCacheService.isCacheStale(userId),
      sessionService.getEduSecureSession(userId),
    ]);
  } catch (err) {
    console.error("Homework cache read error:", err.message);
    cachedHomework = [];
  }
  let hasTodayEntry = false;
  if (cachedHomework.length > 0) {
    const now = new Date();
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const nowIst = new Date(now.getTime() + (now.getTimezoneOffset() * 60 * 1000) + istOffsetMs);
    const day = nowIst.getDate();
    const month = nowIst.getMonth() + 1;
    const year = nowIst.getFullYear();
    const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const monthShort = monthNames[nowIst.getMonth()];
    const dStr = String(day).padStart(2, "0");
    const mStr = String(month).padStart(2, "0");

    hasTodayEntry = cachedHomework.some((item) => {
      const str = (item?.date || "").toLowerCase().trim();
      if (!str) return false;
      if (str.includes(`${dStr} ${monthShort}`) || str.includes(`${day} ${monthShort}`)) return true;
      if (str.includes(`${year}-${mStr}-${dStr}`) || str.includes(`${dStr}-${mStr}-${year}`) || str.includes(`${dStr}/${mStr}/${year}`) || str.includes(`${dStr}.${mStr}.${year}`)) return true;
      return false;
    });
  }

  if (!hasTodayEntry) {
    cacheStale = true;
  }

  const hasSchoolSession = Boolean(eduSession && eduSession.sessionCookies);

  // 2. If cached data exists (even if stale), return immediately for instant render (<15ms)
  if (cachedHomework.length > 0) {
    // If cache is stale, trigger background refresh asynchronously without freezing the user
    if (cacheStale && hasSchoolSession && !refreshesInFlight.has(userId)) {
      (async () => {
        try {
          await refreshFromSchool(userId, eduSession.sessionCookies);
        } catch (err) {
          console.error("Background homework refresh error:", err.message);
        }
      })();
    }

    return res.json({
      count: cachedHomework.length,
      homework: cachedHomework,
      isStale: cacheStale,
      isRefreshing: false,
      // Cached homework still renders, but without this the app had no way to
      // tell that nothing new can arrive until the student reconnects - it just
      // kept showing the same list indefinitely.
      schoolSessionExpired: !hasSchoolSession,
    });
  }

  // 3. Cache is completely empty -> Attempt inline fetch
  if (!hasSchoolSession) {
    return res.status(401).json({
      code: "SCHOOL_SESSION_EXPIRED",
      message: "Your school session has expired. Reconnect with your school password to continue."
    });
  }

  try {
    const updatedHomework = await refreshFromSchool(userId, eduSession.sessionCookies);

    return res.json({
      count: updatedHomework.length,
      homework: updatedHomework,
      isStale: false,
      isRefreshing: false
    });
  } catch (err) {
    // Only reachable with an empty cache: the branch above returns first
    // whenever there is anything at all to show.
    if (err instanceof SchoolSessionExpiredError || err.code === "SCHOOL_SESSION_EXPIRED") {
      await sessionService.removeEduSecureSession(userId);

      return res.status(401).json({
        code: "SCHOOL_SESSION_EXPIRED",
        message: "Your school session has expired. Reconnect with your school password to continue."
      });
    }

    console.error("Homework Fetch Error:", err);

    return res.status(err?.statusCode === 502 ? 502 : 500).json({
      error: err?.message || "Failed to fetch homework."
    });
  }
});

// POST /api/homework/refresh
// Explicitly forces a fresh fetch from EduSecure, upserts to SQLite, and returns updated list.
router.post("/homework/refresh", requireAuth, async (req, res) => {
  const userId = req.user.id;

  if (isAdminAccount(req.user)) {
    return res.json({ count: 0, homework: [], isStale: false });
  }

  const eduSession = await sessionService.getEduSecureSession(userId);

  if (!eduSession || !eduSession.sessionCookies) {
    return res.status(401).json({
      code: "SCHOOL_SESSION_EXPIRED",
      message: "Your school session has expired. Reconnect with your school password to continue."
    });
  }

  try {
    const updatedHomework = await refreshFromSchool(userId, eduSession.sessionCookies);

    return res.json({
      count: updatedHomework.length,
      homework: updatedHomework,
      isStale: false
    });
  } catch (err) {
    if (err instanceof SchoolSessionExpiredError || err.code === "SCHOOL_SESSION_EXPIRED") {
      await sessionService.removeEduSecureSession(userId);
      return res.status(401).json({
        code: "SCHOOL_SESSION_EXPIRED",
        message: "Your school session has expired. Reconnect with your school password to continue."
      });
    }

    let cachedHomework = [];
    try {
      cachedHomework = await homeworkCacheService.getCachedHomework(userId);
    } catch (cacheErr) {
      console.error("Homework fallback cache read failed:", cacheErr.message);
    }
    if (cachedHomework.length > 0) {
      console.error("Homework Refresh Error; serving cached homework:", err);
      return res.json({
        count: cachedHomework.length,
        homework: cachedHomework,
        isStale: true,
        refreshFailed: true,
        refreshError: err?.message || "EduSecure could not be reached. Cached homework is still shown.",
      });
    }

    console.error("Homework Refresh Error:", err);
    return res.status(err?.statusCode === 502 ? 502 : 500).json({
      error: err?.message || "Failed to refresh homework from school server."
    });
  }
});

// PATCH /api/homework/:id/status
// Updates completion status for a specific homework entry owned by the authenticated user.
router.patch("/homework/:id/status", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const homeworkId = req.params.id;
    const { completed } = req.body || {};

    if (typeof completed !== "boolean") {
      return res.status(400).json({
        error: "Field 'completed' must be a boolean."
      });
    }

    const result = await homeworkCacheService.updateHomeworkStatus(userId, homeworkId, completed);
    return res.json(result);
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: "Homework not found or unauthorized." });
    }
    console.error("Update Status Error:", err);
    return res.status(500).json({ error: "Failed to update completion status." });
  }
});

// PATCH /api/homework/:id/note
// Updates personal note for a specific homework entry owned by the authenticated user.
router.patch("/homework/:id/note", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const homeworkId = req.params.id;
    const { note } = req.body || {};

    if (note !== null && typeof note !== "string") {
      return res.status(400).json({
        error: "Field 'note' must be a string or null."
      });
    }

    const result = await homeworkCacheService.updateHomeworkNote(userId, homeworkId, note);
    return res.json(result);
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: "Homework not found or unauthorized." });
    }
    console.error("Update Note Error:", err);
    return res.status(500).json({ error: "Failed to update personal note." });
  }
});

module.exports = router;
