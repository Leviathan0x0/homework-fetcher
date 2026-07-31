const crypto = require("crypto");
const { eq, and } = require("drizzle-orm");
const { db, schema, runBatch } = require("../db/client");

/**
 * Sections whose group membership was reconciled recently.
 *
 * The inbox asks for conversations every few seconds, and every one of those
 * calls used to re-check the whole class roster. Membership only changes when a
 * classmate signs up for the first time, so re-running it once per interval per
 * section is enough and keeps the common case free of extra queries.
 */
const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
const reconciledSections = new Map();

function wasReconciledRecently(section) {
  const at = reconciledSections.get(section);
  return !!at && Date.now() - at < RECONCILE_INTERVAL_MS;
}

/**
 * Ensures the user is in their section's shared class group chat.
 * Creates the group if it does not exist yet, and adds every classmate
 * currently in the same section.
 *
 * @param {{ id: string, section?: string|null }} user
 * @param {{ force?: boolean }} [options] force skips the reconcile interval
 * @returns {Promise<{ conversationId: string, section: string, existing: boolean }|null>}
 */
async function ensureSectionConversation(user, options = {}) {
  const section = (user?.section || "").trim();
  if (!user?.id || !section) return null;
  // Never create/join a group under the fake placeholder section.
  if (/^section\s*10-a$/i.test(section)) return null;

  const membershipKey = `${section}\u0000${user.id}`;
  if (!options.force && wasReconciledRecently(membershipKey)) return null;

  const existing = await db
    .select()
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.type, "section"),
        eq(schema.conversations.section, section)
      )
    )
    .get();

  const now = new Date().toISOString();

  if (existing) {
    // Roster and current membership are read together instead of one after the
    // other, then the missing rows go out as a single insert.
    const [studentsInSection, current] = await Promise.all([
      db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.section, section))
        .all(),
      db
        .select({ userId: schema.conversationParticipants.userId })
        .from(schema.conversationParticipants)
        .where(eq(schema.conversationParticipants.conversationId, existing.id))
        .all(),
    ]);

    const inGroup = new Set(current.map((r) => r.userId));
    const missing = new Set(
      studentsInSection.map((student) => student.id).filter((id) => !inGroup.has(id))
    );
    if (!inGroup.has(user.id)) missing.add(user.id);

    if (missing.size > 0) {
      await db
        .insert(schema.conversationParticipants)
        .values(
          [...missing].map((userId) => ({
            id: crypto.randomUUID(),
            conversationId: existing.id,
            userId,
            createdAt: now,
          }))
        )
        .run();
    }

    reconciledSections.set(membershipKey, Date.now());
    return { conversationId: existing.id, section, existing: true };
  }

  const convId = crypto.randomUUID();
  const studentsInSection = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.section, section))
    .all();

  const ids = new Set(studentsInSection.map((s) => s.id));
  ids.add(user.id);

  await runBatch([
    db.insert(schema.conversations).values({
      id: convId,
      type: "section",
      section,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(schema.conversationParticipants).values(
      [...ids].map((userId) => ({
        id: crypto.randomUUID(),
        conversationId: convId,
        userId,
        createdAt: now,
      }))
    ),
  ]);

  reconciledSections.set(membershipKey, Date.now());
  return { conversationId: convId, section, existing: false };
}

module.exports = {
  ensureSectionConversation,
};
