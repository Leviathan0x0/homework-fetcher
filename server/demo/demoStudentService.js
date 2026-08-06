const crypto = require("crypto");
const { and, eq } = require("drizzle-orm");
const { db, schema } = require("../db/client");
const homeworkCacheService = require("../homework/homeworkCacheService");
const calendarCacheService = require("../calendar/calendarCacheService");
const { ensureSectionConversation } = require("../messaging/sectionConversation");

const DEMO_STUDENT_ID = (process.env.DEMO_STUDENT_ID || "demo_student").trim();
const DEMO_STUDENT_PASSWORD = (
  process.env.DEMO_STUDENT_PASSWORD || "DemoStudent#2026"
).trim();
const DEMO_SECTION = "Demo 9-C";

function matchesSecret(given, expected) {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(String(expected || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isDemoStudentLogin(studentId, password) {
  return (
    String(studentId || "").trim().toLowerCase() === DEMO_STUDENT_ID.toLowerCase() &&
    matchesSecret(password, DEMO_STUDENT_PASSWORD)
  );
}

function isDemoStudentUser(user) {
  return (
    String(user?.studentId || "").trim().toLowerCase() === DEMO_STUDENT_ID.toLowerCase()
  );
}

function isDemoStudentId(studentId) {
  const normalized = String(studentId || "").trim().toLowerCase();
  return normalized === DEMO_STUDENT_ID.toLowerCase() || normalized.startsWith("demo_");
}

function isDemoScopedUser(user) {
  return (
    isDemoStudentUser(user) ||
    String(user?.id || "").startsWith("demo-") ||
    isDemoStudentId(user?.studentId)
  );
}

function getDemoStudentCredentials() {
  return {
    studentId: DEMO_STUDENT_ID,
    password: DEMO_STUDENT_PASSWORD,
  };
}

function localDate(offsetDays = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date;
}

function formatDayFirstDate(offsetDays = 0) {
  const date = localDate(offsetDays);
  return [
    String(date.getDate()).padStart(2, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    date.getFullYear(),
  ].join("/");
}

function formatIsoDate(offsetDays = 0) {
  const date = localDate(offsetDays);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

async function ensureDemoUser() {
  const now = new Date().toISOString();
  let user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.studentId, DEMO_STUDENT_ID))
    .get();

  if (user) {
    if (user.id !== "demo-student-account") {
      throw new Error(`Reserved demo student ID is already used by account ${user.id}.`);
    }
    await db
      .update(schema.users)
      .set({
        displayName: "Aarav Sharma",
        section: DEMO_SECTION,
        role: "student",
        updatedAt: now,
      })
      .where(eq(schema.users.id, user.id))
      .run();
  } else {
    await db
      .insert(schema.users)
      .values({
        id: "demo-student-account",
        studentId: DEMO_STUDENT_ID,
        displayName: "Aarav Sharma",
        section: DEMO_SECTION,
        role: "student",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.studentId, DEMO_STUDENT_ID))
    .get();
  return user;
}

function buildDemoHomework() {
  return [
    {
      type: "Homework",
      date: formatDayFirstDate(0),
      subject: "Mathematics",
      homework: "Complete the practice questions on fractions from page 84.",
      attachment: null,
    },
    {
      type: "Homework",
      date: formatDayFirstDate(0),
      subject: "Science",
      homework: "Read the lesson on states of matter and write five examples in your notebook.",
      attachment: null,
    },
    {
      type: "School Diary",
      date: formatDayFirstDate(0),
      subject: "School Diary",
      homework: "Bring your science notebook and coloured pencils tomorrow.",
      attachment: null,
    },
    {
      type: "Homework",
      date: formatDayFirstDate(-1),
      subject: "English",
      homework: "Write a short paragraph about a memorable school day.",
      attachment: null,
    },
    {
      type: "Homework",
      date: formatDayFirstDate(-2),
      subject: "Social Science",
      homework: "Revise the map-work notes from class and label the five rivers.",
      attachment: null,
    },
    {
      type: "Homework",
      date: formatDayFirstDate(-5),
      subject: "Hindi",
      homework: "Read the poem from the current chapter and note three new words.",
      attachment: null,
    },
    {
      type: "Homework",
      date: formatDayFirstDate(-8),
      subject: "Computers",
      homework: "Complete the keyboard-shortcuts activity in your computer notebook.",
      attachment: null,
    },
  ];
}

async function getDemoHomework(userId, { force = false } = {}) {
  const existing = await homeworkCacheService.getCachedHomework(userId);
  const today = formatDayFirstDate(0);
  const hasToday = existing.some((item) => item.date === today);
  if (!force && existing.length > 0 && hasToday) return existing;
  return homeworkCacheService.upsertHomework(userId, buildDemoHomework());
}

function buildDemoCalendar() {
  return [
    { title: "School assembly", type: "School event", date: formatIsoDate(1), dateRaw: formatIsoDate(1), monthLabel: "This month" },
    { title: "Mathematics activity", type: "Academic", date: formatIsoDate(3), dateRaw: formatIsoDate(3), monthLabel: "This month" },
    { title: "Parent-teacher meeting", type: "Meeting", date: formatIsoDate(7), dateRaw: formatIsoDate(7), monthLabel: "This month" },
    { title: "Independence Day celebration", type: "Holiday", date: formatIsoDate(10), dateRaw: formatIsoDate(10), monthLabel: "This month" },
    { title: "Science project submission", type: "Academic", date: formatIsoDate(14), dateRaw: formatIsoDate(14), monthLabel: "This month" },
    { title: "Mid-term revision week", type: "Academic", date: formatIsoDate(21), dateRaw: formatIsoDate(21), monthLabel: "Next month" },
    { title: "Teacher training day", type: "School event", date: formatIsoDate(28), dateRaw: formatIsoDate(28), monthLabel: "Next month" },
    { title: "Inter-house quiz", type: "Activity", date: formatIsoDate(35), dateRaw: formatIsoDate(35), monthLabel: "Next month" },
    { title: "Autumn break", type: "Holiday", date: formatIsoDate(42), dateRaw: formatIsoDate(42), monthLabel: "Next month" },
    { title: "Library reading week", type: "Activity", date: formatIsoDate(49), dateRaw: formatIsoDate(49), monthLabel: "Next month" },
  ];
}

async function getDemoCalendar(userId, { force = false } = {}) {
  const existing = await calendarCacheService.getCachedEvents(userId);
  if (!force && existing.length > 0) return existing;
  await calendarCacheService.upsertEvents(userId, buildDemoCalendar());
  return calendarCacheService.getCachedEvents(userId);
}

async function upsertDemoContact(contact) {
  const now = new Date().toISOString();
  let user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.studentId, contact.studentId))
    .get();

  if (user) {
    if (user.id !== contact.id) {
      throw new Error(`Reserved demo contact ID is already used by account ${user.id}.`);
    }
    await db
      .update(schema.users)
      .set({
        displayName: contact.displayName,
        section: DEMO_SECTION,
        role: contact.role || "student",
        updatedAt: now,
      })
      .where(eq(schema.users.id, user.id))
      .run();
  } else {
    await db
      .insert(schema.users)
      .values({
        id: contact.id,
        studentId: contact.studentId,
        displayName: contact.displayName,
        section: DEMO_SECTION,
        role: contact.role || "student",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  return db
    .select()
    .from(schema.users)
    .where(eq(schema.users.studentId, contact.studentId))
    .get();
}

async function ensureConversationParticipant(conversationId, userId) {
  const existing = await db
    .select()
    .from(schema.conversationParticipants)
    .where(
      and(
        eq(schema.conversationParticipants.conversationId, conversationId),
        eq(schema.conversationParticipants.userId, userId)
      )
    )
    .get();
  if (existing) return;

  await db.insert(schema.conversationParticipants).values({
    id: crypto.randomUUID(),
    conversationId,
    userId,
    createdAt: new Date().toISOString(),
  }).run();
}

async function ensureDemoMessages(demoUser) {
  const contacts = {
    david: await upsertDemoContact({
      id: "demo-david-account",
      studentId: "demo_david",
      displayName: "David Malhotra",
    }),
    riya: await upsertDemoContact({
      id: "demo-riya-account",
      studentId: "demo_riya",
      displayName: "Riya Kapoor",
    }),
    teacher: await upsertDemoContact({
      id: "demo-teacher-account",
      studentId: "demo_teacher",
      displayName: "Ms. Simran Kaur",
      role: "teacher",
    }),
  };

  const sectionConversation = await ensureSectionConversation(demoUser, { force: true });
  if (sectionConversation?.conversationId) {
    const groupMessages = [
      {
        id: "demo-group-message-1",
        senderId: contacts.teacher.id,
        content: "Good morning everyone! Please bring your science notebook tomorrow.",
        createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
      {
        id: "demo-group-message-2",
        senderId: contacts.david.id,
        content: "I finished the maths practice. Did anyone understand question five?",
        createdAt: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
      },
      {
        id: "demo-group-message-3",
        senderId: contacts.riya.id,
        content: "Yes, I can explain it after assembly. Please bring your notebook.",
        createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      },
    ];

    for (const message of groupMessages) {
      const existing = await db
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(eq(schema.messages.id, message.id))
        .get();
      if (!existing) {
        await db.insert(schema.messages).values({
          ...message,
          conversationId: sectionConversation.conversationId,
        }).run();
      }
    }
    await db
      .update(schema.conversations)
      .set({
        lastMessagePreview: groupMessages[groupMessages.length - 1].content,
        lastMessageAt: groupMessages[groupMessages.length - 1].createdAt,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.conversations.id, sectionConversation.conversationId))
      .run();
  }

  const directThreads = [
    {
      key: "david",
      contact: contacts.david,
      messages: [
        { suffix: "1", senderId: contacts.david.id, content: "Hi Aarav, did you finish the maths worksheet?" },
        { suffix: "2", senderId: demoUser.id, content: "Almost! I am checking question five before I submit it." },
      ],
    },
    {
      key: "riya",
      contact: contacts.riya,
      messages: [
        { suffix: "1", senderId: contacts.riya.id, content: "Reminder: bring your colour sheet for art class." },
        { suffix: "2", senderId: demoUser.id, content: "Thanks Riya, I packed it in my folder." },
      ],
    },
  ];

  for (const thread of directThreads) {
    const conversationId = `demo-dm-${thread.key}`;
    const existingConversation = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId))
      .get();
    const now = new Date().toISOString();
    if (!existingConversation) {
      await db.insert(schema.conversations).values({
        id: conversationId,
        type: "dm",
        createdAt: now,
        updatedAt: now,
      }).run();
    }
    await ensureConversationParticipant(conversationId, demoUser.id);
    await ensureConversationParticipant(conversationId, thread.contact.id);

    for (const [index, message] of thread.messages.entries()) {
      const messageId = `demo-${thread.key}-message-${message.suffix}`;
      const exists = await db
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(eq(schema.messages.id, messageId))
        .get();
      if (!exists) {
        await db.insert(schema.messages).values({
          id: messageId,
          conversationId,
          senderId: message.senderId,
          content: message.content,
          createdAt: new Date(Date.now() - (thread.messages.length - index) * 8 * 60 * 1000).toISOString(),
        }).run();
      }
    }

    const lastMessage = thread.messages[thread.messages.length - 1];
    await db
      .update(schema.conversations)
      .set({
        lastMessagePreview: lastMessage.content,
        lastMessageAt: new Date().toISOString(),
        updatedAt: now,
      })
      .where(eq(schema.conversations.id, conversationId))
      .run();
  }
}

async function ensureDemoStudentData() {
  const user = await ensureDemoUser();
  await getDemoHomework(user.id);
  await getDemoCalendar(user.id);
  await ensureDemoMessages(user);
  return user;
}

module.exports = {
  getDemoStudentCredentials,
  isDemoStudentLogin,
  isDemoStudentId,
  isDemoScopedUser,
  isDemoStudentUser,
  ensureDemoStudentData,
  getDemoHomework,
  getDemoCalendar,
};
