const crypto = require("crypto");
const { eq, and, lt, inArray } = require("drizzle-orm");
const { db, schema, runBatch } = require("../db/client");

// Notifications are a rolling feed: without pruning the table keeps growing for
// every student forever. Old read notifications are removed opportunistically
// while writing new ones, so no scheduled job is required (serverless hosts
// cannot run one reliably).
const RETENTION_DAYS = parseInt(process.env.NOTIFICATION_RETENTION_DAYS || "30", 10);
const PRUNE_PROBABILITY = 0.05;

/**
 * Creates notifications for a list of users.
 *
 * @param {string[]} userIds recipients
 * @param {string} type notification type, e.g. "new_message"
 * @param {string} title
 * @param {string|null} body
 * @param {string|null} link in-app link, e.g. "messages:<conversationId>"
 * @param {string|null} referenceId entity the notification points at
 * @param {{consolidate?: boolean}} [options] when consolidating, an existing
 *   unread notification for the same reference is updated instead of adding a
 *   new row (used for chat messages so one conversation yields one badge).
 */
async function createNotifications(userIds, type, title, body, link, referenceId, options = {}) {
  if (!userIds || userIds.length === 0) return;

  const consolidate = options.consolidate ?? type === "new_message";
  const now = new Date().toISOString();
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueUserIds.length === 0) return;

  const updates = [];
  const pending = [];

  if (consolidate && referenceId) {
    // One lookup for every recipient instead of one round trip per recipient:
    // a section-wide message used to cost a SELECT plus an UPDATE per student.
    const existingRows = await db
      .select({ id: schema.notifications.id, userId: schema.notifications.userId })
      .from(schema.notifications)
      .where(
        and(
          inArray(schema.notifications.userId, uniqueUserIds),
          eq(schema.notifications.type, type),
          eq(schema.notifications.referenceId, referenceId),
          eq(schema.notifications.isRead, 0)
        )
      )
      .all();

    const existingByUser = new Map(existingRows.map((r) => [r.userId, r.id]));
    for (const userId of uniqueUserIds) {
      const existingId = existingByUser.get(userId);
      if (existingId) {
        updates.push(
          db.update(schema.notifications)
            .set({ title, body: body || null, createdAt: now })
            .where(eq(schema.notifications.id, existingId))
        );
        continue;
      }
      pending.push({
        id: crypto.randomUUID(),
        userId,
        type,
        title,
        body: body || null,
        link: link || null,
        referenceId: referenceId || null,
        isRead: 0,
        createdAt: now,
      });
    }
  } else {
    for (const userId of uniqueUserIds) {
      pending.push({
        id: crypto.randomUUID(),
        userId,
        type,
        title,
        body: body || null,
        link: link || null,
        referenceId: referenceId || null,
        isRead: 0,
        createdAt: now,
      });
    }
  }

  // Batched updates plus one multi-row insert instead of a round trip per recipient.
  if (updates.length > 0 || pending.length > 0) {
    await runBatch([
      ...updates,
      ...(pending.length > 0 ? [db.insert(schema.notifications).values(pending)] : []),
    ]);
  }

  if (Math.random() < PRUNE_PROBABILITY) {
    await pruneOldNotifications();
  }
}

/** Deletes read notifications older than the retention window. */
async function pruneOldNotifications() {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await db
      .delete(schema.notifications)
      .where(and(eq(schema.notifications.isRead, 1), lt(schema.notifications.createdAt, cutoff)))
      .run();
  } catch (err) {
    console.error("Notification pruning failed:", err.message);
  }
}

module.exports = { createNotifications, pruneOldNotifications, RETENTION_DAYS };
