const express = require("express");
const crypto = require("crypto");
const { eq, desc, and } = require("drizzle-orm");
const sessionService = require("../auth/sessionService");
const { db, schema } = require("../db/client");

const router = express.Router();

async function requireAuth(req, res, next) {
  const token = req.cookies?.app_session;
  const activeSession = await sessionService.getAppSession(token);
  if (!activeSession) {
    return res.status(401).json({ code: "UNAUTHENTICATED", message: "Not authenticated." });
  }
  req.user = activeSession.user;
  next();
}

async function createNotifications(userIds, type, title, body, link, referenceId) {
  if (!userIds || userIds.length === 0) return;
  const now = new Date().toISOString();
  const values = userIds.map((uid) => ({
    id: crypto.randomUUID(),
    userId: uid,
    type,
    title,
    body: body || null,
    link: link || null,
    referenceId: referenceId || null,
    isRead: 0,
    createdAt: now,
  }));
  for (const v of values) {
    await db.insert(schema.notifications).values(v).run();
  }
}

router.get("/requests", requireAuth, async (req, res) => {
  try {
    const section = req.user.section;
    if (!section) return res.json({ count: 0, requests: [] });

    const records = await db
      .select()
      .from(schema.sectionRequests)
      .where(eq(schema.sectionRequests.section, section))
      .orderBy(desc(schema.sectionRequests.createdAt))
      .all();

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
    }));

    return res.json({ section, count: result.length, requests: result });
  } catch (err) {
    console.error("Get Requests Error:", err);
    return res.status(500).json({ error: "Failed to fetch requests." });
  }
});

router.post("/requests", requireAuth, async (req, res) => {
  try {
    const { title, content, category } = req.body || {};
    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "Title is required." });
    }
    if (!content || typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "Content is required." });
    }
    const section = req.user.section;
    if (!section) return res.status(400).json({ error: "Section not set." });

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const newRequest = {
      id,
      userId: req.user.id,
      studentId: req.user.studentId,
      section,
      category: category && typeof category === "string" ? category.trim() : null,
      title: title.trim(),
      content: content.trim(),
      status: "open",
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(schema.sectionRequests).values(newRequest).run();

    const sectionUsers = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.section, section))
      .all();
    const otherUserIds = sectionUsers
      .map((u) => u.id)
      .filter((uid) => uid !== req.user.id);

    if (otherUserIds.length > 0) {
      await createNotifications(
        otherUserIds,
        "new_request",
        `New request: ${title.trim().substring(0, 60)}`,
        `${req.user.studentId} posted a request in ${section}`,
        "requests",
        id
      );
    }

    return res.status(201).json({
      success: true,
      request: { ...newRequest, isOwner: true },
    });
  } catch (err) {
    console.error("Create Request Error:", err);
    return res.status(500).json({ error: "Failed to create request." });
  }
});

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
