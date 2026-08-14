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

/**
 * Password used by the shared demo teacher account when none is configured.
 * It is published in this repository, so it is only ever accepted outside
 * production.
 */
const DEFAULT_TEST_TEACHER_PASSWORD = "Teacher#MMSS2026";

/** Constant-time comparison so a wrong password cannot be probed byte by byte. */
function matchesSecret(given, expected) {
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Credentials for the demo teacher account.
 *
 * The account works in production, but only once the deployment has chosen its
 * own password: a live install serves real rosters, attendance and teacher
 * notes about named students, so the password committed to this repository
 * must not be enough to reach any of it.
 *
 * @returns {{username: string, password: string|null, enabled: boolean}}
 */
function testTeacherCredentials() {
  const username = (process.env.TEACHER_TEST_USERNAME || "teacher_test").trim();
  const configured = (process.env.TEACHER_TEST_PASSWORD || "").trim();

  if (configured) return { username, password: configured, enabled: true };
  if (process.env.NODE_ENV === "production") return { username, password: null, enabled: false };
  return { username, password: DEFAULT_TEST_TEACHER_PASSWORD, enabled: true };
}

/**
 * True when the configured password is wrapped in matching quotes.
 *
 * Hosting dashboards store the field exactly as typed, so pasting "hunter2"
 * with the quotes makes them part of the password and every sign-in fails
 * while the variable still looks correctly set. The value is never rewritten;
 * a password may legitimately contain quotes, but it is worth saying out loud.
 */
function passwordLooksQuoted() {
  const configured = (process.env.TEACHER_TEST_PASSWORD || "").trim();
  return configured.length >= 2 && /^(['"]).*\1$/s.test(configured);
}

/**
 * Configuration facts about the demo account, with no secret in them.
 *
 * Exposed through /api/health because the alternative is guessing: a login
 * that fails looks identical whether the password variable never reached the
 * runtime, the username was overridden, or the value was pasted with quotes.
 */
function testTeacherDiagnostics() {
  return {
    enabled: testTeacherCredentials().enabled,
    usernameOverridden: Boolean((process.env.TEACHER_TEST_USERNAME || "").trim()),
    passwordLooksQuoted: passwordLooksQuoted(),
  };
}

let warnedAboutMissingTestPassword = false;
let warnedAboutQuotedTestPassword = false;

/**
 * Outcomes of checking credentials against the demo teacher account.
 *
 * "disabled" is deliberately distinct from "no match": collapsing them into a
 * single false sent the request on to EduSecure, which rejected the unknown ID
 * and reported a missing TEACHER_TEST_PASSWORD as "invalid student ID or
 * password", an answer that points at the wrong problem entirely.
 */
const TEST_TEACHER_MATCH = {
  NO_MATCH: "no_match",
  DISABLED: "disabled",
  BAD_PASSWORD: "bad_password",
  OK: "ok",
};

/** Whether the demo teacher account can be signed into on this deployment. */
function isTestTeacherEnabled() {
  return testTeacherCredentials().enabled;
}

/**
 * Matches credentials against the demo teacher account.
 *
 * The configured username is reserved for this account, so once it matches the
 * result is authoritative and the school portal is never consulted. The demo
 * account exists precisely so a teacher view can be opened without EduSecure.
 *
 * @returns {"no_match"|"disabled"|"bad_password"|"ok"}
 */
function matchTestTeacherLogin(studentId, password) {
  if (!studentId || !password) return TEST_TEACHER_MATCH.NO_MATCH;

  const { username, password: expected, enabled } = testTeacherCredentials();
  if (studentId.trim().toLowerCase() !== username.toLowerCase()) {
    return TEST_TEACHER_MATCH.NO_MATCH;
  }

  if (!enabled) {
    // Logged once per instance, and only when someone actually tries, so the
    // reason for the rejection is visible without spamming every cold start.
    if (!warnedAboutMissingTestPassword) {
      warnedAboutMissingTestPassword = true;
      console.error(
        `[auth] Rejected "${username}" because TEACHER_TEST_PASSWORD is not set. ` +
          "Set it in the deployment environment to enable the demo teacher account here; " +
          "the default password is published in the repository and is never accepted in production."
      );
    }
    return TEST_TEACHER_MATCH.DISABLED;
  }

  if (matchesSecret(password, expected)) return TEST_TEACHER_MATCH.OK;

  if (passwordLooksQuoted() && !warnedAboutQuotedTestPassword) {
    warnedAboutQuotedTestPassword = true;
    console.error(
      "[auth] TEACHER_TEST_PASSWORD is wrapped in quotes, so the quotes are part of the " +
        "password. Re-enter it in the deployment environment without them."
    );
  }

  return TEST_TEACHER_MATCH.BAD_PASSWORD;
}

function isTestTeacherLogin(studentId, password) {
  return matchTestTeacherLogin(studentId, password) === TEST_TEACHER_MATCH.OK;
}

function testTeacherUser() {
  const { username } = testTeacherCredentials();
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
  isTestTeacherEnabled,
  testTeacherDiagnostics,
  matchTestTeacherLogin,
  TEST_TEACHER_MATCH,
  testTeacherUser,
  profileFromEnvironment,
  assertSectionAccess,
  assertClassTeacherAccess,
};
