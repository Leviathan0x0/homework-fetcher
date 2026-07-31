/**
 * Staff flag log + per-student profanity strike counter.
 *
 * - Each blocked vulgar/abuse text attempt increments a strike.
 * - At 3 strikes, a row is written to admin_flag_log and the counter resets.
 * - Chat reports are stored in the same log (type = chat_report).
 */

const crypto = require("crypto");
const { eq } = require("drizzle-orm");
const { db, schema } = require("../db/client");
const { isSettingEnabled } = require("../admin/settingsService");

const STRIKE_THRESHOLD = 3;
const MAX_SNIPPET = 160;

function nowIso() {
  return new Date().toISOString();
}

function clipSnippet(text) {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t) return null;
  return t.length > MAX_SNIPPET ? `${t.slice(0, MAX_SNIPPET)}…` : t;
}

/**
 * @param {{
 *   userId: string,
 *   studentId: string,
 *   section?: string|null,
 *   source: string,
 *   snippet?: string|null,
 *   conversationId?: string|null,
 * }} options
 * @returns {Promise<{ strikes: number, flagged: boolean, muted?: boolean }>}
 */
async function recordProfanityStrike({
  userId,
  studentId,
  section = null,
  source,
  snippet = null,
  conversationId = null,
}) {
  if (!userId) return { strikes: 0, flagged: false };

  const existing = await db
    .select()
    .from(schema.moderationStrikes)
    .where(eq(schema.moderationStrikes.userId, userId))
    .get();

  const nextCount = (existing?.count || 0) + 1;
  const stamped = nowIso();

  if (existing) {
    await db
      .update(schema.moderationStrikes)
      .set({ count: nextCount, updatedAt: stamped })
      .where(eq(schema.moderationStrikes.userId, userId))
      .run();
  } else {
    await db
      .insert(schema.moderationStrikes)
      .values({
        userId,
        count: nextCount,
        updatedAt: stamped,
      })
      .run();
  }

  if (nextCount < STRIKE_THRESHOLD) {
    return { strikes: nextCount, flagged: false };
  }

  await db
    .insert(schema.adminFlagLog)
    .values({
      id: crypto.randomUUID(),
      type: "strike_threshold",
      userId,
      studentId: studentId || userId,
      section: section || null,
      conversationId: conversationId || null,
      reason: `Reached ${STRIKE_THRESHOLD} blocked vulgar/abuse attempts (text or NSFW images)`,
      detail: clipSnippet(snippet),
      source: source || "unknown",
      status: "pending",
      createdAt: stamped,
    })
    .run();

  // Reset so the next window of 3 can flag again.
  await db
    .update(schema.moderationStrikes)
    .set({ count: 0, updatedAt: stamped })
    .where(eq(schema.moderationStrikes.userId, userId))
    .run();

  let muted = false;
  try {
    if (await isSettingEnabled("auto_mute_strikes_enabled")) {
      await db
        .update(schema.users)
        .set({
          isMuted: 1,
          mutedReason: `Auto-muted after ${STRIKE_THRESHOLD} vulgarity strikes`,
          mutedAt: stamped,
          updatedAt: stamped,
        })
        .where(eq(schema.users.id, userId))
        .run();
      muted = true;
    }
  } catch (err) {
    console.error("Auto-mute after strikes failed:", err.message);
  }

  return { strikes: STRIKE_THRESHOLD, flagged: true, muted };
}

/**
 * @param {{
 *   reporterUserId: string,
 *   reporterStudentId: string,
 *   reporterSection?: string|null,
 *   conversationId: string,
 *   reason?: string|null,
 * }} options
 */
async function reportConversation({
  reporterUserId,
  reporterStudentId,
  reporterSection = null,
  conversationId,
  reason = null,
}) {
  const stamped = nowIso();
  const id = crypto.randomUUID();

  await db
    .insert(schema.adminFlagLog)
    .values({
      id,
      type: "chat_report",
      userId: reporterUserId,
      studentId: reporterStudentId || reporterUserId,
      section: reporterSection || null,
      conversationId,
      reason: (reason && String(reason).trim()) || "Student reported this conversation",
      detail: null,
      source: "messages",
      status: "pending",
      createdAt: stamped,
    })
    .run();

  return { id, createdAt: stamped };
}

/**
 * Appends a clear student-facing strike warning to a moderation block message.
 * @param {string} baseReason
 * @param {{ strikes: number, flagged: boolean }} result
 */
function withStrikeWarning(baseReason, { strikes, flagged }) {
  const base =
    (baseReason || "").trim() ||
    "That content can’t be sent — it doesn’t follow school guidelines.";
  if (flagged || strikes >= STRIKE_THRESHOLD) {
    return (
      `${base} This counts as warning ${STRIKE_THRESHOLD} of ${STRIKE_THRESHOLD}. ` +
      `School staff have been notified, and further misuse may result in consequences.`
    );
  }
  return (
    `${base} This counts as warning ${strikes} of ${STRIKE_THRESHOLD}. ` +
    `If you reach ${STRIKE_THRESHOLD} warnings, school staff will be notified and there may be consequences.`
  );
}

module.exports = {
  STRIKE_THRESHOLD,
  recordProfanityStrike,
  reportConversation,
  withStrikeWarning,
};
