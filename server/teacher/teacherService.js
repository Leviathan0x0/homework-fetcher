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
  assertSectionAccess,
  assertClassTeacherAccess,
};
