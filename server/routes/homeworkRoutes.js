const express = require("express");
const sessionService = require("../auth/sessionService");
const { requireAuth } = require("../auth/requireAuth");
const { fetchHomeworkForSession, SchoolSessionExpiredError } = require("../edusecure/homeworkService");
const homeworkCacheService = require("../homework/homeworkCacheService");

const router = express.Router();

/**
 * Middleware to authenticate requests via HTTP-only app_session cookie.
 * SECURITY: Never trusts userId from query or body.
 */

// GET /api/homework
// Returns cached homework immediately from SQLite. If cache is stale or empty, triggers EduSecure refresh.
router.get("/homework", requireAuth, async (req, res) => {
  const userId = req.user.id;

  // 1. Retrieve cached homework from SQLite
  let cachedHomework = await homeworkCacheService.getCachedHomework(userId);
  const isStale = await homeworkCacheService.isCacheStale(userId);

  // 2. If cached data exists and is fresh, return immediately
  if (cachedHomework.length > 0 && !isStale) {
    return res.json({
      count: cachedHomework.length,
      homework: cachedHomework,
      isStale: false,
      isRefreshing: false
    });
  }

  // 3. Cache is empty or stale -> Attempt EduSecure background / inline refresh
  const eduSession = await sessionService.getEduSecureSession(userId);
  if (!eduSession || !eduSession.sessionCookies) {
    // If EduSecure session expired, but we have cached homework, return cached homework with sessionExpired flag
    if (cachedHomework.length > 0) {
      return res.json({
        count: cachedHomework.length,
        homework: cachedHomework,
        isStale: true,
        sessionExpired: true,
        warning: "Your school session has expired. Showing cached homework."
      });
    }

    return res.status(401).json({
      code: "SCHOOL_SESSION_EXPIRED",
      message: "Your school session has expired. Please sign in again."
    });
  }

  try {
    const data = await fetchHomeworkForSession(eduSession.sessionCookies);
    const updatedHomework = await homeworkCacheService.upsertHomework(userId, data.homework);

    return res.json({
      count: updatedHomework.length,
      homework: updatedHomework,
      isStale: false,
      isRefreshing: false
    });
  } catch (err) {
    if (err instanceof SchoolSessionExpiredError || err.code === "SCHOOL_SESSION_EXPIRED") {
      await sessionService.removeEduSecureSession(userId);

      // Return cached homework if available even if EduSecure session expired
      if (cachedHomework.length > 0) {
        return res.json({
          count: cachedHomework.length,
          homework: cachedHomework,
          isStale: true,
          sessionExpired: true,
          warning: "Your school session has expired. Showing cached homework."
        });
      }

      return res.status(401).json({
        code: "SCHOOL_SESSION_EXPIRED",
        message: "Your school session has expired. Please sign in again."
      });
    }

    console.error("Homework Fetch Error:", err);

    // Return cached homework on network failure if available
    if (cachedHomework.length > 0) {
      return res.json({
        count: cachedHomework.length,
        homework: cachedHomework,
        isStale: true,
        error: "Unable to refresh from school server. Showing cached homework."
      });
    }

    return res.status(500).json({
      error: "Failed to fetch homework."
    });
  }
});

// POST /api/homework/refresh
// Explicitly forces a fresh fetch from EduSecure, upserts to SQLite, and returns updated list.
router.post("/homework/refresh", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const eduSession = await sessionService.getEduSecureSession(userId);

  if (!eduSession || !eduSession.sessionCookies) {
    return res.status(401).json({
      code: "SCHOOL_SESSION_EXPIRED",
      message: "Your school session has expired. Please sign in again."
    });
  }

  try {
    const data = await fetchHomeworkForSession(eduSession.sessionCookies);
    const updatedHomework = await homeworkCacheService.upsertHomework(userId, data.homework);

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
        message: "Your school session has expired. Please sign in again."
      });
    }

    console.error("Homework Refresh Error:", err);
    return res.status(500).json({
      error: "Failed to refresh homework from school server."
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
