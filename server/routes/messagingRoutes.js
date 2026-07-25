const express = require("express");
const crypto = require("crypto");
const { eq, desc, asc, and, or, sql, lt, gt } = require("drizzle-orm");
const sessionService = require("../auth/sessionService");
const { db, schema, isRemote } = require("../db/client");

const router = express.Router();

async function requireAuth(req, res, next) {
  const token = req.cookies?.app_session;
  const activeSession = await sessionService.getAppSession(token);
  if (!activeSession) {
    return res.status(401).json({ code: "UNAUTHENTICATED", message: "Not authenticated." });
  }
  req.user = activeSession.user;
  next();
}

async function createNotifications(userIds, type, title, body, link, referenceId) {
  if (!userIds || userIds.length === 0) return;
  const now = new Date().toISOString();
  for (const uid of userIds) {
    if (type === "new_message") {
      // Consolidate message notifications from the same sender/conversation into 1 notification
      const existing = await db
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.userId, uid),
            eq(schema.notifications.type, "new_message"),
            eq(schema.notifications.referenceId, referenceId),
            eq(schema.notifications.isRead, 0)
          )
        )
        .get();

      if (existing) {
        await db.update(schema.notifications)
          .set({
            title,
            body: body || null,
            createdAt: now,
          })
          .where(eq(schema.notifications.id, existing.id))
          .run();
        continue;
      }
    }

    await db.insert(schema.notifications)
      .values({
        id: crypto.randomUUID(),
        userId: uid,
        type,
        title,
        body: body || null,
        link: link || null,
        referenceId: referenceId || null,
        isRead: 0,
        createdAt: now,
      })
      .run();
  }
}

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

router.get("/users/search", requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.json({ users: [] });

    const needle = normalizeSearchValue(q);
    if (!needle) return res.json({ users: [] });

    const allUsers = await db
      .select()
      .from(schema.users)
      .all();

    const matched = allUsers
      .filter((u) => {
        if (u.id === req.user.id) return false;
        return (
          normalizeSearchValue(u.studentId).includes(needle) ||
          normalizeSearchValue(u.displayName).includes(needle)
        );
      })
      .sort((a, b) => (a.displayName || a.studentId).localeCompare(b.displayName || b.studentId))
      .slice(0, 20)
      .map(toPublicUser);

    return res.json({ users: matched });
  } catch (err) {
    console.error("User Search Error:", err);
    return res.status(500).json({ error: "Search failed." });
  }
});

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
    const readMap = {};
    for (const p of participations) {
      readMap[p.conversationId] = p.lastReadAt;
    }

    const convs = await db
      .select()
      .from(schema.conversations)
      .all();
    const myConvs = convs.filter((c) => convIds.includes(c.id));

    const otherParts = await db
      .select()
      .from(schema.conversationParticipants)
      .all();
    const userIds = new Set();
    const otherMap = {};
    for (const p of otherParts) {
      if (convIds.includes(p.conversationId) && p.userId !== userId) {
        otherMap[p.conversationId] = p.userId;
        userIds.add(p.userId);
      }
    }

    const users = await db.select().from(schema.users).all();
    const userMap = {};
    for (const u of users) userMap[u.id] = u;

    const allMessages = await db.select().from(schema.messages).all();
    const msgByConv = {};
    for (const m of allMessages) {
      if (convIds.includes(m.conversationId)) {
        if (!msgByConv[m.conversationId]) msgByConv[m.conversationId] = [];
        msgByConv[m.conversationId].push(m);
      }
    }

    const result = myConvs.map((c) => {
      const msgs = msgByConv[c.id] || [];
      msgs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const lastMsg = msgs[0];
      const lastRead = readMap[c.id];
      const unreadCount = lastRead
        ? msgs.filter((m) => m.senderId !== userId && m.createdAt > lastRead).length
        : msgs.filter((m) => m.senderId !== userId).length;

      const otherUserId = otherMap[c.id];
      const otherUser = otherUserId ? userMap[otherUserId] : null;

      return {
        id: c.id,
        otherUser: toPublicUser(otherUser),
        lastMessagePreview: c.lastMessagePreview || (lastMsg ? lastMsg.content.substring(0, 80) : null),
        lastMessageAt: c.lastMessageAt || (lastMsg ? lastMsg.createdAt : c.createdAt),
        unreadCount,
      };
    });

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

const UPLOADS_ROOT = process.env.UPLOADS_DIR || path.join(__dirname, "../../uploads");
const MSG_UPLOADS_DIR = path.join(UPLOADS_ROOT, "messages");

// With a hosted database and no persistent upload volume (the usual serverless
// setup) the local disk is wiped between deployments and is not shared between
// instances, so attachments are stored in the database instead of on disk.
const STORE_ATTACHMENTS_IN_DB = isRemote && !process.env.UPLOADS_DIR;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

if (!STORE_ATTACHMENTS_IN_DB && !fs.existsSync(MSG_UPLOADS_DIR)) {
  fs.mkdirSync(MSG_UPLOADS_DIR, { recursive: true });
}

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

    const senders = await db.select().from(schema.users).all();
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

router.post("/conversations/:id/messages", requireAuth, async (req, res) => {
  msgUpload.single("file")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || "File upload error" });

    try {
      const convId = req.params.id;
      if (!await isParticipant(convId, req.user.id)) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(403).json({ error: "Access denied." });
      }

      const { content } = req.body || {};
      if ((!content || !content.trim()) && !req.file) {
        return res.status(400).json({ error: "Message content or file attachment is required." });
      }

      const id = req.messageId || crypto.randomUUID();
      const now = new Date().toISOString();
      const trimmed = content && typeof content === "string" ? content.trim() : "";

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
});

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

    if (STORE_ATTACHMENTS_IN_DB && !fs.existsSync(MSG_UPLOADS_DIR)) {
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
