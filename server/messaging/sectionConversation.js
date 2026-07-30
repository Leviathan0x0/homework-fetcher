const crypto = require("crypto");
const { eq, and } = require("drizzle-orm");
const { db, schema } = require("../db/client");

/**
 * Ensures the user is in their section's shared class group chat.
 * Creates the group if it does not exist yet, and adds every classmate
 * currently in the same section.
 *
 * @param {{ id: string, section?: string|null }} user
 * @returns {Promise<{ conversationId: string, section: string, existing: boolean }|null>}
 */
async function ensureSectionConversation(user) {
  const section = (user?.section || "").trim();
  if (!user?.id || !section) return null;
  // Never create/join a group under the fake placeholder section.
  if (/^section\s*10-a$/i.test(section)) return null;

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
    const alreadyIn = await db
      .select()
      .from(schema.conversationParticipants)
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, existing.id),
          eq(schema.conversationParticipants.userId, user.id)
        )
      )
      .get();

    if (!alreadyIn) {
      await db
        .insert(schema.conversationParticipants)
        .values({
          id: crypto.randomUUID(),
          conversationId: existing.id,
          userId: user.id,
          createdAt: now,
        })
        .run();
    }

    // Also pull in any classmates who joined the app since the group was created.
    const studentsInSection = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.section, section))
      .all();

    const current = await db
      .select({ userId: schema.conversationParticipants.userId })
      .from(schema.conversationParticipants)
      .where(eq(schema.conversationParticipants.conversationId, existing.id))
      .all();
    const inGroup = new Set(current.map((r) => r.userId));

    for (const student of studentsInSection) {
      if (inGroup.has(student.id)) continue;
      await db
        .insert(schema.conversationParticipants)
        .values({
          id: crypto.randomUUID(),
          conversationId: existing.id,
          userId: student.id,
          createdAt: now,
        })
        .run();
    }

    return { conversationId: existing.id, section, existing: true };
  }

  const convId = crypto.randomUUID();
  await db
    .insert(schema.conversations)
    .values({
      id: convId,
      type: "section",
      section,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const studentsInSection = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.section, section))
    .all();

  const ids = new Set(studentsInSection.map((s) => s.id));
  ids.add(user.id);

  for (const userId of ids) {
    await db
      .insert(schema.conversationParticipants)
      .values({
        id: crypto.randomUUID(),
        conversationId: convId,
        userId,
        createdAt: now,
      })
      .run();
  }

  return { conversationId: convId, section, existing: false };
}

module.exports = {
  ensureSectionConversation,
};
