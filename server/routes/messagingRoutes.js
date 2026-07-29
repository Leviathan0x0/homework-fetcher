const express = require("express");
const crypto = require("crypto");
const { eq, desc, asc, and, or, sql, lt, gt, ne, inArray } = require("drizzle-orm");
const sessionService = require("../auth/sessionService");
const { requireAuth } = require("../auth/requireAuth");
const { db, schema, isRemote } = require("../db/client");
const { resolveUploadDir, isServerless } = require("../uploads");
const {
  applyDownloadHeaders,
  readFileHead,
  resolveUploadType,
  uploadFileFilter,
} = require("../files/fileTypes");
const { createNotifications } = require("../notifications/notificationService");
const {
  MAX_UPLOAD_BYTES,
  MAX_MESSAGE_CHARS,
  MAX_SEARCH_QUERY_CHARS,
  rateLimit,
  limitText,
} = require("../limits");
const { checkContent } = require("../moderation/checkContent");
const { recordProfanityStrike, reportConversation, withStrikeWarning } = require("../moderation/flagLogService");

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

/** Public shape for a homework item pinned in a chat. */
function toPinnedHomework(hw) {
  if (!hw) return null;
  return {
    id: hw.id,
    subject: hw.subject,
    date: hw.date,
    content: (hw.content || "").substring(0, 160),
    attachmentUrl: hw.attachmentUrl || null,
    type: hw.type || "Homework",
  };
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
    const participationByConv = {};
    for (const p of participations) participationByConv[p.conversationId] = p;

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

    const pinnedIds = [...new Set(convs.map((c) => c.pinnedHomeworkId).filter(Boolean))];
    const pinnedRows = pinnedIds.length
      ? await db.select().from(schema.homework).where(inArray(schema.homework.id, pinnedIds)).all()
      : [];
    const pinnedById = {};
    for (const hw of pinnedRows) pinnedById[hw.id] = toPinnedHomework(hw);

    const result = convs.map((c) => {
      const participation = participationByConv[c.id];
      return {
        id: c.id,
        type: c.type || "dm",
        otherUser: c.type === "section" ? null : toPublicUser(otherByConv[c.id]),
        section: c.section || null,
        lastMessagePreview: c.lastMessagePreview || null,
        lastMessageAt: c.lastMessageAt || c.createdAt,
        unreadCount: unreadByConv[c.id] || 0,
        muted: !!participation?.muted,
        pinnedHomeworkId: c.pinnedHomeworkId || null,
        pinnedHomework: c.pinnedHomeworkId ? pinnedById[c.pinnedHomeworkId] || null : null,
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

const noticeTokens = new Map();

// Periodic cleanup of expired notice tokens
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of noticeTokens.entries()) {
    if (now > data.expiresAt) noticeTokens.delete(token);
  }
}, 60 * 1000);

router.post("/conversations/notice-token", requireAuth, async (req, res) => {
  try {
    const { participantId } = req.body || {};
    if (!participantId || typeof participantId !== "string") {
      return res.status(400).json({ error: "Participant ID is required." });
    }
    const token = crypto.randomUUID();
    const now = Date.now();
    noticeTokens.set(token, {
      userId: req.user.id,
      participantId,
      validAfter: now + 3000,
      expiresAt: now + 5 * 60 * 1000,
    });
    return res.json({ noticeToken: token, validAfter: now + 3000 });
  } catch (err) {
    console.error("Notice Token Error:", err);
    return res.status(500).json({ error: "Failed to generate notice token." });
  }
});

router.post("/conversations", requireAuth, async (req, res) => {
  try {
    const { participantId, noticeToken } = req.body || {};
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

    // Existing DMs never need the monitoring notice again.
    const existing = await db
      .select({ conversationId: schema.conversationParticipants.conversationId })
      .from(schema.conversationParticipants)
      .where(eq(schema.conversationParticipants.userId, req.user.id))
      .all();
    const existingConvIds = existing.map((p) => p.conversationId);

    if (existingConvIds.length > 0) {
      const match = await db
        .select({ conversationId: schema.conversationParticipants.conversationId })
        .from(schema.conversationParticipants)
        .where(
          and(
            inArray(schema.conversationParticipants.conversationId, existingConvIds),
            eq(schema.conversationParticipants.userId, participantId)
          )
        )
        .get();

      if (match) {
        return res.json({
          conversationId: match.conversationId,
          existing: true,
          otherUser: toPublicUser(otherUser),
        });
      }
    }

    // New conversations require the monitoring notice countdown token.
    if (!noticeToken || typeof noticeToken !== "string") {
      return res.status(403).json({
        error: "Monitoring notice confirmation is required before starting a conversation.",
        needsNotice: true,
      });
    }
    const tokenData = noticeTokens.get(noticeToken);
    if (
      !tokenData ||
      tokenData.userId !== req.user.id ||
      tokenData.participantId !== participantId
    ) {
      return res.status(403).json({ error: "Invalid or expired monitoring notice confirmation." });
    }
    if (Date.now() < tokenData.validAfter) {
      return res.status(403).json({
        error: "Monitoring notice countdown must be completed before starting a conversation.",
      });
    }
    noticeTokens.delete(noticeToken);

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
  // Attachments are served back from this origin, so an unrestricted uploader
  // would let one student turn a "document" into a page running in another
  // student's session.
  fileFilter: uploadFileFilter,
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

    // Fetch read receipts for all messages
    const messageIds = msgs.map((m) => m.id);
    const receipts = messageIds.length
      ? await db
          .select()
          .from(schema.messageReadReceipts)
          .where(inArray(schema.messageReadReceipts.messageId, messageIds))
          .all()
      : [];

    const receiptsByMessage = {};
    for (const receipt of receipts) {
      if (!receiptsByMessage[receipt.messageId]) receiptsByMessage[receipt.messageId] = [];
      receiptsByMessage[receipt.messageId].push({
        userId: receipt.userId,
        readAt: receipt.readAt,
      });
    }

    // Fetch parent messages for replies
    const replyToIds = msgs.map((m) => m.replyToId).filter(Boolean);
    const parentMessages = replyToIds.length
      ? await db.select().from(schema.messages).where(inArray(schema.messages.id, replyToIds)).all()
      : [];
    const parentMap = {};
    for (const parent of parentMessages) parentMap[parent.id] = parent;

    const result = msgs.map((m) => {
      const sender = senderMap[m.senderId];
      const parent = m.replyToId ? parentMap[m.replyToId] : null;
      const parentSender = parent ? senderMap[parent.senderId] : null;
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
        replyTo: parent
          ? {
              id: parent.id,
              senderId: parent.senderId,
              senderName: parentSender ? parentSender.displayName || parentSender.studentId : null,
              content: parent.content.substring(0, 100),
              attachmentUrl: parent.attachmentUrl,
            }
          : null,
        readBy: receiptsByMessage[m.id] || [],
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
        if (req.file?.path) fs.unlink(req.file.path, () => {});
        return res.status(403).json({ error: "Access denied." });
      }

      const { value: content, tooLong } = limitText((req.body || {}).content, MAX_MESSAGE_CHARS);
      const replyToId = (req.body || {}).replyToId || null;
      if (!content && !req.file) {
        return res.status(400).json({ error: "Message content or file attachment is required." });
      }
      if (tooLong) {
        if (req.file?.path) fs.unlink(req.file.path, () => {});
        return res.status(413).json({
          error: `Messages are limited to ${MAX_MESSAGE_CHARS} characters.`,
        });
      }

      // Validate replyToId if provided
      if (replyToId) {
        const parentMsg = await db
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.id, replyToId))
          .get();
        if (!parentMsg || parentMsg.conversationId !== convId) {
          if (req.file?.path) fs.unlink(req.file.path, () => {});
          return res.status(400).json({ error: "Invalid reply reference." });
        }
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
        // Derived from the extension allowlist, never from the value the
        // browser declared, because this is what gets served back.
        mimeType = resolveUploadType(req.file.originalname).contentType;
        filePath = req.file.path || null;
      }

      const safety = await checkContent({
        text: trimmed,
        filePath,
        buffer: req.file?.buffer || null,
        mimeType,
      });
      if (!safety.ok) {
        if (req.file?.path) fs.unlink(req.file.path, () => {});
        if (safety.strikeable) {
          try {
            const strike = await recordProfanityStrike({
              userId: req.user.id,
              studentId: req.user.studentId,
              section: req.user.section,
              source: "messages",
              snippet: trimmed || (req.file ? `[blocked image] ${req.file.originalname}` : null),
              conversationId: convId,
            });
            return res.status(400).json({ error: withStrikeWarning(safety.reason, strike) });
          } catch (strikeErr) {
            console.error("Profanity strike log failed:", strikeErr.message);
          }
        }
        return res.status(400).json({ error: safety.reason });
      }

      await db.insert(schema.messages)
        .values({
          id,
          conversationId: convId,
          senderId: req.user.id,
          replyToId: replyToId || null,
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

      // Skip muted recipients — mute means no notification, unread still updates in inbox.
      const otherUserIds = participants
        .filter((p) => p.userId !== req.user.id && !p.muted)
        .map((p) => p.userId);

      if (otherUserIds.length > 0) {
        const convMeta = await db
          .select()
          .from(schema.conversations)
          .where(eq(schema.conversations.id, convId))
          .get();
        const fromName = req.user.displayName || req.user.studentId;
        const isSection = convMeta?.type === "section";
        const title = isSection
          ? `Ask ${convMeta.section || "Class"}`
          : fromName;
        const body = isSection
          ? `${fromName}: ${previewText}`
          : previewText || "Sent an attachment";
        await createNotifications(
          otherUserIds,
          "new_message",
          title,
          body,
          `messages:${convId}`,
          convId
        );
      }

      // Fetch parent message if replying
      let replyTo = null;
      if (replyToId) {
        const parent = await db
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.id, replyToId))
          .get();
        if (parent) {
          const parentSender = await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, parent.senderId))
            .get();
          replyTo = {
            id: parent.id,
            senderId: parent.senderId,
            senderName: parentSender ? parentSender.displayName || parentSender.studentId : null,
            content: parent.content.substring(0, 100),
            attachmentUrl: parent.attachmentUrl,
          };
        }
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
          replyTo,
          readBy: [],
          createdAt: now,
          isMine: true,
        },
      });
    } catch (err) {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
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
      applyDownloadHeaders(res, {
        contentType: msg.mimeType,
        filename: msg.originalFilename,
        head: buffer.subarray(0, 16),
      });
      res.setHeader("Content-Length", String(buffer.length));
      return res.send(buffer);
    }

    if (!fs.existsSync(MSG_UPLOADS_DIR)) {
      return res.status(404).json({ error: "File not found." });
    }

    // 2. Check exact saved filePath
    if (msg.filePath && fs.existsSync(msg.filePath)) {
      applyDownloadHeaders(res, {
        contentType: msg.mimeType,
        filename: msg.originalFilename,
        head: readFileHead(msg.filePath),
      });
      return res.sendFile(msg.filePath);
    }

    // 3. Check filename by message ID prefix
    const files = fs.readdirSync(MSG_UPLOADS_DIR);
    const matched = files.find((f) => f.startsWith(messageId));

    if (!matched) return res.status(404).json({ error: "File on disk not found." });

    const fullPath = path.join(MSG_UPLOADS_DIR, matched);
    applyDownloadHeaders(res, {
      contentType: msg.mimeType,
      filename: msg.originalFilename,
      head: readFileHead(fullPath),
    });
    return res.sendFile(fullPath);
  } catch (err) {
    console.error("Serve Message File Error:", err);
    return res.status(500).json({ error: "Failed to serve file." });
  }
});

/** Removes the stored bytes and on-disk file of the given message rows. */
async function removeMessageArtifacts(msgs) {
  const withAttachment = msgs.filter((m) => m.attachmentUrl);
  if (withAttachment.length === 0) return;

  await db
    .delete(schema.messageAttachments)
    .where(inArray(schema.messageAttachments.messageId, withAttachment.map((m) => m.id)))
    .run();

  for (const msg of withAttachment) {
    if (msg.filePath) fs.unlink(msg.filePath, () => {});
  }
}

/** Rewrites a conversation's preview so the inbox reflects the remaining messages. */
async function refreshConversationPreview(convId) {
  const last = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, convId))
    .orderBy(desc(schema.messages.createdAt))
    .limit(1)
    .get();

  const preview = last
    ? last.attachmentUrl
      ? `[Attachment] ${last.originalFilename}`
      : (last.content || "").substring(0, 80)
    : null;

  await db
    .update(schema.conversations)
    .set({
      lastMessagePreview: preview,
      lastMessageAt: last ? last.createdAt : null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.conversations.id, convId))
    .run();
}

/** Student reports a conversation for staff review (stored in admin_flag_log). */
router.post(
  "/conversations/:id/report",
  requireAuth,
  rateLimit({ name: "report-conversation", windowMs: 60 * 1000, max: 5 }),
  async (req, res) => {
    try {
      const convId = req.params.id;
      if (!(await isParticipant(convId, req.user.id))) {
        return res.status(403).json({ error: "Access denied." });
      }

      const reasonField = limitText((req.body || {}).reason, 500);
      const result = await reportConversation({
        reporterUserId: req.user.id,
        reporterStudentId: req.user.studentId,
        reporterSection: req.user.section,
        conversationId: convId,
        reason: reasonField.value || null,
      });

      return res.status(201).json({
        success: true,
        message: "Thanks — this chat was reported for school review.",
        id: result.id,
      });
    } catch (err) {
      console.error("Report Conversation Error:", err);
      return res.status(500).json({ error: "Could not submit the report. Please try again." });
    }
  }
);

// Only the author may delete a message: participation alone is not enough.
router.delete(
  "/messages/:id",
  requireAuth,
  rateLimit({ name: "delete-message", windowMs: 60 * 1000, max: 60 }),
  async (req, res) => {
    try {
      const messageId = req.params.id;
      const msg = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.id, messageId))
        .get();

      if (!msg) return res.status(404).json({ error: "Message not found." });
      if (msg.senderId !== req.user.id) {
        return res.status(403).json({ error: "You can only delete your own messages." });
      }

      await removeMessageArtifacts([msg]);
      await db.delete(schema.messages).where(eq(schema.messages.id, messageId)).run();
      await refreshConversationPreview(msg.conversationId);

      return res.json({ success: true, conversationId: msg.conversationId });
    } catch (err) {
      console.error("Delete Message Error:", err);
      return res.status(500).json({ error: "Failed to delete message." });
    }
  }
);

// Removing a section thread is deliberately per-user: no student can delete
// the shared group or its messages for classmates.
router.delete(
  "/conversations/:id/leave",
  requireAuth,
  rateLimit({ name: "leave-section-conversation", windowMs: 60 * 1000, max: 30 }),
  async (req, res) => {
    try {
      const convId = req.params.id;
      const conversation = await db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, convId))
        .get();

      if (!conversation) return res.status(404).json({ error: "Conversation not found." });
      if (conversation.type !== "section") {
        return res.status(400).json({ error: "Only section groups can be removed from your chat list." });
      }
      if (!(await isParticipant(convId, req.user.id))) {
        return res.status(403).json({ error: "Access denied." });
      }

      // Leaving is per-user only. The section conversation and every message
      // remain untouched for all other students.
      await db
        .delete(schema.conversationParticipants)
        .where(
          and(
            eq(schema.conversationParticipants.conversationId, convId),
            eq(schema.conversationParticipants.userId, req.user.id)
          )
        )
        .run();
      await db
        .delete(schema.notifications)
        .where(
          and(
            eq(schema.notifications.userId, req.user.id),
            eq(schema.notifications.type, "new_message"),
            eq(schema.notifications.referenceId, convId)
          )
        )
        .run();

      return res.json({ success: true, removedFromChatList: true });
    } catch (err) {
      console.error("Leave Section Conversation Error:", err);
      return res.status(500).json({ error: "Failed to remove group from your chat list." });
    }
  }
);

// A one-to-one chat is deleted for both participants, so only someone who is in
// the conversation may remove it.
router.delete(
  "/conversations/:id",
  requireAuth,
  rateLimit({ name: "delete-conversation", windowMs: 60 * 1000, max: 30 }),
  async (req, res) => {
    try {
      const convId = req.params.id;
      const conversation = await db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, convId))
        .get();

      if (!conversation) return res.status(404).json({ error: "Conversation not found." });
      if (!await isParticipant(convId, req.user.id)) {
        return res.status(403).json({ error: "Access denied." });
      }
      if (conversation.type === "section") {
        return res.status(403).json({
          error: "Ask Class is shared with your section and cannot be deleted. Mute it instead.",
        });
      }

      const msgs = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, convId))
        .all();

      await removeMessageArtifacts(msgs);

      await db.delete(schema.messages).where(eq(schema.messages.conversationId, convId)).run();
      await db
        .delete(schema.conversationParticipants)
        .where(eq(schema.conversationParticipants.conversationId, convId))
        .run();
      await db
        .delete(schema.notifications)
        .where(
          and(
            eq(schema.notifications.type, "new_message"),
            eq(schema.notifications.referenceId, convId)
          )
        )
        .run();
      await db.delete(schema.conversations).where(eq(schema.conversations.id, convId)).run();

      return res.json({ success: true });
    } catch (err) {
      console.error("Delete Conversation Error:", err);
      return res.status(500).json({ error: "Failed to delete conversation." });
    }
  }
);

router.patch("/conversations/:id/read", requireAuth, async (req, res) => {
  try {
    const convId = req.params.id;
    if (!(await isParticipant(convId, req.user.id))) {
      return res.status(403).json({ error: "Access denied." });
    }

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

    // Write per-message read receipts so senders see “seen”.
    const othersMsgs = await db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.conversationId, convId),
          ne(schema.messages.senderId, req.user.id)
        )
      )
      .all();

    for (const msg of othersMsgs) {
      const existing = await db
        .select()
        .from(schema.messageReadReceipts)
        .where(
          and(
            eq(schema.messageReadReceipts.messageId, msg.id),
            eq(schema.messageReadReceipts.userId, req.user.id)
          )
        )
        .get();
      if (!existing) {
        await db
          .insert(schema.messageReadReceipts)
          .values({
            id: crypto.randomUUID(),
            messageId: msg.id,
            userId: req.user.id,
            readAt: now,
          })
          .run();
      }
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("Mark Read Error:", err);
    return res.status(500).json({ error: "Failed to mark as read." });
  }
});

router.post(
  "/messages/:id/read",
  requireAuth,
  rateLimit({ name: "mark-message-read", windowMs: 60 * 1000, max: 200 }),
  async (req, res) => {
    try {
      const messageId = req.params.id;
      const msg = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.id, messageId))
        .get();

      if (!msg) return res.status(404).json({ error: "Message not found." });
      if (!await isParticipant(msg.conversationId, req.user.id)) {
        return res.status(403).json({ error: "Access denied." });
      }

      const existing = await db
        .select()
        .from(schema.messageReadReceipts)
        .where(
          and(
            eq(schema.messageReadReceipts.messageId, messageId),
            eq(schema.messageReadReceipts.userId, req.user.id)
          )
        )
        .get();

      if (!existing) {
        await db
          .insert(schema.messageReadReceipts)
          .values({
            id: crypto.randomUUID(),
            messageId,
            userId: req.user.id,
            readAt: new Date().toISOString(),
          })
          .run();
      }

      return res.json({ success: true });
    } catch (err) {
      console.error("Mark Message Read Error:", err);
      return res.status(500).json({ error: "Failed to mark message as read." });
    }
  }
);

router.patch(
  "/conversations/:id/mute",
  requireAuth,
  rateLimit({ name: "mute-conversation", windowMs: 60 * 1000, max: 30 }),
  async (req, res) => {
    try {
      const convId = req.params.id;
      const { muted } = req.body || {};
      if (typeof muted !== "boolean") {
        return res.status(400).json({ error: "Muted must be true or false." });
      }

      if (!await isParticipant(convId, req.user.id)) {
        return res.status(403).json({ error: "Access denied." });
      }

      await db
        .update(schema.conversationParticipants)
        .set({ muted: muted ? 1 : 0 })
        .where(
          and(
            eq(schema.conversationParticipants.conversationId, convId),
            eq(schema.conversationParticipants.userId, req.user.id)
          )
        )
        .run();

      return res.json({ success: true, muted });
    } catch (err) {
      console.error("Mute Conversation Error:", err);
      return res.status(500).json({ error: "Failed to update mute status." });
    }
  }
);

router.patch(
  "/conversations/:id/pin-homework",
  requireAuth,
  rateLimit({ name: "pin-homework", windowMs: 60 * 1000, max: 30 }),
  async (req, res) => {
    try {
      const convId = req.params.id;
      const { homeworkId } = req.body || {};

      if (!(await isParticipant(convId, req.user.id))) {
        return res.status(403).json({ error: "Access denied." });
      }

      let pinned = null;
      if (homeworkId) {
        const hw = await db
          .select()
          .from(schema.homework)
          .where(eq(schema.homework.id, homeworkId))
          .get();
        if (!hw) {
          return res.status(404).json({ error: "Homework not found." });
        }
        if (hw.userId !== req.user.id) {
          return res.status(403).json({ error: "You can only pin your own homework." });
        }
        if (!hw.attachmentUrl) {
          return res.status(400).json({
            error: "That homework has no PDF or file to pin. Pick one with an attachment.",
          });
        }
        pinned = toPinnedHomework(hw);
      }

      await db
        .update(schema.conversations)
        .set({ pinnedHomeworkId: homeworkId || null, updatedAt: new Date().toISOString() })
        .where(eq(schema.conversations.id, convId))
        .run();

      return res.json({
        success: true,
        pinnedHomeworkId: homeworkId || null,
        pinnedHomework: pinned,
      });
    } catch (err) {
      console.error("Pin Homework Error:", err);
      return res.status(500).json({ error: "Failed to pin homework." });
    }
  }
);

router.post(
  "/conversations/section",
  requireAuth,
  rateLimit({ name: "create-section-conversation", windowMs: 60 * 1000, max: 5 }),
  async (req, res) => {
    try {
      const section = req.user.section;
      if (!section) {
        return res.status(400).json({ error: "Your section is not set." });
      }

      // Check if a section conversation already exists
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

      if (existing) {
        // Late joiners (new accounts / first open) still get into the section thread.
        const alreadyIn = await isParticipant(existing.id, req.user.id);
        if (!alreadyIn) {
          await db
            .insert(schema.conversationParticipants)
            .values({
              id: crypto.randomUUID(),
              conversationId: existing.id,
              userId: req.user.id,
              createdAt: new Date().toISOString(),
            })
            .run();
        }
        return res.json({
          conversationId: existing.id,
          existing: true,
          section,
        });
      }

      // Create new section conversation
      const convId = crypto.randomUUID();
      const now = new Date().toISOString();

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

      // Add all students in this section as participants
      const studentsInSection = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.section, section))
        .all();

      for (const student of studentsInSection) {
        await db
          .insert(schema.conversationParticipants)
          .values({
            id: crypto.randomUUID(),
            conversationId: convId,
            userId: student.id,
            createdAt: now,
          })
          .run();
      }

      return res.status(201).json({
        conversationId: convId,
        existing: false,
        section,
      });
    } catch (err) {
      console.error("Create Section Conversation Error:", err);
      return res.status(500).json({ error: "Failed to create section conversation." });
    }
  }
);

module.exports = router;
