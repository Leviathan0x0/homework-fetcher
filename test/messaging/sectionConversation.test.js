const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { eq } = require("drizzle-orm");

const databasePath = path.join(os.tmpdir(), `section-conv-${process.pid}-${Date.now()}.sqlite`);
delete process.env.TURSO_DATABASE_URL;
delete process.env.LIBSQL_URL;
process.env.SQLITE_DB_PATH = databasePath;

const { db, ready, schema, sqlite } = require("../../server/db/client");
const { ensureSectionConversation } = require("../../server/messaging/sectionConversation");

test.before(async () => {
  await ready;
  const now = new Date().toISOString();
  await db.insert(schema.users).values(
    ["a", "b", "c"].map((name) => ({
      id: `user-${name}`,
      studentId: `student-${name}`,
      section: "9-F",
      createdAt: now,
      updatedAt: now,
    }))
  ).run();
});

test.after(() => {
  try {
    sqlite?.close();
  } catch {}
  for (const suffix of ["", "-shm", "-wal"]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});

test("classmates joining at the same moment share one class group", async () => {
  await Promise.all(
    ["a", "b", "c"].map((name) =>
      ensureSectionConversation({ id: `user-${name}`, section: "9-F" })
    )
  );

  const groups = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.section, "9-F"))
    .all();
  assert.equal(groups.length, 1);

  const members = await db
    .select()
    .from(schema.conversationParticipants)
    .where(eq(schema.conversationParticipants.conversationId, groups[0].id))
    .all();
  assert.equal(members.length, 3);
});
