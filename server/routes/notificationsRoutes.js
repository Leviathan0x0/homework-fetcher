const express = require("express");
const { eq, desc, and } = require("drizzle-orm");
const { requireAuth } = require("../auth/requireAuth");
const { db, schema } = require("../db/client");
const { isPlaceholderTestText } = require("../admin/purgeTestContent");

const router = express.Router();


router.get("/notifications", requireAuth, async (req, res) => {
  try {
    const records = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, req.user.id))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(50)
      .all();

    const result = records
      .filter(
        (n) =>
          !isPlaceholderTestText(n.title) && !isPlaceholderTestText(n.body)
      )
      .map((n) => ({
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
    // Badge count excludes placeholder "test" / "feed test" rows so a leftover
    // trial notification cannot keep the bell lit after cleanup.
    const rows = await db
      .select({
        title: schema.notifications.title,
        body: schema.notifications.body,
      })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, req.user.id),
          eq(schema.notifications.isRead, 0)
        )
      )
      .all();

    const total = rows.filter(
      (row) =>
        !isPlaceholderTestText(row.title) && !isPlaceholderTestText(row.body)
    ).length;

    return res.json({ count: total });
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

router.get("/alerts/active", requireAuth, async (req, res) => {
  try {
    const userSection = req.user.section || "";
    const activeAlerts = await db
      .select()
      .from(schema.broadcastAlerts)
      .where(eq(schema.broadcastAlerts.active, 1))
      .orderBy(desc(schema.broadcastAlerts.createdAt))
      .all();

    const matchingAlerts = activeAlerts.filter(
      (a) =>
        (a.targetSection === "All" || a.targetSection === userSection) &&
        !isPlaceholderTestText(a.title) &&
        !isPlaceholderTestText(a.message)
    );

    return res.json({ alerts: matchingAlerts });
  } catch (err) {
    console.error("Get Active Broadcast Alerts Error:", err);
    return res.status(500).json({ error: "Failed to load broadcast alerts." });
  }
});

module.exports = router;
