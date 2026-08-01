const express = require("express");
const sessionService = require("../auth/sessionService");
const { fetchProfileFromEduSecure, isUnknownSection } = require("../auth/sessionService");
const { loginToEduSecure } = require("../edusecure/edusecureAuth");
const { sessionCookieOptions } = require("../config");
const { getRequestSession, getRequestToken, requireAuth } = require("../auth/requireAuth");
const { rateLimit } = require("../limits");
const { db, schema } = require("../db/client");
const { eq } = require("drizzle-orm");
const homeworkCacheService = require("../homework/homeworkCacheService");
const { ensureSectionConversation } = require("../messaging/sectionConversation");
const {
  isTestTeacherLogin,
  testTeacherUser,
  profileFromEnvironment,
  ensureTeacherProfile,
  saveTeacherProfile,
  normalizeTeacherProfile,
} = require("../teacher/teacherService");

const router = express.Router();

async function joinClassGroupInBackground(user, { force = false } = {}) {
  if (!user?.id || isUnknownSection(user.section)) return;
  try {
    await ensureSectionConversation(user, { force });
  } catch (err) {
    console.error("Auto-join class group failed:", err.message);
  }
}

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { studentId, password } = req.body || {};

    const cleanStudentId = (studentId || "").trim().replace(/@manavmangalschool\.com/gi, "");

    if (!cleanStudentId) {
      return res.status(400).json({
        authenticated: false,
        error: "Student ID is required."
      });
    }

    if (!password || typeof password !== "string" || !password.trim()) {
      return res.status(400).json({
        authenticated: false,
        error: "Password is required."
      });
    }

    const ADMIN_ID = process.env.ADMIN_USERNAME || "admin_mmss";
    const ADMIN_PASS = process.env.ADMIN_PASSWORD || "Admin#MMSS2026";
    const isAdminLogin =
      cleanStudentId.toLowerCase() === ADMIN_ID.toLowerCase() ||
      cleanStudentId.toLowerCase() === "admin";

    if (isAdminLogin) {
      if (password !== ADMIN_PASS) {
        return res.status(401).json({
          authenticated: false,
          error: "Invalid account ID or password."
        });
      }

      const user = await sessionService.findOrCreateUser(ADMIN_ID);
      await db
        .update(schema.users)
        .set({
          role: "admin",
          section: "Admin",
          displayName: user.displayName || "Administrator",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.users.id, user.id));

      const appToken = await sessionService.createAppSession(user.id);

      res.cookie("app_session", appToken, sessionCookieOptions({
        maxAge: sessionService.SESSION_TTL_MS
      }));

      return res.json({
        authenticated: true,
        token: appToken,
        user: {
          id: user.id,
          studentId: user.studentId,
          displayName: user.displayName || "Administrator",
          section: "Admin",
          isAdmin: true,
          role: "admin",
        }
      });
    }

    if (isTestTeacherLogin(cleanStudentId, password)) {
      const testUser = testTeacherUser();
      const existing = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.studentId, testUser.studentId))
        .get();
      const user = existing || await sessionService.findOrCreateUser(testUser.studentId);
      await db
        .update(schema.users)
        .set({
          displayName: testUser.displayName,
          role: "teacher",
          section: "Staff",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.users.id, user.id));
      const profile = await ensureTeacherProfile(user.id, profileFromEnvironment());
      const appToken = await sessionService.createAppSession(user.id);
      res.cookie("app_session", appToken, sessionCookieOptions({
        maxAge: sessionService.SESSION_TTL_MS,
      }));
      return res.json({
        authenticated: true,
        token: appToken,
        user: {
          id: user.id,
          studentId: testUser.studentId,
          displayName: testUser.displayName,
          section: "Staff",
          isTeacher: true,
          role: "teacher",
          teacherProfile: normalizeTeacherProfile(profile),
          testAccount: true,
        },
      });
    }

    let sessionCookies;
    let initialHomework = [];
    try {
      const authResult = await loginToEduSecure(cleanStudentId, password);
      if (typeof authResult === "string") {
        sessionCookies = authResult;
      } else {
        sessionCookies = authResult.sessionCookies;
        initialHomework = authResult.initialHomework || [];
      }
    } catch (authErr) {
      console.error("EduSecure Auth Error:", authErr && authErr.message ? authErr.message : authErr);
      if (!authErr || authErr.code === "invalid_credentials") {
        return res.status(401).json({
          authenticated: false,
          error: "Invalid student ID or password."
        });
      }
      return res.status(502).json({
        authenticated: false,
        error:
          authErr.code === "portal_unreachable"
            ? "The school portal (EduSecure) is slow or unreachable right now. Wait a moment and try again — login needs a live connection to edusecure.in."
            : authErr.message || "The school portal is currently unreachable. Please try again later.",
      });
    }

    const user = await sessionService.findOrCreateUser(cleanStudentId);

    if (initialHomework && initialHomework.length > 0) {
      homeworkCacheService.upsertHomework(user.id, initialHomework).catch((err) => {
        console.error("Failed to upsert initial homework cache:", err.message);
      });
    }

    // Storing the school session, minting the app session and reading the
    // profile page are independent of each other. Awaiting them one by one
    // added a full school-portal page load plus several database round trips
    // to the time a student spends staring at the login button.
    const [, appToken, profileResult] = await Promise.all([
      sessionService.saveEduSecureSession(user.id, sessionCookies),
      sessionService.createAppSession(user.id, user),
      fetchProfileFromEduSecure(sessionCookies).catch((err) => {
        console.error("Profile fetch failed after login:", err.message);
        return null;
      }),
    ]);

    res.cookie("app_session", appToken, sessionCookieOptions({
      maxAge: sessionService.SESSION_TTL_MS
    }));

    let section = user.section;
    let displayName = user.displayName;
    let teacherProfile = null;
    let role = user.role || "student";
    try {
      const profile = profileResult || {
        section: null,
        displayName: null,
        role: null,
        subjects: [],
        assignedSections: [],
        classTeacherSections: [],
      };
      if (profile.section) section = profile.section;
      if (profile.displayName) displayName = profile.displayName;
      await sessionService.updateProfileFields(user.id, {
        section: profile.section,
        displayName: profile.displayName,
      });
      const configuredTeacherIds = String(process.env.EDUSECURE_TEACHER_IDS || "")
        .split(",")
        .map((id) => id.trim().toLowerCase())
        .filter(Boolean);
      const isVerifiedTeacher =
        profile.role === "teacher" ||
        configuredTeacherIds.includes(cleanStudentId.toLowerCase());
      if (isVerifiedTeacher) {
        role = "teacher";
        await db
          .update(schema.users)
          .set({ role: "teacher", updatedAt: new Date().toISOString() })
          .where(eq(schema.users.id, user.id));
        teacherProfile = await ensureTeacherProfile(user.id, {
          subjects: profile.subjects,
          assignedSections: profile.assignedSections.length ? profile.assignedSections : section ? [section] : [],
          classTeacherSections: profile.classTeacherSections,
        });
      }
      await joinClassGroupInBackground({ id: user.id, section }, { force: true });
    } catch (err) {
      console.error("Profile setup failed after login:", err.message);
      await joinClassGroupInBackground({ id: user.id, section }, { force: true });
    }

    return res.json({
      authenticated: true,
      token: appToken,
      user: {
        id: user.id,
        studentId: user.studentId,
        displayName: displayName || null,
        section: isUnknownSection(section) ? null : section,
        isAdmin: role === "admin" || user.studentId === "admin_mmss" || user.section === "Admin",
        isTeacher: role === "teacher" || role === "class_teacher",
        role,
        teacherProfile: teacherProfile ? normalizeTeacherProfile(teacherProfile) : null,
      }
    });

  } catch (err) {
    console.error("Auth Login Error:", err);
    const errorMsg = err.message || "An unexpected error occurred during login.";
    return res.status(500).json({
      authenticated: false,
      error: errorMsg
    });
  }
});

// GET /api/auth/me
router.get("/me", async (req, res) => {
  const activeSession = await getRequestSession(req);

  if (!activeSession) {
    return res.json({
      authenticated: false
    });
  }

  let section = activeSession.user.section;
  let displayName = activeSession.user.displayName;
  const isAdmin =
    activeSession.user.studentId === "admin_mmss" ||
    activeSession.user.role === "admin" ||
    activeSession.user.section === "Admin";
  const isTeacher =
    activeSession.user.role === "teacher" ||
    activeSession.user.role === "class_teacher";
  let teacherProfile = null;
  if (isTeacher) {
    try {
      const { getTeacherProfile, normalizeTeacherProfile } = require("../teacher/teacherService");
      teacherProfile = normalizeTeacherProfile(
        await getTeacherProfile(activeSession.user.id)
      );
    } catch (err) {
      console.error("Teacher profile refresh failed:", err.message);
    }
  }

  if (!isAdmin && isUnknownSection(section)) {
    try {
      const eduSession = await sessionService.getEduSecureSession(activeSession.user.id);
      if (eduSession) {
        const profile = await fetchProfileFromEduSecure(eduSession.sessionCookies);
        const resolvedName = profile.displayName && !displayName ? profile.displayName : null;
        await sessionService.updateProfileFields(activeSession.user.id, {
          section: profile.section,
          displayName: resolvedName,
        });
        if (profile.section) section = profile.section;
        if (resolvedName) displayName = resolvedName;
      }
    } catch (err) {
      console.error("Profile refresh failed:", err.message);
    }
  }

  if (!isAdmin) {
    joinClassGroupInBackground({ id: activeSession.user.id, section });
  }

  return res.json({
    authenticated: true,
    user: {
      id: activeSession.user.id,
      studentId: activeSession.user.studentId,
      displayName: displayName || (isAdmin ? "Administrator" : null),
      section: isUnknownSection(section) ? (isAdmin ? "Admin" : null) : section,
      isAdmin,
      isTeacher,
      role: activeSession.user.role || (isAdmin ? "admin" : "student"),
      teacherProfile,
    }
  });
});

// PATCH /api/auth/profile
// Lets a student choose the name other students see instead of their student ID.
router.patch("/profile", async (req, res) => {
  const activeSession = await getRequestSession(req);

  if (!activeSession) {
    return res.status(401).json({ error: "Not authenticated." });
  }

  const { displayName } = req.body || {};
  if (typeof displayName !== "string") {
    return res.status(400).json({ error: "A display name is required." });
  }

  const cleaned = displayName.trim().replace(/\s+/g, " ");
  if (cleaned.length < 2 || cleaned.length > 40) {
    return res.status(400).json({ error: "Your name must be between 2 and 40 characters." });
  }

  await sessionService.updateDisplayName(activeSession.user.id, cleaned);

  return res.json({
    success: true,
    user: {
      id: activeSession.user.id,
      studentId: activeSession.user.studentId,
      displayName: cleaned,
      section: isUnknownSection(activeSession.user.section) ? null : activeSession.user.section,
    },
  });
});

// POST /api/auth/reconnect
// Re-establishes the EduSecure session without signing the student out.
//
// The school portal ends its own session within minutes, while the app session
// lasts 30 days, so the normal case is being perfectly signed in here while the
// scraper has nothing valid to talk to the school with. The password is
// deliberately never stored, so the only way back is to ask for it again — but
// only the password, and without losing the app session, the cached homework or
// whatever screen the student was on.
router.post(
  "/reconnect",
  requireAuth,
  rateLimit({ name: "school-reconnect", windowMs: 60 * 1000, max: 8 }),
  async (req, res) => {
    const { password } = req.body || {};

    if (!password || typeof password !== "string" || !password.trim()) {
      return res.status(400).json({ error: "Please enter your school password." });
    }

    const studentId = (req.user.studentId || "").trim();
    const role = req.user.role || "student";

    // Accounts that never sign in through EduSecure have no school session to
    // renew, so say that rather than bouncing their password off the portal.
    if (role === "admin" || studentId === "admin_mmss") {
      return res.status(400).json({
        error: "The administrator account does not use the school portal.",
      });
    }

    let sessionCookies;
    let initialHomework = [];
    try {
      const authResult = await loginToEduSecure(studentId, password);
      if (typeof authResult === "string") {
        sessionCookies = authResult;
      } else {
        sessionCookies = authResult.sessionCookies;
        initialHomework = authResult.initialHomework || [];
      }
    } catch (authErr) {
      console.error("Reconnect auth error:", authErr?.message || authErr);
      if (!authErr || authErr.code === "invalid_credentials") {
        return res.status(401).json({
          error: "That password was not accepted by the school portal. Check it and try again.",
        });
      }
      return res.status(502).json({
        error:
          authErr.code === "portal_unreachable"
            ? "The school portal (EduSecure) is slow or unreachable right now. Wait a moment and try again."
            : authErr.message || "The school portal is currently unreachable. Please try again later.",
      });
    }

    await sessionService.saveEduSecureSession(req.user.id, sessionCookies);

    if (initialHomework.length > 0) {
      homeworkCacheService.upsertHomework(req.user.id, initialHomework).catch((err) => {
        console.error("Failed to upsert homework cache after reconnect:", err.message);
      });
    }

    return res.json({ success: true, reconnected: true });
  }
);

// POST /api/auth/logout
router.post("/logout", async (req, res) => {
  const token = getRequestToken(req);

  if (token) {
    await sessionService.destroyAppSession(token);
  }

  res.clearCookie("app_session", sessionCookieOptions());

  return res.json({
    success: true,
    authenticated: false
  });
});

module.exports = router;
