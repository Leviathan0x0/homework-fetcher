const { sqliteTable, text, integer, index, uniqueIndex } = require("drizzle-orm/sqlite-core");

const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id").notNull().unique(),
    displayName: text("display_name"),
    section: text("section"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_users_student_id").on(table.studentId),
  ]
);

const edusecureSessions = sqliteTable(
  "edusecure_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    encryptedSessionData: text("encrypted_session_data").notNull(),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_edusecure_user_id").on(table.userId),
  ]
);

const appSessions = sqliteTable(
  "app_sessions",
  {
    token: text("token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_app_sessions_user_id").on(table.userId),
  ]
);

const homework = sqliteTable(
  "homework",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceIdentifier: text("source_identifier").notNull().default("edusecure"),
    date: text("date").notNull(),
    subject: text("subject").notNull(),
    content: text("content").notNull(),
    attachmentUrl: text("attachment_url"),
    type: text("type").notNull().default("Homework"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_homework_user_id").on(table.userId),
    index("idx_homework_user_date").on(table.userId, table.date),
  ]
);

const homeworkUserState = sqliteTable(
  "homework_user_state",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    homeworkId: text("homework_id")
      .notNull()
      .references(() => homework.id, { onDelete: "cascade" }),
    completed: integer("completed").notNull().default(0),
    note: text("note"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("unique_user_homework_state").on(table.userId, table.homeworkId),
    index("idx_user_state_user_id").on(table.userId),
  ]
);

const classworkUploads = sqliteTable(
  "classwork_uploads",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    studentId: text("student_id").notNull(),
    section: text("section").notNull(),
    subject: text("subject").notNull(),
    title: text("title"),
    date: text("date").notNull(),
    fileUrl: text("file_url").notNull(),
    filePath: text("file_path").notNull(),
    originalFilename: text("original_filename").notNull(),
    fileSize: integer("file_size").notNull(),
    mimeType: text("mime_type").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_classwork_section").on(table.section),
    index("idx_classwork_section_date").on(table.section, table.date),
    index("idx_classwork_user_id").on(table.userId),
  ]
);

const sectionRequests = sqliteTable(
  "section_requests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    studentId: text("student_id").notNull(),
    section: text("section").notNull(),
    category: text("category"),
    title: text("title").notNull(),
    content: text("content").notNull(),
    status: text("status").notNull().default("open"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_requests_section_created").on(t.section, t.createdAt),
    index("idx_requests_user_id").on(t.userId),
  ]
);

const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    referenceId: text("reference_id"),
    isRead: integer("is_read").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_notifications_user_unread").on(t.userId, t.isRead),
    index("idx_notifications_created").on(t.createdAt),
  ]
);

const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull().default("dm"),
    section: text("section"),
    lastMessagePreview: text("last_message_preview"),
    lastMessageAt: text("last_message_at"),
    pinnedHomeworkId: text("pinned_homework_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  }
);

const conversationParticipants = sqliteTable(
  "conversation_participants",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    lastReadAt: text("last_read_at"),
    muted: integer("muted").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_cp_conv_user").on(t.conversationId, t.userId),
    index("idx_cp_user_id").on(t.userId),
  ]
);

const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    senderId: text("sender_id").notNull().references(() => users.id),
    replyToId: text("reply_to_id").references(() => messages.id),
    content: text("content").notNull().default(""),
    attachmentUrl: text("attachment_url"),
    originalFilename: text("original_filename"),
    mimeType: text("mime_type"),
    filePath: text("file_path"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_messages_conversation_created").on(t.conversationId, t.createdAt),
    index("idx_messages_reply_to").on(t.replyToId),
  ]
);

const messageAttachments = sqliteTable(
  "message_attachments",
  {
    messageId: text("message_id").primaryKey().references(() => messages.id, { onDelete: "cascade" }),
    data: text("data").notNull(),
    createdAt: text("created_at").notNull(),
  }
);

/** Classwork file bytes when there is no persistent upload volume (serverless). */
const classworkAttachments = sqliteTable(
  "classwork_attachments",
  {
    classworkId: text("classwork_id")
      .primaryKey()
      .references(() => classworkUploads.id, { onDelete: "cascade" }),
    data: text("data").notNull(),
    createdAt: text("created_at").notNull(),
  }
);

const messageReadReceipts = sqliteTable(
  "message_read_receipts",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    readAt: text("read_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_mrr_message_user").on(t.messageId, t.userId),
    index("idx_mrr_message_id").on(t.messageId),
  ]
);

/** Running count of blocked vulgar/abuse text attempts per student. */
const moderationStrikes = sqliteTable(
  "moderation_strikes",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    count: integer("count").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  }
);

/**
 * Staff-facing log. Written when a student hits 3 vulgar blocks, or when a
 * student reports a conversation. No teacher UI yet — query this table later.
 */
const adminFlagLog = sqliteTable(
  "admin_flag_log",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    studentId: text("student_id").notNull(),
    section: text("section"),
    conversationId: text("conversation_id"),
    reason: text("reason").notNull(),
    detail: text("detail"),
    source: text("source"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_admin_flag_created").on(t.createdAt),
    index("idx_admin_flag_user").on(t.userId),
    index("idx_admin_flag_type").on(t.type),
  ]
);

/**
 * Holidays / school events pulled from EduSecure CurrentSchoolCalendar.aspx.
 * `selected` lets the student pin which ones to highlight on their calendar.
 */
const schoolCalendarEvents = sqliteTable(
  "school_calendar_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceId: text("source_id"),
    title: text("title").notNull(),
    type: text("type").notNull().default("Event"),
    date: text("date").notNull(),
    dateRaw: text("date_raw"),
    monthLabel: text("month_label"),
    url: text("url"),
    selected: integer("selected").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_school_cal_user").on(table.userId),
    index("idx_school_cal_user_date").on(table.userId, table.date),
  ]
);

module.exports = {
  users,
  edusecureSessions,
  appSessions,
  homework,
  homeworkUserState,
  classworkUploads,
  classworkAttachments,
  sectionRequests,
  notifications,
  conversations,
  conversationParticipants,
  messages,
  messageAttachments,
  messageReadReceipts,
  moderationStrikes,
  adminFlagLog,
  schoolCalendarEvents,
};
