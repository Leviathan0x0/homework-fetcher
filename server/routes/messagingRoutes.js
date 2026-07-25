const express = require("express");
const crypto = require("crypto");
const { eq, desc, asc, and, or, sql, lt, gt, ne, inArray } = require("drizzle-orm");
const sessionService = require("../auth/sessionService");
const { requireAuth } = require("../auth/requireAuth");
const { db, schema, isRemote } = require("../db/client");
const { resolveUploadDir, isServerless } = require("../uploads");
const { createNotifications } = require("../notifications/notificationService");
const {
  MAX_UPLOAD_BYTES,
  MAX_MESSAGE_CHARS,
  MAX_SEARCH_QUERY_CHARS,
  rateLimit,
  limitText,
} = require("../limits");

const router = express.Router();


async function isParticipant(conversationId, userId) {
  const row = await db
    .select()
    .from(schema.conversationParticipants)
    .where(
      and(
        eq(schema.conversationParticipants.conversationId, conversationId),
        eq(schema.conversationParticipants.userId, userId)
      )
    )
    .get();
  return !!row;
}

function normalizeSearchValue(value) {
  return (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    studentId: user.studentId,
    displayName: user.displayName || null,
    name: user.displayName || user.studentId,
    section: user.section,
  };
}

router.get(
  "/users/search",
  requireAuth,
  rateLimit({ name: "user-search", windowMs: 60 * 1000, max: 120 }),
  async (req, res) => {
    try {
      const { value: q } = limitText(req.query.q, MAX_SEARCH_QUERY_CHARS);
      if (!q) return res.json({ users: [] });

      // Matching happens in SQL so a search never reads the whole user table.
      const needle = `%${q.toLowerCase().replace(/[%_]/g, "")}%`;
      const matched = await db
        .select()
        .from(schema.users)
        .where(
          and(
            ne(schema.users.id, req.user.id),
            or(
              sql`lower(${schema.users.studentId}) LIKE ${needle}`,
              sql`lower(coalesce(${schema.users.displayName}, '')) LIKE ${needle}`
            )
          )
        )
        .orderBy(asc(schema.users.displayName), asc(schema.users.studentId))
        .limit(20)
        .all();

      return res.json({ users: matched.map(toPublicUser) });
    } catch (err) {
      console.error("User Search Error:", err);
      return res.status(500).json({ error: "Search failed." });
    }
  }
);

router.get("/conversations", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const participations = await db
      .select()
      .from(schema.conversationParticipants)
      .where(eq(schema.conversationParticipants.userId, userId))
      .all();

    if (participations.length === 0) return res.json({ conversations: [] });

    const convIds = participations.map((p) => p.conversationId);

    // The other participant of each conversation, joined with their account, so
    // the whole user table never has to be transferred.
    const others = await db
      .select({
        conversationId: schema.conversationParticipants.conversationId,
        id: schema.users.id,
        studentId: schema.users.studentId,
        displayName: schema.users.displayName,
        section: schema.users.section,
      })
      .from(schema.conversationParticipants)
      .innerJoin(schema.users, eq(schema.users.id, schema.conversationParticipants.userId))
      .where(
        and(
          inArray(schema.conversationParticipants.conversationId, convIds),
          ne(schema.conversationParticipants.userId, userId)
        )
      )
      .all();

    const otherByConv = {};
    for (const row of others) otherByConv[row.conversationId] = row;

    const convs = await db
      .select()
      .from(schema.conversations)
      .where(inArray(schema.conversations.id, convIds))
      .all();

    // Unread counts for every conversation in a single aggregate query.
    const unreadRows = await db.all(sql`
      SELECT m.conversation_id AS conversation_id, COUNT(*) AS unread
      FROM messages m
      JOIN conversation_participants p
        ON p.conversation_id = m.conversation_id AND p.user_id = ${userId}
      WHERE m.sender_id <> ${userId}
        AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
      GROUP BY m.conversation_id
    `);

    const unreadByConv = {};
    for (const row of unreadRows || []) {
      const conversationId = row.conversation_id ?? row[0];
      const unread = row.unread ?? row[1];
      unreadByConv[conversationId] = Number(unread) || 0;
    }

    const result = convs.map((c) => ({
      id: c.id,
      otherUser: toPublicUser(otherByConv[c.id]),
      lastMessagePreview: c.lastMessagePreview || null,
      lastMessageAt: c.lastMessageAt || c.createdAt,
      unreadCount: unreadByConv[c.id] || 0,
    }));

    result.sort((a, b) => {
      if (!a.lastMessageAt) return 1;
      if (!b.lastMessageAt) return -1;
      return b.lastMessageAt.localeCompare(a.lastMessageAt);
    });

    return res.json({ conversations: result });
  } catch (err) {
    console.error("Get Conversations Error:", err);
    return res.status(500).json({ error: "Failed to load conversations." });
  }
});

router.post("/conversations", requireAuth, async (req, res) => {
  try {
    const { participantId } = req.body || {};
    if (!participantId || typeof participantId !== "string") {
      return res.status(400).json({ error: "Participant ID is required." });
    }
    if (participantId === req.user.id) {
      return res.status(400).json({ error: "Cannot start a conversation with yourself." });
    }

    const otherUser = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, participantId))
      .get();
    if (!otherUser) return res.status(404).json({ error: "User not found." });

    const existing = await db
      .select()
      .from(schema.conversationParticipants)
      .where(eq(schema.conversationParticipants.userId, req.user.id))
      .all();
    const existingConvIds = existing.map((p) => p.conversationId);

    if (existingConvIds.length > 0) {
      const others = await db
        .select()
        .from(schema.conversationParticipants)
        .all();
      for (const p of others) {
        if (
          existingConvIds.includes(p.conversationId) &&
          p.userId === participantId
        ) {
          return res.json({
            conversationId: p.conversationId,
            existing: true,
            otherUser: toPublicUser(otherUser),
          });
        }
      }
    }

    const convId = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.insert(schema.conversations)
      .values({ id: convId, createdAt: now, updatedAt: now })
      .run();

    await db.insert(schema.conversationParticipants)
      .values({
        id: crypto.randomUUID(),
        conversationId: convId,
        userId: req.user.id,
        createdAt: now,
      })
      .run();

    await db.insert(schema.conversationParticipants)
      .values({
        id: crypto.randomUUID(),
        conversationId: convId,
        userId: participantId,
        createdAt: now,
      })
      .run();

    return res.status(201).json({
      conversationId: convId,
      existing: false,
      otherUser: toPublicUser(otherUser),
    });
  } catch (err) {
    console.error("Create Conversation Error:", err);
    return res.status(500).json({ error: "Failed to create conversation." });
  }
});

const path = require("path");
const fs = require("fs");
const multer = require("multer");

// Without a persistent upload volume (the usual serverless setup) the local
// disk is wiped between deployments and is not shared between instances, so
// attachments are stored in the database instead of on disk.
const STORE_ATTACHMENTS_IN_DB = !process.env.UPLOADS_DIR && (isRemote || isServerless);
const MAX_ATTACHMENT_BYTES = MAX_UPLOAD_BYTES;

const MSG_UPLOADS_DIR = STORE_ATTACHMENTS_IN_DB
  ? path.join(require("os").tmpdir(), "homework-fetcher-uploads", "messages")
  : resolveUploadDir("messages").dir;

const msgStorage = STORE_ATTACHMENTS_IN_DB
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => cb(null, MSG_UPLOADS_DIR),
      filename: (req, file, cb) => {
        const id = crypto.randomUUID();
        req.messageId = id;
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${id}${ext}`);
      },
    });

const msgUpload = multer({
  storage: msgStorage,
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
});

router.get("/conversations/:id/messages", requireAuth, async (req, res) => {
  try {
    const convId = req.params.id;
    if (!await isParticipant(convId, req.user.id)) {
      return res.status(403).json({ error: "Access denied." });
    }

    const msgs = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, convId))
      .orderBy(asc(schema.messages.createdAt))
      .all();

    const senderIds = [...new Set(msgs.map((m) => m.senderId))];
    const senders = senderIds.length
      ? await db.select().from(schema.users).where(inArray(schema.users.id, senderIds)).all()
      : [];
    const senderMap = {};
    for (const sender of senders) senderMap[sender.id] = sender;

    const result = msgs.map((m) => {
      const sender = senderMap[m.senderId];
      return {
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        senderStudentId: sender ? sender.studentId : m.senderId,
        senderName: sender ? sender.displayName || sender.studentId : null,
        content: m.content,
        attachmentUrl: m.attachmentUrl,
        originalFilename: m.originalFilename,
        mimeType: m.mimeType,
        createdAt: m.createdAt,
        isMine: m.senderId === req.user.id,
      };
    });

    return res.json({ messages: result });
  } catch (err) {
    console.error("Get Messages Error:", err);
    return res.status(500).json({ error: "Failed to load messages." });
  }
});

router.post(
  "/conversations/:id/messages",
  requireAuth,
  rateLimit({ name: "send-message", windowMs: 60 * 1000, max: 40 }),
  async (req, res) => {
  msgUpload.single("file")(req, res, async (err) => {
    if (err) {
      const tooLarge = err.code === "LIMIT_FILE_SIZE";
      return res.status(tooLarge ? 413 : 400).json({
        error: tooLarge
          ? `Attachments are limited to ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB.`
          : err.message || "File upload error",
      });
    }

    try {
      const convId = req.params.id;
      if (!await isParticipant(convId, req.user.id)) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(403).json({ error: "Access denied." });
      }

      const { value: content, tooLong } = limitText((req.body || {}).content, MAX_MESSAGE_CHARS);
      if (!content && !req.file) {
        return res.status(400).json({ error: "Message content or file attachment is required." });
      }
      if (tooLong) {
        return res.status(413).json({
          error: `Messages are limited to ${MAX_MESSAGE_CHARS} characters.`,
        });
      }

      const id = req.messageId || crypto.randomUUID();
      const now = new Date().toISOString();
      const trimmed = content;

      let attachmentUrl = null;
      let originalFilename = null;
      let mimeType = null;
      let filePath = null;

      if (req.file) {
        attachmentUrl = `/api/messages/files/${id}`;
        originalFilename = req.file.originalname;
        mimeType = req.file.mimetype || "application/octet-stream";
        filePath = req.file.path || null;
      }

      await db.insert(schema.messages)
        .values({
          id,
          conversationId: convId,
          senderId: req.user.id,
          content: trimmed,
          attachmentUrl,
          originalFilename,
          mimeType,
          filePath,
          createdAt: now,
        })
        .run();

      if (req.file && STORE_ATTACHMENTS_IN_DB) {
        await db
          .insert(schema.messageAttachments)
          .values({ messageId: id, data: req.file.buffer.toString("base64"), createdAt: now })
          .run();
      }

      const previewText = req.file ? `[Attachment] ${originalFilename}` : trimmed.substring(0, 80);

      await db.update(schema.conversations)
        .set({
          lastMessagePreview: previewText,
          lastMessageAt: now,
          updatedAt: now,
        })
        .where(eq(schema.conversations.id, convId))
        .run();

      const participants = await db
        .select()
        .from(schema.conversationParticipants)
        .where(eq(schema.conversationParticipants.conversationId, convId))
        .all();

      const otherUserIds = participants
        .map((p) => p.userId)
        .filter((uid) => uid !== req.user.id);

      if (otherUserIds.length > 0) {
        await createNotifications(
          otherUserIds,
          "new_message",
          `Message from ${req.user.displayName || req.user.studentId}`,
          previewText,
          `messages:${convId}`,
          convId
        );
      }

      return res.status(201).json({
        success: true,
        message: {
          id,
          conversationId: convId,
          senderId: req.user.id,
          senderStudentId: req.user.studentId,
          senderName: req.user.displayName || req.user.studentId,
          content: trimmed,
          attachmentUrl,
          originalFilename,
          mimeType,
          createdAt: now,
          isMine: true,
        },
      });
    } catch (err) {
      if (req.file) fs.unlink(req.file.path, () => {});
      console.error("Send Message Error:", err);
      return res.status(500).json({ error: "Failed to send message." });
    }
  });
  }
);

router.get("/messages/files/:messageId", requireAuth, async (req, res) => {
  try {
    const { messageId } = req.params;
    const msg = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId))
      .get();

    if (!msg || !msg.attachmentUrl) return res.status(404).json({ error: "File not found." });
    if (!await isParticipant(msg.conversationId, req.user.id)) {
      return res.status(403).json({ error: "Access denied." });
    }

    // 1. Attachments kept in the database (serverless deployments)
    const stored = await db
      .select()
      .from(schema.messageAttachments)
      .where(eq(schema.messageAttachments.messageId, messageId))
      .get();

    if (stored) {
      const buffer = Buffer.from(stored.data, "base64");
      res.setHeader("Content-Type", msg.mimeType || "application/octet-stream");
      res.setHeader("Content-Length", String(buffer.length));
      return res.send(buffer);
    }

    if (!fs.existsSync(MSG_UPLOADS_DIR)) {
      return res.status(404).json({ error: "File not found." });
    }

    // 2. Check exact saved filePath
    if (msg.filePath && fs.existsSync(msg.filePath)) {
      res.setHeader("Content-Type", msg.mimeType || "application/octet-stream");
      return res.sendFile(msg.filePath);
    }

    // 3. Check filename by message ID prefix
    const files = fs.readdirSync(MSG_UPLOADS_DIR);
    const matched = files.find((f) => f.startsWith(messageId));

    if (!matched) return res.status(404).json({ error: "File on disk not found." });

    const fullPath = path.join(MSG_UPLOADS_DIR, matched);
    res.setHeader("Content-Type", msg.mimeType || "application/octet-stream");
    return res.sendFile(fullPath);
  } catch (err) {
    console.error("Serve Message File Error:", err);
    return res.status(500).json({ error: "Failed to serve file." });
  }
});

router.patch("/conversations/:id/read", requireAuth, async (req, res) => {
  try {
    const convId = req.params.id;
    const now = new Date().toISOString();

    await db.update(schema.conversationParticipants)
      .set({ lastReadAt: now })
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, convId),
          eq(schema.conversationParticipants.userId, req.user.id)
        )
      )
      .run();

    await db.update(schema.notifications)
      .set({ isRead: 1 })
      .where(
        and(
          eq(schema.notifications.userId, req.user.id),
          eq(schema.notifications.type, "new_message"),
          eq(schema.notifications.referenceId, convId)
        )
      )
      .run();

    return res.json({ success: true });
  } catch (err) {
    console.error("Mark Read Error:", err);
    return res.status(500).json({ error: "Failed to mark as read." });
  }
});

module.exports = router;
