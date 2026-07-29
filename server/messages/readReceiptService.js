const { sql } = require("drizzle-orm");
const { db } = require("../db/client");

async function createMissingReadReceipts(conversationId, userId, readAt) {
  await db.run(sql`
    INSERT OR IGNORE INTO message_read_receipts (id, message_id, user_id, read_at)
    SELECT lower(hex(randomblob(16))), m.id, ${userId}, ${readAt}
    FROM messages m
    WHERE m.conversation_id = ${conversationId}
      AND m.sender_id <> ${userId}
  `);
}

module.exports = { createMissingReadReceipts };
