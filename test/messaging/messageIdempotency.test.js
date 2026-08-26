const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { and, eq } = require("drizzle-orm");

const databasePath = path.join(
  os.tmpdir(),
  `message-idempotency-${process.pid}-${Date.now()}.sqlite`
);
delete process.env.TURSO_DATABASE_URL;
delete process.env.LIBSQL_URL;
process.env.SQLITE_DB_PATH = databasePath;

const { db, ready, schema, sqlite } = require("../../server/db/client");

const userId = "idempotency-user";
const conversationId = "idempotency-conversation";
const otherConversationId = "idempotency-conversation-2";

test.before(async () => {
  await ready;
  const now = new Date().toISOString();
  await db.insert(schema.users).values({
    id: userId,
    studentId: "idempotency-student",
    displayName: "Idempotency Test",
    section: "10-A",
    role: "student",
    createdAt: now,
    updatedAt: now,
  });
  for (const id of [conversationId, otherConversationId]) {
    await db.insert(schema.conversations).values({
      id,
      type: "dm",
      createdAt: now,
      updatedAt: now,
    });
  }
});

test.after(() => {
  try {
    sqlite?.close();
  } catch {}
  for (const suffix of ["", "-shm", "-wal"]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});

function messageRow(id, clientMessageId, targetConversationId = conversationId) {
  return {
    id,
    conversationId: targetConversationId,
    senderId: userId,
    content: "test",
    clientMessageId,
    createdAt: new Date().toISOString(),
  };
}

test("a resent draft can only be stored once per conversation", async () => {
  await db.insert(schema.messages).values(messageRow("message-1", "draft-1"));

  await assert.rejects(
    () => db.insert(schema.messages).values(messageRow("message-2", "draft-1")),
    /UNIQUE|constraint/i
  );

  const stored = await db
    .select()
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.clientMessageId, "draft-1")
      )
    )
    .all();

  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, "message-1");
});

test("the same draft id in another conversation is a different message", async () => {
  await db.insert(schema.messages).values(messageRow("message-3", "draft-1", otherConversationId));

  const stored = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.clientMessageId, "draft-1"))
    .all();

  assert.equal(stored.length, 2);
});

test("messages without a draft id are never treated as duplicates", async () => {
  await db.insert(schema.messages).values(messageRow("message-4", null));
  await db.insert(schema.messages).values(messageRow("message-5", null));

  const stored = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .all();

  assert.equal(stored.filter((message) => message.clientMessageId === null).length, 2);
});
