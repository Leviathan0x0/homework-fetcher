const express = require("express");
const crypto = require("crypto");
const { eq, desc, asc, and, or, sql, gt, ne, inArray } = require("drizzle-orm");
const sessionService = require("../auth/sessionService");
const { requireAuth } = require("../auth/requireAuth");
const { db, schema, isRemote, runBatch } = require("../db/client");
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
const { ensureSectionConversation } = require("../messaging/sectionConversation");
const { isUnknownSection } = require("../auth/sessionService");
const {
  mintNoticeToken,
  verifyNoticeToken,
  looksLikeUuid,
} = require("../messaging/noticeToken");

const router = express.Router();

const REQUEST_OPEN = "⟦hf-request⟧";
const REQUEST_CLOSE = "⟦/hf-request⟧";

/** Removes request-reference transport metadata before text reaches a preview. */
function messagePreviewText(content) {
  const text = String(content || "");
  if (!text.startsWith(REQUEST_OPEN)) return text;

  const end = text.indexOf(REQUEST_CLOSE);
  if (end >= 0) {
    const body = text.slice(end + REQUEST_CLOSE.length).replace(/^\n/, "").trim();
    if (body) return body;
    try {
      const request = JSON.parse(text.slice(REQUEST_OPEN.length, end));
      return request?.title ? `Help request: ${request.title}` : "Help request";
    } catch {
      return "Help request";
    }
  }

  const titleMatch = text.match(/"title"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!titleMatch) return "Help request";
  try {
    return `Help request: ${JSON.parse(`"${titleMatch[1]}"`)}`;
  } catch {
    return "Help request";
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


function cleanStudentId(raw) {
  return String(raw || "")
    .trim()
    .replace(/@manavmangalschool\.com$/gi, "")
    .replace(/\s+/g, "");
}

/** School portal usernames are alphanumeric (often name + digits). */
function isPlausibleStudentId(raw) {
  const id = cleanStudentId(raw);
  if (id.length < 3 || id.length > 64) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id);
}

/**
 * Resolves a chat peer from either a user id or an EduSecure student id.
 * Returns the users-table row (or findOrCreate shape) or null.
 */
async function resolveParticipantUser({ participantId, studentId }) {
  const pid = typeof participantId === "string" ? participantId.trim() : "";
  const sid = typeof studentId === "string" ? cleanStudentId(studentId) : "";

  if (pid) {
    const byId = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, pid))
      .get();
    if (byId) return byId;

    // Help deep-links and typed searches sometimes send a student ID in the
    // participantId field. Never treat a UUID-shaped value as a student ID.
    if (!looksLikeUuid(pid) && isPlausibleStudentId(pid)) {
      return sessionService.findOrCreateUser(cleanStudentId(pid));
    }
  }

  if (sid) {
    if (!isPlausibleStudentId(sid)) return null;
    return sessionService.findOrCreateUser(sid);
  }

  return null;
}

/** Display-only alias: remove login digits and punctuation before sharing it. */
function alphabeticStudentAlias(studentId) {
  const letters = String(studentId || "").replace(/[^a-zA-Z]/g, "");
  if (!letters) return null;
  return letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase();
}

function toPublicUser(user, extra = {}) {
  if (!user) return null;
  const displayName = user.displayName || alphabeticStudentAlias(user.studentId);
  const result = {
    id: user.id,
    displayName: displayName || null,
    name: displayName || "Student",
    profilePictureUrl: user.profilePictureUpdatedAt
      ? profilePictureUrlFor(user.id, user.profilePictureUpdatedAt)
      : null,
    section: isUnknownSection(user.section) ? null : user.section,
    ...extra,
  };
  // A student ID is only needed for a provisional result that the current
  // user explicitly typed. Never include stored EduSecure IDs for known users.
  if (extra.provisional && user.studentId) result.studentId = user.studentId;
  return result;
}

function profilePictureUrlFor(userId, updatedAt) {
  return userId
    ? `/api/auth/profile/picture/${encodeURIComponent(userId)}${updatedAt ? `?v=${encodeURIComponent(updatedAt)}` : ""}`
    : null;
}

async function toPublicUserWithPicture(user) {
  if (!user) return null;
  const picture = await db
    .select({ updatedAt: schema.profilePictures.updatedAt })
    .from(schema.profilePictures)
    .where(eq(schema.profilePictures.userId, user.id))
    .get();
  return toPublicUser({
    ...user,
    profilePictureUpdatedAt: picture?.updatedAt || null,
  });
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
        .select({
          id: schema.users.id,
          studentId: schema.users.studentId,
          displayName: schema.users.displayName,
          section: schema.users.section,
          profilePictureUpdatedAt: schema.profilePictures.updatedAt,
        })
        .from(schema.users)
        .leftJoin(schema.profilePictures, eq(schema.profilePictures.userId, schema.users.id))
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

      // Allow messaging by student ID even if they have never opened the app.
      const typedId = cleanStudentId(q);
      const selfId = cleanStudentId(req.user.studentId).toLowerCase();
      if (
        isPlausibleStudentId(typedId) &&
        typedId.toLowerCase() !== selfId
      ) {
        const exactInResults = matched.some(
          (u) => cleanStudentId(u.studentId).toLowerCase() === typedId.toLowerCase()
        );
        if (!exactInResults) {
          matched.unshift(
            toPublicUser(
              {
                id: null,
                studentId: typedId,
                displayName: null,
                section: null,
              },
              { provisional: true }
            )
          );
        }
      }

      const users = matched.map((u) => (
        u.provisional ? u : toPublicUser(u)
      ));
      return res.json({ users });
    } catch (err) {
      console.error("User Search Error:", err);
      return res.status(500).json({ error: "Search failed." });
    }
  }
);

/**
 * Creates a placeholder account for a student ID that has never logged in,
 * so a DM can be opened immediately. When they later sign in with the same
 * EduSecure ID they inherit this row (and any waiting messages).
 */
router.post(
  "/users/resolve",
  requireAuth,
  rateLimit({ name: "user-resolve", windowMs: 60 * 1000, max: 60 }),
  async (req, res) => {
    try {
      const typedId = cleanStudentId(req.body?.studentId);
      if (!isPlausibleStudentId(typedId)) {
        return res.status(400).json({
          error: "Enter a valid student ID (for example kiaan1240).",
        });
      }
      if (typedId.toLowerCase() === cleanStudentId(req.user.studentId).toLowerCase()) {
        return res.status(400).json({ error: "You cannot message yourself." });
      }

      const user = await sessionService.findOrCreateUser(typedId);
      return res.json({ user: await toPublicUserWithPicture(user) });
    } catch (err) {
      console.error("User Resolve Error:", err);
      return res.status(500).json({ error: "Could not look up that student ID." });
    }
  }
);

router.get("/conversations", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Auto-join the class group so new students do not have to hunt for a join button.
    try {
      await ensureSectionConversation(req.user);
    } catch (err) {
      console.error("Auto-join class group failed:", err.message);
    }

    const participations = await db
      .select()
      .from(schema.conversationParticipants)
      .where(eq(schema.conversationParticipants.userId, userId))
      .all();

    if (participations.length === 0) return res.json({ conversations: [] });

    const convIds = participations.map((p) => p.conversationId);
    const participationByConv = {};
    for (const p of participations) participationByConv[p.conversationId] = p;

    // Every remaining lookup is independent, so they go out together instead of
    // paying one network round trip after another.
    const [members, convs, unreadRows] = await Promise.all([
      // Members of each conversation, joined with their account, so the whole
      // user table never has to be transferred. One pass gives both the other
      // participant of a DM and the member count of a class group.
      db
        .select({
          conversationId: schema.conversationParticipants.conversationId,
          id: schema.users.id,
          studentId: schema.users.studentId,
          displayName: schema.users.displayName,
          profilePictureUpdatedAt: schema.profilePictures.updatedAt,
          section: schema.users.section,
        })
        .from(schema.conversationParticipants)
        .innerJoin(schema.users, eq(schema.users.id, schema.conversationParticipants.userId))
        .leftJoin(schema.profilePictures, eq(schema.profilePictures.userId, schema.users.id))
        .where(inArray(schema.conversationParticipants.conversationId, convIds))
        .all(),
      db
        .select()
        .from(schema.conversations)
        .where(inArray(schema.conversations.id, convIds))
        .all(),
      // Unread counts for every conversation in a single aggregate query.
      db.all(sql`
        SELECT m.conversation_id AS conversation_id, COUNT(*) AS unread
        FROM messages m
        JOIN conversation_participants p
          ON p.conversation_id = m.conversation_id AND p.user_id = ${userId}
        WHERE m.sender_id <> ${userId}
          AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
        GROUP BY m.conversation_id
      `),
    ]);

    const otherByConv = {};
    const memberCountByConv = {};
    for (const row of members) {
      memberCountByConv[row.conversationId] = (memberCountByConv[row.conversationId] || 0) + 1;
      if (row.id !== userId) otherByConv[row.conversationId] = row;
    }

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
        memberCount: memberCountByConv[c.id] || 0,
        lastMessagePreview: c.lastMessagePreview ? messagePreviewText(c.lastMessagePreview) : null,
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

router.post("/conversations/notice-token", requireAuth, async (req, res) => {
  try {
    const { participantId, studentId } = req.body || {};
    const participant = await resolveParticipantUser({ participantId, studentId });
    if (!participant?.id) {
      return res.status(404).json({ error: "User not found." });
    }
    if (participant.id === req.user.id) {
      return res.status(400).json({ error: "Cannot start a conversation with yourself." });
    }

    // Signed tokens avoid the previous DB insert path, which failed whenever the
    // participant row was missing (FK) or the token table was unavailable.
    const minted = mintNoticeToken({
      userId: req.user.id,
      participantId: participant.id,
    });
    return res.json(minted);
  } catch (err) {
    console.error("Notice Token Error:", err);
    return res.status(500).json({ error: "Failed to generate notice token." });
  }
});

router.post("/conversations", requireAuth, async (req, res) => {
  try {
    let { participantId, studentId, noticeToken } = req.body || {};

    const resolvedParticipant = await resolveParticipantUser({ participantId, studentId });
    if (!resolvedParticipant?.id) {
      return res.status(404).json({ error: "User not found." });
    }
    participantId = resolvedParticipant.id;

    if (participantId === req.user.id) {
      return res.status(400).json({ error: "Cannot start a conversation with yourself." });
    }

    const otherUser = resolvedParticipant;

    // Existing 1:1 DMs never need the monitoring notice again.
    // Do NOT match section class-group threads - every classmate is a participant there.
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
        .innerJoin(
          schema.conversations,
          eq(schema.conversations.id, schema.conversationParticipants.conversationId)
        )
        .where(
          and(
            inArray(schema.conversationParticipants.conversationId, existingConvIds),
            eq(schema.conversationParticipants.userId, participantId),
            sql`coalesce(${schema.conversations.type}, 'dm') = 'dm'`
          )
        )
        .get();

      if (match) {
        return res.json({
          conversationId: match.conversationId,
          existing: true,
          type: "dm",
          otherUser: await toPublicUserWithPicture(otherUser),
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

    const signed = verifyNoticeToken(noticeToken, {
      userId: req.user.id,
      participantId,
    });
    if (signed.ok) {
      // Preferred path: HMAC token minted by /conversations/notice-token.
    } else if (signed.tooEarly) {
      return res.status(403).json({
        error: "Monitoring notice countdown must be completed before starting a conversation.",
      });
    } else {
      // Legacy UUID tokens stored in monitoring_notice_tokens (pre-signed-token).
      const tokenData = await db
        .select()
        .from(schema.monitoringNoticeTokens)
        .where(eq(schema.monitoringNoticeTokens.token, noticeToken))
        .get();
      if (
        !tokenData ||
        tokenData.userId !== req.user.id ||
        tokenData.participantId !== participantId ||
        Date.now() > tokenData.expiresAt
      ) {
        return res.status(403).json({ error: "Invalid or expired monitoring notice confirmation." });
      }
      if (Date.now() < tokenData.validAfter) {
        return res.status(403).json({
          error: "Monitoring notice countdown must be completed before starting a conversation.",
        });
      }
      await db
        .delete(schema.monitoringNoticeTokens)
        .where(eq(schema.monitoringNoticeTokens.token, noticeToken))
        .run();
    }

    const convId = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.insert(schema.conversations)
      .values({ id: convId, type: "dm", createdAt: now, updatedAt: now })
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
      type: "dm",
      otherUser: await toPublicUserWithPicture(otherUser),
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

/**
 * Sender-generated id for one composed message.
 *
 * A send that fails, or whose answer never arrives, is retried with the same
 * value, which is what lets the server store the message once instead of
 * posting the same text twice.
 */
function normalizeClientMessageId(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value || value.length > 100) return null;
  return /^[A-Za-z0-9._:-]+$/.test(value) ? value : null;
}

/** Removes a temporary upload that will not be attached to a stored message. */
function discardUpload(file) {
  if (file?.path) fs.unlink(file.path, () => {});
}

/** The message already stored for this sender-generated id, if any. */
async function findMessageByClientId(conversationId, clientMessageId) {
  if (!clientMessageId) return null;
  const row = await db
    .select()
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.clientMessageId, clientMessageId)
      )
    )
    .get();
  return row || null;
}

/** Quoted-message chrome shown above a reply. */
async function replyReferenceFor(parent) {
  if (!parent) return null;
  const parentSender = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, parent.senderId))
    .get();
  return {
    id: parent.id,
    senderId: parent.senderId,
    senderName: parentSender
      ? parentSender.displayName || alphabeticStudentAlias(parentSender.studentId) || "Student"
      : "Student",
    content: (parent.content || "").substring(0, 100),
    attachmentUrl: parent.attachmentUrl,
  };
}

/** Public shape of a message the caller just sent. */
function sentMessageResponse(row, sender, replyTo) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    senderName: sender.displayName || alphabeticStudentAlias(sender.studentId) || "You",
    content: row.content,
    attachmentUrl: row.attachmentUrl,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    clientMessageId: row.clientMessageId || null,
    replyTo: replyTo || null,
    readBy: [],
    createdAt: row.createdAt,
    isMine: true,
  };
}

router.get("/conversations/:id/messages", requireAuth, async (req, res) => {
  try {
    const convId = req.params.id;
    if (!await isParticipant(convId, req.user.id)) {
      return res.status(403).json({ error: "Access denied." });
    }

    // Optional cursor: only messages newer than this timestamp are returned,
    // so a chat left open in the background polls new arrivals instead of
    // downloading the whole thread every few seconds.
    const afterRaw = req.query.after;
    const afterMs = typeof afterRaw === "string" && afterRaw ? new Date(afterRaw).getTime() : null;
    const afterIso = afterMs && !Number.isNaN(afterMs) ? new Date(afterMs).toISOString() : null;

    const msgs = await db
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.conversationId, convId),
          ...(afterIso ? [gt(schema.messages.createdAt, afterIso)] : [])
        )
      )
      .orderBy(asc(schema.messages.createdAt))
      .all();

    const senderIds = [...new Set(msgs.map((m) => m.senderId))];
    const messageIds = msgs.map((m) => m.id);
    const replyToIds = [...new Set(msgs.map((m) => m.replyToId).filter(Boolean))];

    // Senders, read receipts and quoted messages do not depend on each other,
    // so the thread opens after one round trip instead of three.
    const [senders, receipts, parentMessages, senderPictures] = await Promise.all([
      senderIds.length
        ? db.select().from(schema.users).where(inArray(schema.users.id, senderIds)).all()
        : [],
      messageIds.length
        ? db
            .select()
            .from(schema.messageReadReceipts)
            .where(inArray(schema.messageReadReceipts.messageId, messageIds))
            .all()
        : [],
      replyToIds.length
        ? db.select().from(schema.messages).where(inArray(schema.messages.id, replyToIds)).all()
        : [],
      senderIds.length
        ? db.select().from(schema.profilePictures).where(inArray(schema.profilePictures.userId, senderIds)).all()
        : [],
    ]);

    const senderMap = {};
    for (const sender of senders) senderMap[sender.id] = sender;

    const receiptsByMessage = {};
    for (const receipt of receipts) {
      if (!receiptsByMessage[receipt.messageId]) receiptsByMessage[receipt.messageId] = [];
      receiptsByMessage[receipt.messageId].push({
        userId: receipt.userId,
        readAt: receipt.readAt,
      });
    }

    const parentMap = {};
    for (const parent of parentMessages) parentMap[parent.id] = parent;
    const senderPictureMap = {};
    for (const picture of senderPictures) senderPictureMap[picture.userId] = picture;

    const result = msgs.map((m) => {
      const sender = senderMap[m.senderId];
      const parent = m.replyToId ? parentMap[m.replyToId] : null;
      const parentSender = parent ? senderMap[parent.senderId] : null;
      return {
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        senderName: sender
          ? sender.displayName || alphabeticStudentAlias(sender.studentId) || "Student"
          : "Student",
        senderProfilePictureUrl: senderPictureMap[m.senderId]
          ? profilePictureUrlFor(m.senderId, senderPictureMap[m.senderId].updatedAt)
          : null,
        content: m.content,
        attachmentUrl: m.attachmentUrl,
        originalFilename: m.originalFilename,
        mimeType: m.mimeType,
        replyTo: parent
          ? {
              id: parent.id,
              senderId: parent.senderId,
              senderName: parentSender
                ? parentSender.displayName || alphabeticStudentAlias(parentSender.studentId) || "Student"
                : "Student",
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
      const clientMessageId = normalizeClientMessageId((req.body || {}).clientMessageId);
      const { value: content, tooLong } = limitText((req.body || {}).content, MAX_MESSAGE_CHARS);
      const replyToId = (req.body || {}).replyToId || null;
      const trimmed = content;

      if (!content && !req.file) {
        return res.status(400).json({ error: "Message content or file attachment is required." });
      }
      if (tooLong) {
        discardUpload(req.file);
        return res.status(413).json({
          error: `Messages are limited to ${MAX_MESSAGE_CHARS} characters.`,
        });
      }

      // Derived from the extension allowlist, never from the value the
      // browser declared, because this is what gets served back.
      const mimeType = req.file ? resolveUploadType(req.file.originalname).contentType : null;

      // Content safety does not depend on any of the lookups below, and the
      // lookups do not depend on each other. Running them one after another is
      // what made sending slow: a hosted database charges a network round trip
      // per statement, and the moderation call is a second hop on top.
      const safetyPromise = checkContent({
        text: trimmed,
        filePath: req.file?.path || null,
        buffer: req.file?.buffer || null,
        mimeType,
      }).catch((safetyErr) => {
        console.error("Content check failed:", safetyErr.message);
        return {
          ok: false,
          reason: "Content could not be verified right now. Please try again in a moment.",
          strikeable: false,
        };
      });

      const { isSettingEnabled } = require("../admin/settingsService");
      const [participants, convMeta, dbUser, chatEnabled, parentMsg, alreadySent] = await Promise.all([
        db
          .select()
          .from(schema.conversationParticipants)
          .where(eq(schema.conversationParticipants.conversationId, convId))
          .all(),
        db.select().from(schema.conversations).where(eq(schema.conversations.id, convId)).get(),
        db.select().from(schema.users).where(eq(schema.users.id, req.user.id)).get(),
        // Enforce Global Section Chat Toggle (default enabled when unset)
        isSettingEnabled("global_chat_enabled"),
        replyToId
          ? db.select().from(schema.messages).where(eq(schema.messages.id, replyToId)).get()
          : null,
        findMessageByClientId(convId, clientMessageId),
      ]);

      if (!participants.some((participant) => participant.userId === req.user.id)) {
        discardUpload(req.file);
        return res.status(403).json({ error: "Access denied." });
      }

      // A previous attempt reached the database even though its answer never
      // reached the browser (dropped connection, platform timeout). Hand back
      // the stored message instead of posting the same text a second time.
      if (alreadySent) {
        discardUpload(req.file);
        return res.json({
          success: true,
          duplicate: true,
          message: sentMessageResponse(
            alreadySent,
            req.user,
            await replyReferenceFor(parentMsg).catch(() => null)
          ),
        });
      }

      // Enforce Admin Mute Status
      if (dbUser && dbUser.isMuted === 1) {
        discardUpload(req.file);
        return res.status(403).json({ error: "Your account has been muted by an administrator." });
      }

      if (!chatEnabled && req.user.studentId !== "admin_mmss" && req.user.role !== "admin") {
        discardUpload(req.file);
        return res.status(403).json({ error: "Section messaging is currently paused by the administrator." });
      }

      if (replyToId && (!parentMsg || parentMsg.conversationId !== convId)) {
        discardUpload(req.file);
        return res.status(400).json({ error: "Invalid reply reference." });
      }

      const safety = await safetyPromise;
      if (!safety.ok) {
        discardUpload(req.file);
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

      const id = req.messageId || crypto.randomUUID();
      const now = new Date().toISOString();

      const row = {
        id,
        conversationId: convId,
        senderId: req.user.id,
        replyToId: replyToId || null,
        content: trimmed,
        attachmentUrl: req.file ? `/api/messages/files/${id}` : null,
        originalFilename: req.file ? req.file.originalname : null,
        mimeType,
        filePath: req.file?.path || null,
        clientMessageId,
        createdAt: now,
      };

      const previewText = req.file
        ? `[Attachment] ${row.originalFilename}`
        : messagePreviewText(trimmed).substring(0, 80);

      try {
        // The row, its attachment bytes and the inbox preview belong to one
        // logical write, so they go out as a single pipelined batch.
        await runBatch([
          db.insert(schema.messages).values(row),
          req.file && STORE_ATTACHMENTS_IN_DB
            ? db
                .insert(schema.messageAttachments)
                .values({ messageId: id, data: req.file.buffer.toString("base64"), createdAt: now })
            : null,
          db
            .update(schema.conversations)
            .set({
              lastMessagePreview: previewText,
              lastMessageAt: now,
              updatedAt: now,
            })
            .where(eq(schema.conversations.id, convId)),
        ]);
      } catch (writeErr) {
        // Two attempts at the same composed message can overlap, and the write
        // can also fail after the row itself landed. Either way the stored
        // message is the answer: reporting a failure is what made the sender
        // send it again.
        const stored = await findMessageByClientId(convId, clientMessageId).catch(() => null);
        if (!stored) throw writeErr;
        discardUpload(req.file);
        return res.json({
          success: true,
          duplicate: true,
          message: sentMessageResponse(
            stored,
            req.user,
            await replyReferenceFor(parentMsg).catch(() => null)
          ),
        });
      }

      // From here the message exists, so the send has succeeded. Notifications
      // and the quoted-reply chrome are decoration around it, and a failure
      // there must not be reported as a message that was never sent.
      let replyTo = null;
      try {
        // Skip muted recipients - mute means no notification, unread still updates in inbox.
        const otherUserIds = participants
          .filter((participant) => participant.userId !== req.user.id && !participant.muted)
          .map((participant) => participant.userId);
        const fromName =
          req.user.displayName || alphabeticStudentAlias(req.user.studentId) || "Student";
        const isSection = convMeta?.type === "section";

        const [reference] = await Promise.all([
          replyReferenceFor(parentMsg),
          otherUserIds.length
            ? createNotifications(
                otherUserIds,
                "new_message",
                isSection ? `Class ${convMeta.section || "group"}` : fromName,
                isSection ? `${fromName}: ${previewText}` : previewText || "Sent an attachment",
                `messages:${convId}`,
                convId
              )
            : null,
        ]);
        replyTo = reference;
      } catch (followUpErr) {
        console.error("Send Message follow-up failed:", followUpErr.message);
      }

      return res.status(201).json({
        success: true,
        message: sentMessageResponse(row, req.user, replyTo),
      });
    } catch (err) {
      discardUpload(req.file);
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
        message: "Thanks - this chat was reported for school review.",
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
          error: "Class group is shared with your section and cannot be deleted. Mute it instead.",
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
    // The old loop issued one SELECT plus one INSERT per message; a busy class
    // thread could make opening it cost hundreds of sequential round trips.
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

    if (othersMsgs.length > 0) {
      const messageIds = othersMsgs.map((m) => m.id);
      const existingRows = await db
        .select({ messageId: schema.messageReadReceipts.messageId })
        .from(schema.messageReadReceipts)
        .where(
          and(
            inArray(schema.messageReadReceipts.messageId, messageIds),
            eq(schema.messageReadReceipts.userId, req.user.id)
          )
        )
        .all();
      const existingSet = new Set(existingRows.map((r) => r.messageId));
      const missing = othersMsgs.filter((m) => !existingSet.has(m.id));

      if (missing.length > 0) {
        await db
          .insert(schema.messageReadReceipts)
          .values(
            missing.map((m) => ({
              id: crypto.randomUUID(),
              messageId: m.id,
              userId: req.user.id,
              readAt: now,
            }))
          )
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

      const result = await ensureSectionConversation(req.user);
      if (!result) {
        return res.status(400).json({ error: "Could not open your class group." });
      }

      return res.status(result.existing ? 200 : 201).json({
        conversationId: result.conversationId,
        existing: result.existing,
        section: result.section,
      });
    } catch (err) {
      console.error("Create Section Conversation Error:", err);
      return res.status(500).json({ error: "Failed to open class group." });
    }
  }
);

/** Classmates in the current user's section (display names only). */
router.get("/section/members", requireAuth, async (req, res) => {
  try {
    const section = req.user.section;
    if (!section) return res.json({ section: null, members: [] });

    const rows = await db
      .select({
        id: schema.users.id,
        studentId: schema.users.studentId,
        displayName: schema.users.displayName,
        profilePictureUpdatedAt: schema.profilePictures.updatedAt,
        section: schema.users.section,
      })
      .from(schema.users)
      .leftJoin(schema.profilePictures, eq(schema.profilePictures.userId, schema.users.id))
      .where(eq(schema.users.section, section))
      .orderBy(asc(schema.users.displayName), asc(schema.users.studentId))
      .all();

    return res.json({
      section,
      members: rows.map((u) => toPublicUser(u)),
    });
  } catch (err) {
    console.error("Section Members Error:", err);
    return res.status(500).json({ error: "Failed to load classmates." });
  }
});

module.exports = router;
