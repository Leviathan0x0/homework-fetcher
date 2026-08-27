const express = require("express");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { requireAuth } = require("../auth/requireAuth");
const sessionService = require("../auth/sessionService");
const { measureRequestTiming } = require("../performance/requestTiming");
const { SchoolSessionExpiredError } = require("../edusecure/homeworkService");
const { applyDownloadHeaders, resolveUploadType } = require("../files/fileTypes");
const {
  allowedAttachmentUrl,
  countRecentNotices,
  fetchSchoolNoticeAttachment,
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

function attachmentProxyUrl(url) {
  return `/api/school-updates/attachment?url=${encodeURIComponent(url)}`;
}

function clientNotice(notice) {
  const rawAttachments =
    Array.isArray(notice.attachments) && notice.attachments.length > 0
      ? notice.attachments
      : notice.attachment
        ? [{ url: notice.attachment, name: notice.attachmentName || null }]
        : [];
  const attachments = rawAttachments
    .filter((attachment) => allowedAttachmentUrl(attachment?.url))
    .map((attachment) => ({
      url: attachmentProxyUrl(attachment.url),
      name: attachment.name || null,
    }));

  return {
    ...notice,
    attachments,
    attachment: attachments[0]?.url || null,
    attachmentName: attachments[0]?.name || null,
  };
}

function clientNotices(notices) {
  return (notices || []).map(clientNotice);
}

function noticePayload(notices, extra = {}) {
  const visibleNotices = clientNotices(notices);
  return {
    count: visibleNotices.length,
    recentCount: countRecentNotices(visibleNotices, 3),
    notices: visibleNotices,
    ...extra,
  };
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
    ...noticePayload(notices),
  });
}

// GET /api/school-updates/attachment - authenticated proxy for EduSecure files.
router.get("/school-updates/attachment", requireAuth, async (req, res) => {
  const targetUrl = typeof req.query.url === "string" ? req.query.url : "";
  if (!allowedAttachmentUrl(targetUrl)) {
    return res.status(400).json({ error: "Invalid school attachment URL." });
  }

  const eduSession = await sessionService.getEduSecureSession(req.user.id);
  if (!eduSession?.sessionCookies) return expiredResponse(res);

  try {
    await measureRequestTiming("edusecure_attachment", async () => {
      const attachment = await fetchSchoolNoticeAttachment(
        eduSession.sessionCookies,
        targetUrl
      );
      const previewType = resolveUploadType(attachment.filename)?.contentType;
      applyDownloadHeaders(res, {
        contentType: previewType || attachment.contentType,
        filename: attachment.filename,
        head: attachment.head.subarray(0, 16),
      });
      res.setHeader("Cache-Control", "private, no-store");
      if (attachment.contentLength) {
        res.setHeader("Content-Length", String(attachment.contentLength));
      }
      await pipeline(Readable.from(attachment.body), res);
    });
    return;
  } catch (err) {
    if (err instanceof SchoolSessionExpiredError || err?.code === "SCHOOL_SESSION_EXPIRED") {
      await sessionService.removeEduSecureSession(req.user.id).catch(() => {});
      if (res.headersSent) {
        if (!res.destroyed) res.destroy(err);
        return;
      }
      return expiredResponse(res);
    }
    console.error("GET /school-updates/attachment:", err);
    if (res.headersSent) {
      if (!res.destroyed) res.destroy(err);
      return;
    }
    return res.status(err?.statusCode || 502).json({
      error: err?.message || "Unable to load this school attachment.",
    });
  }
});
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
    return res.json(noticePayload(cached.notices, { isStale: stale }));
  }

  try {
    const fresh = await refreshFromEduSecure(userId, source.kind);
    return res.json(noticePayload(fresh.notices, { isStale: false }));
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
    return res.json(noticePayload(fresh.notices, { isStale: false }));
  } catch (err) {
    const cached = cachedFor(userId, source.kind);
    if (err instanceof SchoolSessionExpiredError || err?.code === "SCHOOL_SESSION_EXPIRED") {
      return expiredResponse(res, cached?.notices || []);
    }
    if (cached) {
      console.error(`POST /school-updates/${source.kind}/refresh; serving cache:`, err);
      return res.json(noticePayload(cached.notices, {
        isStale: true,
        refreshFailed: true,
      }));
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
