const express = require("express");
const crypto = require("crypto");
const { eq, desc, asc, and, or, sql, lt, gt } = require("drizzle-orm");
const sessionService = require("../auth/sessionService");
const { db, schema } = require("../db/client");

const router = express.Router();

function requireAuth(req, res, next) {
  const token = req.cookies?.app_session;
  const activeSession = sessionService.getAppSession(token);
  if (!activeSession) {
    return res.status(401).json({ code: "UNAUTHENTICATED", message: "Not authenticated." });
  }
  req.user = activeSession.user;
  next();
}

function createNotifications(userIds, type, title, body, link, referenceId) {
  if (!userIds || userIds.length === 0) return;
  const now = new Date().toISOString();
  for (const uid of userIds) {
    if (type === "new_message") {
      // Consolidate message notifications from the same sender/conversation into 1 notification
      const existing = db
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
        db.update(schema.notifications)
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

    db.insert(schema.notifications)
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

function isParticipant(conversationId, userId) {
  const row = db
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

router.get("/users/search", requireAuth, (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q || q.length < 1) return res.json({ users: [] });

    const allUsers = db
      .select()
      .from(schema.users)
      .all();

    const lower = q.toLowerCase();
    const matched = allUsers
      .filter((u) => u.id !== req.user.id && u.studentId.toLowerCase().includes(lower))
      .slice(0, 10)
      .map((u) => ({
        id: u.id,
        studentId: u.studentId,
        section: u.section,
      }));

    return res.json({ users: matched });
  } catch (err) {
    console.error("User Search Error:", err);
    return res.status(500).json({ error: "Search failed." });
  }
});

router.get("/conversations", requireAuth, (req, res) => {
  try {
    const userId = req.user.id;

    const participations = db
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

    const convs = db
      .select()
      .from(schema.conversations)
      .all();
    const myConvs = convs.filter((c) => convIds.includes(c.id));

    const otherParts = db
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

    const users = db.select().from(schema.users).all();
    const userMap = {};
    for (const u of users) userMap[u.id] = u;

    const allMessages = db.select().from(schema.messages).all();
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
        otherUser: otherUser
          ? { id: otherUser.id, studentId: otherUser.studentId, section: otherUser.section }
          : null,
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

router.post("/conversations", requireAuth, (req, res) => {
  try {
    const { participantId } = req.body || {};
    if (!participantId || typeof participantId !== "string") {
      return res.status(400).json({ error: "Participant ID is required." });
    }
    if (participantId === req.user.id) {
      return res.status(400).json({ error: "Cannot start a conversation with yourself." });
    }

    const otherUser = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, participantId))
      .get();
    if (!otherUser) return res.status(404).json({ error: "User not found." });

    const existing = db
      .select()
      .from(schema.conversationParticipants)
      .where(eq(schema.conversationParticipants.userId, req.user.id))
      .all();
    const existingConvIds = existing.map((p) => p.conversationId);

    if (existingConvIds.length > 0) {
      const others = db
        .select()
        .from(schema.conversationParticipants)
        .all();
      for (const p of others) {
        if (
          existingConvIds.includes(p.conversationId) &&
          p.userId === participantId
        ) {
          return res.json({ conversationId: p.conversationId, existing: true });
        }
      }
    }

    const convId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.insert(schema.conversations)
      .values({ id: convId, createdAt: now, updatedAt: now })
      .run();

    db.insert(schema.conversationParticipants)
      .values({
        id: crypto.randomUUID(),
        conversationId: convId,
        userId: req.user.id,
        createdAt: now,
      })
      .run();

    db.insert(schema.conversationParticipants)
      .values({
        id: crypto.randomUUID(),
        conversationId: convId,
        userId: participantId,
        createdAt: now,
      })
      .run();

    return res.status(201).json({ conversationId: convId, existing: false });
  } catch (err) {
    console.error("Create Conversation Error:", err);
    return res.status(500).json({ error: "Failed to create conversation." });
  }
});

const path = require("path");
const fs = require("fs");
const multer = require("multer");

const MSG_UPLOADS_DIR = path.join(__dirname, "../../uploads/messages");
if (!fs.existsSync(MSG_UPLOADS_DIR)) {
  fs.mkdirSync(MSG_UPLOADS_DIR, { recursive: true });
}

const msgStorage = multer.diskStorage({
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
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.get("/conversations/:id/messages", requireAuth, (req, res) => {
  try {
    const convId = req.params.id;
    if (!isParticipant(convId, req.user.id)) {
      return res.status(403).json({ error: "Access denied." });
    }

    const msgs = db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, convId))
      .orderBy(asc(schema.messages.createdAt))
      .all();

    const result = msgs.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      content: m.content,
      attachmentUrl: m.attachmentUrl,
      originalFilename: m.originalFilename,
      mimeType: m.mimeType,
      createdAt: m.createdAt,
      isMine: m.senderId === req.user.id,
    }));

    return res.json({ messages: result });
  } catch (err) {
    console.error("Get Messages Error:", err);
    return res.status(500).json({ error: "Failed to load messages." });
  }
});

router.post("/conversations/:id/messages", requireAuth, (req, res) => {
  msgUpload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "File upload error" });

    try {
      const convId = req.params.id;
      if (!isParticipant(convId, req.user.id)) {
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
        filePath = req.file.path;
      }

      db.insert(schema.messages)
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

      const previewText = req.file ? `[Attachment] ${originalFilename}` : trimmed.substring(0, 80);

      db.update(schema.conversations)
        .set({
          lastMessagePreview: previewText,
          lastMessageAt: now,
          updatedAt: now,
        })
        .where(eq(schema.conversations.id, convId))
        .run();

      const participants = db
        .select()
        .from(schema.conversationParticipants)
        .where(eq(schema.conversationParticipants.conversationId, convId))
        .all();

      const otherUserIds = participants
        .map((p) => p.userId)
        .filter((uid) => uid !== req.user.id);

      if (otherUserIds.length > 0) {
        createNotifications(
          otherUserIds,
          "new_message",
          `Message from ${req.user.studentId}`,
          previewText,
          "messages",
          convId
        );
      }

      return res.status(201).json({
        success: true,
        message: {
          id,
          conversationId: convId,
          senderId: req.user.id,
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

router.get("/messages/files/:messageId", requireAuth, (req, res) => {
  try {
    const { messageId } = req.params;
    const msg = db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId))
      .get();

    if (!msg || !msg.attachmentUrl) return res.status(404).json({ error: "File not found." });
    if (!isParticipant(msg.conversationId, req.user.id)) {
      return res.status(403).json({ error: "Access denied." });
    }

    // 1. Check exact saved filePath
    if (msg.filePath && fs.existsSync(msg.filePath)) {
      res.setHeader("Content-Type", msg.mimeType || "application/octet-stream");
      return res.sendFile(msg.filePath);
    }

    // 2. Check filename by message ID prefix
    const files = fs.readdirSync(MSG_UPLOADS_DIR);
    let matched = files.find((f) => f.startsWith(messageId));

    // 3. Fallback for legacy test files: match by file extension
    if (!matched && msg.originalFilename) {
      const ext = path.extname(msg.originalFilename).toLowerCase();
      matched = files.find((f) => path.extname(f).toLowerCase() === ext);
    }

    if (!matched) return res.status(404).json({ error: "File on disk not found." });

    const fullPath = path.join(MSG_UPLOADS_DIR, matched);
    res.setHeader("Content-Type", msg.mimeType || "application/octet-stream");
    return res.sendFile(fullPath);
  } catch (err) {
    console.error("Serve Message File Error:", err);
    return res.status(500).json({ error: "Failed to serve file." });
  }
});

router.patch("/conversations/:id/read", requireAuth, (req, res) => {
  try {
    const convId = req.params.id;
    const now = new Date().toISOString();

    db.update(schema.conversationParticipants)
      .set({ lastReadAt: now })
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, convId),
          eq(schema.conversationParticipants.userId, req.user.id)
        )
      )
      .run();

    db.update(schema.notifications)
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
