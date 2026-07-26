const crypto = require("crypto");
const { eq, and, lt, sql } = require("drizzle-orm");
const { db, schema } = require("../db/client");

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
  const pending = [];

  for (const userId of userIds) {
    if (consolidate && referenceId) {
      const existing = await db
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.userId, userId),
            eq(schema.notifications.type, type),
            eq(schema.notifications.referenceId, referenceId),
            eq(schema.notifications.isRead, 0)
          )
        )
        .get();

      if (existing) {
        await db
          .update(schema.notifications)
          .set({ title, body: body || null, createdAt: now })
          .where(eq(schema.notifications.id, existing.id))
          .run();
        continue;
      }
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

  // A single multi-row insert instead of one round trip per recipient, which
  // matters for section-wide announcements.
  if (pending.length > 0) {
    await db.insert(schema.notifications).values(pending).run();
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
