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
    const section = req.user.section;
    if (!q || q.length < 1) return res.json({ users: [] });

    const allUsers = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.section, section))
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
    if (otherUser.section !== req.user.section) {
      return res.status(403).json({ error: "Can only message users in your section." });
    }

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
  try {
    const convId = req.params.id;
    if (!isParticipant(convId, req.user.id)) {
      return res.status(403).json({ error: "Access denied." });
    }

    const { content } = req.body || {};
    if (!content || typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "Message content is required." });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const trimmed = content.trim();

    db.insert(schema.messages)
      .values({
        id,
        conversationId: convId,
        senderId: req.user.id,
        content: trimmed,
        createdAt: now,
      })
      .run();

    db.update(schema.conversations)
      .set({
        lastMessagePreview: trimmed.substring(0, 80),
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
        trimmed.substring(0, 100),
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
        createdAt: now,
        isMine: true,
      },
    });
  } catch (err) {
    console.error("Send Message Error:", err);
    return res.status(500).json({ error: "Failed to send message." });
  }
});

router.patch("/conversations/:id/read", requireAuth, (req, res) => {
  try {
    const convId = req.params.id;
    const now = new Date().toISOString();

    const result = db
      .update(schema.conversationParticipants)
      .set({ lastReadAt: now })
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, convId),
          eq(schema.conversationParticipants.userId, req.user.id)
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
