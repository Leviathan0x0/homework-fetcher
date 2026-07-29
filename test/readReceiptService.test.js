const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { eq } = require("drizzle-orm");

test("conversation read receipts are inserted idempotently in one set", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "read-receipts-"));
  process.env.SQLITE_DB_PATH = path.join(tempDir, "test.db");

  const { db, ready, schema, sqlite } = require("../server/db/client");
  const {
    createMissingReadReceipts,
  } = require("../server/messages/readReceiptService");
  await ready;

  const now = new Date().toISOString();
  const readerId = crypto.randomUUID();
  const senderId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  await db
    .insert(schema.users)
    .values([
      {
        id: readerId,
        studentId: "reader",
        section: "10-A",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: senderId,
        studentId: "sender",
        section: "10-A",
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run();
  await db
    .insert(schema.conversations)
    .values({ id: conversationId, createdAt: now, updatedAt: now })
    .run();

  const messages = Array.from({ length: 100 }, (_, index) => ({
    id: crypto.randomUUID(),
    conversationId,
    senderId,
    content: `message ${index}`,
    createdAt: new Date(Date.now() + index).toISOString(),
  }));
  messages.push({
    id: crypto.randomUUID(),
    conversationId,
    senderId: readerId,
    content: "my message",
    createdAt: new Date(Date.now() + 101).toISOString(),
  });
  await db.insert(schema.messages).values(messages).run();

  await createMissingReadReceipts(conversationId, readerId, now);
  await createMissingReadReceipts(conversationId, readerId, now);

  const receipts = await db
    .select()
    .from(schema.messageReadReceipts)
    .where(eq(schema.messageReadReceipts.userId, readerId))
    .all();
  assert.equal(receipts.length, 100);
  assert.ok(receipts.every((receipt) => receipt.userId === readerId));

  sqlite.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});
