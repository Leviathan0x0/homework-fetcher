const express = require("express");
const sessionService = require("../auth/sessionService");
const { requireAuth } = require("../auth/requireAuth");
const {
  fetchSchoolCalendarForSession,
} = require("../edusecure/calendarService");
const { SchoolSessionExpiredError } = require("../edusecure/homeworkService");
const calendarCacheService = require("../calendar/calendarCacheService");

const router = express.Router();

// Refreshes in flight, keyed by user. A stale cache makes every GET start a
// refresh, and overlapping ones scrape the portal repeatedly and race to insert
// the same rows.
const refreshesInFlight = new Map();

function refreshFromEduSecure(userId) {
  const running = refreshesInFlight.get(userId);
  if (running) return running;

  const pending = refreshFromEduSecureUncoalesced(userId).finally(() => {
    refreshesInFlight.delete(userId);
  });
  refreshesInFlight.set(userId, pending);
  return pending;
}

async function refreshFromEduSecureUncoalesced(userId) {
  const eduSession = await sessionService.getEduSecureSession(userId);
  if (!eduSession || !eduSession.sessionCookies) {
    throw new SchoolSessionExpiredError();
  }
  const data = await fetchSchoolCalendarForSession(eduSession.sessionCookies);
  await calendarCacheService.upsertEvents(userId, data.events);
  return calendarCacheService.getCachedEvents(userId);
}

// GET /api/calendar - school holidays & events from EduSecure (cached)
router.get("/calendar", requireAuth, async (req, res) => {
  const userId = req.user.id;

  try {
    // Cache read and staleness check are independent; run them together so a
    // calendar load is one round trip, not two back to back.
    let [events, stale] = await Promise.all([
      calendarCacheService.getCachedEvents(userId),
      calendarCacheService.isCacheStale(userId),
    ]);

    if (events.length > 0) {
      if (stale) {
        refreshFromEduSecure(userId).catch((err) => {
          console.error("Background calendar refresh error:", err.message);
        });
      }
      return res.json({
        count: events.length,
        events,
        isStale: stale,
      });
    }

    // Empty cache - fetch inline
    try {
      events = await refreshFromEduSecure(userId);
      return res.json({ count: events.length, events, isStale: false });
    } catch (err) {
      if (err instanceof SchoolSessionExpiredError) {
        return res.status(401).json({
          error: "Your school session has expired. Reconnect with your school password to continue.",
          code: "SCHOOL_SESSION_EXPIRED",
          events: [],
          count: 0,
        });
      }
      console.error("Calendar fetch error:", err.message);
      return res.status(502).json({
        error: "Unable to load the school calendar from EduSecure.",
        events: [],
        count: 0,
      });
    }
  } catch (err) {
    console.error("GET /calendar:", err);
    return res.status(500).json({ error: "Failed to load school calendar." });
  }
});

// POST /api/calendar/refresh - force refresh from EduSecure
router.post("/calendar/refresh", requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    const events = await refreshFromEduSecure(userId);
    return res.json({ count: events.length, events, isStale: false });
  } catch (err) {
    if (err instanceof SchoolSessionExpiredError) {
      const cached = await calendarCacheService.getCachedEvents(userId);
      return res.status(401).json({
        error: "Your school session has expired. Reconnect with your school password to continue.",
        code: "SCHOOL_SESSION_EXPIRED",
        events: cached,
        count: cached.length,
      });
    }
    console.error("POST /calendar/refresh:", err.message);
    const cached = await calendarCacheService.getCachedEvents(userId);
    return res.status(502).json({
      error: "Unable to refresh the school calendar from EduSecure.",
      events: cached,
      count: cached.length,
    });
  }
});

// PATCH /api/calendar/:id/selected - pin/unpin a holiday on the calendar
router.patch("/calendar/:id/selected", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const eventId = req.params.id;
  const selected = !!req.body?.selected;

  try {
    await calendarCacheService.setEventSelected(userId, eventId, selected);
    const updated = await calendarCacheService.getCachedEvent(userId, eventId);
    if (!updated) {
      return res.status(404).json({ error: "Calendar event not found." });
    }
    return res.json({ event: updated });
  } catch (err) {
    console.error("PATCH /calendar/:id/selected:", err.message);
    return res.status(500).json({ error: "Failed to update calendar event." });
  }
});

module.exports = router;
