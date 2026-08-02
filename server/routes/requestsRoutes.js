const express = require("express");
const crypto = require("crypto");
const { eq, desc, and, inArray } = require("drizzle-orm");
const sessionService = require("../auth/sessionService");
const { requireAuth } = require("../auth/requireAuth");
const { db, schema } = require("../db/client");
const { createNotifications } = require("../notifications/notificationService");
const {
  MAX_REQUEST_TITLE_CHARS,
  MAX_REQUEST_BODY_CHARS,
  rateLimit,
  limitText,
} = require("../limits");
const { checkRequestText } = require("../moderation/checkContent");
const { recordProfanityStrike, withStrikeWarning } = require("../moderation/flagLogService");

const router = express.Router();


router.get("/requests", requireAuth, async (req, res) => {
  try {
    const section = req.user.section;
    if (!section) return res.json({ count: 0, requests: [] });

    const [records, unseenNotifications] = await Promise.all([
      db
        .select()
        .from(schema.sectionRequests)
        .where(eq(schema.sectionRequests.section, section))
        .orderBy(desc(schema.sectionRequests.createdAt))
        .all(),
      db
        .select({ referenceId: schema.notifications.referenceId })
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.userId, req.user.id),
            eq(schema.notifications.type, "new_request"),
            eq(schema.notifications.isRead, 0)
          )
        )
        .all(),
    ]);
    const unseenIds = new Set(unseenNotifications.map((item) => item.referenceId).filter(Boolean));

    const result = records.map((item) => ({
      id: item.id,
      studentId: item.studentId,
      section: item.section,
      category: item.category,
      title: item.title,
      content: item.content,
      status: item.status,
      createdAt: item.createdAt,
      creatorUserId: item.userId,
      isOwner: item.userId === req.user.id,
      isSeen: item.userId === req.user.id || !unseenIds.has(item.id),
    }));

    return res.json({
      section,
      count: result.length,
      unseenCount: result.filter((item) => item.status === "open" && !item.isSeen).length,
      requests: result,
    });
  } catch (err) {
    console.error("Get Requests Error:", err);
    return res.status(500).json({ error: "Failed to fetch requests." });
  }
});

// Opening the Requests tab acknowledges its current request notifications.
// A request id list is accepted for direct links and future detail views.
router.post("/requests/seen", requireAuth, async (req, res) => {
  try {
    const requestedIds = Array.isArray(req.body?.requestIds)
      ? [...new Set(req.body.requestIds.map(String).filter(Boolean))].slice(0, 200)
      : [];
    const filters = [
      eq(schema.notifications.userId, req.user.id),
      eq(schema.notifications.type, "new_request"),
      eq(schema.notifications.isRead, 0),
    ];
    if (requestedIds.length > 0) {
      filters.push(inArray(schema.notifications.referenceId, requestedIds));
    }
    await db
      .update(schema.notifications)
      .set({ isRead: 1 })
      .where(and(...filters))
      .run();
    return res.json({ success: true });
  } catch (err) {
    console.error("Acknowledge Requests Error:", err);
    return res.status(500).json({ error: "Failed to acknowledge requests." });
  }
});

router.post(
  "/requests",
  requireAuth,
  rateLimit({ name: "create-request", windowMs: 60 * 1000, max: 10 }),
  async (req, res) => {
  try {
    // Enforce Admin Mute Status
    const dbUser = await db.select().from(schema.users).where(eq(schema.users.id, req.user.id)).get();
    if (dbUser && dbUser.isMuted === 1) {
      return res.status(403).json({ error: "Your account has been muted by an administrator." });
    }

    // Enforce System Toggle
    const { isSettingEnabled } = require("../admin/settingsService");
    if (
      !(await isSettingEnabled("section_requests_enabled")) &&
      req.user.studentId !== "admin_mmss" &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({ error: "Section requests are currently paused by the administrator." });
    }

    const { category } = req.body || {};
    const titleField = limitText((req.body || {}).title, MAX_REQUEST_TITLE_CHARS);
    const contentField = limitText((req.body || {}).content, MAX_REQUEST_BODY_CHARS);
    if (!titleField.value) {
      return res.status(400).json({ error: "Title is required." });
    }
    if (!contentField.value) {
      return res.status(400).json({ error: "Content is required." });
    }
    if (titleField.tooLong || contentField.tooLong) {
      return res.status(413).json({
        error: `Titles are limited to ${MAX_REQUEST_TITLE_CHARS} characters and details to ${MAX_REQUEST_BODY_CHARS}.`,
      });
    }
    const title = titleField.value;
    const content = contentField.value;
    const section = req.user.section;
    if (!section) return res.status(400).json({ error: "Section not set." });

    const safety = await checkRequestText(title, content);
    if (!safety.ok) {
      if (safety.strikeable) {
        try {
          const strike = await recordProfanityStrike({
            userId: req.user.id,
            studentId: req.user.studentId,
            section: req.user.section,
            source: "requests",
            snippet: `${title}\n${content}`,
          });
          return res.status(400).json({ error: withStrikeWarning(safety.reason, strike) });
        } catch (strikeErr) {
          console.error("Profanity strike log failed:", strikeErr.message);
        }
      }
      return res.status(400).json({ error: safety.reason });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const newRequest = {
      id,
      userId: req.user.id,
      studentId: req.user.studentId,
      section,
      category: category && typeof category === "string" ? category.trim() : null,
      title,
      content,
      status: "open",
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(schema.sectionRequests).values(newRequest).run();

    const sectionUsers = await db
      .select({ id: schema.users.id, role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.section, section))
      .all();
    const otherUserIds = sectionUsers
      .filter((user) => user.role === "student")
      .map((u) => u.id)
      .filter((uid) => uid !== req.user.id);

    const teacherProfiles = await db
      .select({
        userId: schema.teacherProfiles.userId,
        assignedSections: schema.teacherProfiles.assignedSections,
        classTeacherSections: schema.teacherProfiles.classTeacherSections,
      })
      .from(schema.teacherProfiles)
      .all();
    const relevantTeacherIds = teacherProfiles
      .filter((profile) => {
        const parseSections = (raw) => {
          try {
            const parsed = JSON.parse(raw || "[]");
            return Array.isArray(parsed) ? parsed.map(String) : [];
          } catch {
            return [];
          }
        };
        return [
          ...parseSections(profile.assignedSections),
          ...parseSections(profile.classTeacherSections),
        ].includes(section);
      })
      .map((profile) => profile.userId)
      .filter(Boolean);

    if (otherUserIds.length > 0) {
      await createNotifications(
        otherUserIds,
        "new_request",
        `New request: ${title.substring(0, 60)}`,
        `${req.user.studentId} posted a request in ${section}`,
        "requests",
        id
      );
    }
    if (relevantTeacherIds.length > 0) {
      try {
        await createNotifications(
          relevantTeacherIds,
          "new_request",
          `Student help request: ${title.substring(0, 60)}`,
          `${req.user.studentId} posted in ${section}`,
          "teacher-overview",
          id
        );
      } catch (notificationErr) {
        console.error("Teacher request notification failed:", notificationErr.message);
      }
    }

    return res.status(201).json({
      success: true,
      request: { ...newRequest, isOwner: true },
    });
  } catch (err) {
    console.error("Create Request Error:", err);
    return res.status(500).json({ error: "Failed to create request." });
  }
  }
);

router.patch("/requests/:id/status", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!status || !["open", "completed"].includes(status)) {
      return res.status(400).json({ error: "Status must be 'open' or 'completed'." });
    }

    const item = await db
      .select()
      .from(schema.sectionRequests)
      .where(eq(schema.sectionRequests.id, id))
      .get();

    if (!item) return res.status(404).json({ error: "Request not found." });
    if (item.userId !== req.user.id) {
      return res.status(403).json({ error: "You can only update your own requests." });
    }

    await db.update(schema.sectionRequests)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(schema.sectionRequests.id, id))
      .run();

    return res.json({ success: true, id, status });
  } catch (err) {
    console.error("Update Request Status Error:", err);
    return res.status(500).json({ error: "Failed to update request." });
  }
});

router.delete("/requests/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const item = await db
      .select()
      .from(schema.sectionRequests)
      .where(eq(schema.sectionRequests.id, id))
      .get();

    if (!item) return res.status(404).json({ error: "Request not found." });
    if (item.userId !== req.user.id) {
      return res.status(403).json({ error: "You can only delete your own requests." });
    }

    await db.delete(schema.sectionRequests)
      .where(eq(schema.sectionRequests.id, id))
      .run();

    return res.json({ success: true, message: "Request deleted." });
  } catch (err) {
    console.error("Delete Request Error:", err);
    return res.status(500).json({ error: "Failed to delete request." });
  }
});

module.exports = router;
