const express = require("express");
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

router.get("/notifications", requireAuth, async (req, res) => {
  try {
    const records = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, req.user.id))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(50)
      .all();

    const result = records.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      referenceId: n.referenceId,
      isRead: n.isRead,
      createdAt: n.createdAt,
    }));

    return res.json({ notifications: result });
  } catch (err) {
    console.error("Get Notifications Error:", err);
    return res.status(500).json({ error: "Failed to load notifications." });
  }
});

router.get("/notifications/unread-count", requireAuth, async (req, res) => {
  try {
    const records = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, req.user.id),
          eq(schema.notifications.isRead, 0)
        )
      )
      .all();

    return res.json({ count: records.length });
  } catch (err) {
    console.error("Unread Count Error:", err);
    return res.status(500).json({ error: "Failed to get unread count." });
  }
});

router.patch("/notifications/:id/read", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const item = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, id))
      .get();

    if (!item) return res.status(404).json({ error: "Notification not found." });
    if (item.userId !== req.user.id) {
      return res.status(403).json({ error: "Access denied." });
    }

    await db.update(schema.notifications)
      .set({ isRead: 1 })
      .where(eq(schema.notifications.id, id))
      .run();

    return res.json({ success: true });
  } catch (err) {
    console.error("Mark Notification Read Error:", err);
    return res.status(500).json({ error: "Failed to update notification." });
  }
});

router.post("/notifications/read-all", requireAuth, async (req, res) => {
  try {
    await db.update(schema.notifications)
      .set({ isRead: 1 })
      .where(eq(schema.notifications.userId, req.user.id))
      .run();

    return res.json({ success: true });
  } catch (err) {
    console.error("Mark All Read Error:", err);
    return res.status(500).json({ error: "Failed to mark all as read." });
  }
});

module.exports = router;
