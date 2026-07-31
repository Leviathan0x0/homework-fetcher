const crypto = require("crypto");
const { eq } = require("drizzle-orm");
const { db, schema } = require("../db/client");

function parseList(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).map((v) => v.trim()).filter(Boolean) : [];
  } catch {
    return String(value).split(",").map((v) => v.trim()).filter(Boolean);
  }
}

function envList(name, fallback = []) {
  return parseList(process.env[name] || JSON.stringify(fallback));
}

function isTeacher(user) {
  return user?.role === "teacher" || user?.role === "class_teacher";
}

async function getTeacherProfile(userId) {
  const row = await db
    .select()
    .from(schema.teacherProfiles)
    .where(eq(schema.teacherProfiles.userId, userId))
    .get();

  if (!row) return null;
  return {
    userId: row.userId,
    subjects: parseList(row.subjects),
    assignedSections: parseList(row.assignedSections),
    classTeacherSections: parseList(row.classTeacherSections),
    updatedAt: row.updatedAt,
  };
}

async function saveTeacherProfile(userId, profile = {}) {
  const now = new Date().toISOString();
  const values = {
    userId,
    subjects: JSON.stringify(profile.subjects || []),
    assignedSections: JSON.stringify(profile.assignedSections || []),
    classTeacherSections: JSON.stringify(profile.classTeacherSections || []),
    updatedAt: now,
  };
  const existing = await getTeacherProfile(userId);
  if (existing) {
    await db
      .update(schema.teacherProfiles)
      .set(values)
      .where(eq(schema.teacherProfiles.userId, userId))
      .run();
  } else {
    await db.insert(schema.teacherProfiles).values(values).run();
  }
  return { ...profile, userId, updatedAt: now };
}

function profileFromEnvironment() {
  return {
    subjects: envList("TEACHER_TEST_SUBJECTS", ["Mathematics", "Science"]),
    assignedSections: envList("TEACHER_TEST_SECTIONS", ["9-C"]),
    classTeacherSections: envList("TEACHER_TEST_CLASS_TEACHER_SECTIONS", ["9-C"]),
  };
}

async function ensureTeacherProfile(userId, profile = {}) {
  const existing = await getTeacherProfile(userId);
  if (existing) return existing;
  return saveTeacherProfile(userId, {
    subjects: profile.subjects || [],
    assignedSections: profile.assignedSections || [],
    classTeacherSections: profile.classTeacherSections || [],
  });
}

function normalizeTeacherProfile(profile) {
  return {
    subjects: Array.from(new Set(profile?.subjects || [])),
    assignedSections: Array.from(new Set(profile?.assignedSections || [])),
    classTeacherSections: Array.from(new Set(profile?.classTeacherSections || [])),
  };
}

function isTestTeacherLogin(studentId, password) {
  if (process.env.NODE_ENV === "production") return false;
  const username = (process.env.TEACHER_TEST_USERNAME || "teacher_test").trim();
  const pass = process.env.TEACHER_TEST_PASSWORD || "Teacher#MMSS2026";
  return Boolean(studentId && password && studentId.trim().toLowerCase() === username.toLowerCase() && password === pass);
}

function testTeacherUser() {
  const username = (process.env.TEACHER_TEST_USERNAME || "teacher_test").trim();
  return {
    id: `test-teacher-${crypto.createHash("sha256").update(username).digest("hex").slice(0, 16)}`,
    studentId: username,
    displayName: process.env.TEACHER_TEST_NAME || "Test Teacher",
    section: "Staff",
    role: "teacher",
  };
}

async function assertSectionAccess(userId, section) {
  const profile = await getTeacherProfile(userId);
  return Boolean(profile?.assignedSections.includes(section));
}

async function assertClassTeacherAccess(userId, section) {
  const profile = await getTeacherProfile(userId);
  return Boolean(profile?.classTeacherSections.includes(section));
}

module.exports = {
  isTeacher,
  getTeacherProfile,
  saveTeacherProfile,
  ensureTeacherProfile,
  normalizeTeacherProfile,
  isTestTeacherLogin,
  testTeacherUser,
  profileFromEnvironment,
  assertSectionAccess,
  assertClassTeacherAccess,
};
