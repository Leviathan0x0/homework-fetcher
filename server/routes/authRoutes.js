const express = require("express");
const multer = require("multer");
const sessionService = require("../auth/sessionService");
const { fetchProfileFromEduSecure, isUnknownSection, isAdminAccount } = require("../auth/sessionService");
const { loginToEduSecure } = require("../edusecure/edusecureAuth");
const { fetchHomeworkForSession } = require("../edusecure/homeworkService");
const { sessionCookieOptions } = require("../config");
const { getRequestSession, getRequestToken, requireAuth } = require("../auth/requireAuth");
const { rateLimit } = require("../limits");
const { db, schema } = require("../db/client");
const { eq } = require("drizzle-orm");
const { resolveUploadType, matchesMagicBytes } = require("../files/fileTypes");
const { moderateImage } = require("../moderation/openaiModeration");
const homeworkCacheService = require("../homework/homeworkCacheService");
const { ensureSectionConversation } = require("../messaging/sectionConversation");
const {
  matchTestTeacherLogin,
  TEST_TEACHER_MATCH,
  testTeacherUser,
  profileFromEnvironment,
  ensureTeacherProfile,
  saveTeacherProfile,
  normalizeTeacherProfile,
} = require("../teacher/teacherService");

const router = express.Router();
const PROFILE_PICTURE_MAX_BYTES = 2 * 1024 * 1024;
const profilePictureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PROFILE_PICTURE_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const resolved = resolveUploadType(file.originalname);
    if (!resolved?.contentType?.startsWith("image/")) {
      return cb(new Error("Only JPG, PNG, and WebP profile pictures are allowed."));
    }
    return cb(null, true);
  },
});

async function profilePictureUrlFor(userId) {
  if (!userId) return null;
  const picture = await db
    .select({
      userId: schema.profilePictures.userId,
      updatedAt: schema.profilePictures.updatedAt,
    })
    .from(schema.profilePictures)
    .where(eq(schema.profilePictures.userId, userId))
    .get();
  return picture
    ? `/api/auth/profile/picture/${encodeURIComponent(userId)}?v=${encodeURIComponent(picture.updatedAt)}`
    : null;
}

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
          profilePictureUrl: await profilePictureUrlFor(user.id),
          isAdmin: true,
          role: "admin",
        }
      });
    }

    const testTeacherMatch = matchTestTeacherLogin(cleanStudentId, password);

    // The demo account owns its username, so answer for it here instead of
    // letting the request fall through to EduSecure, which would reject the
    // unknown ID and blame the student's credentials for a server setting.
    if (testTeacherMatch === TEST_TEACHER_MATCH.DISABLED) {
      return res.status(503).json({
        authenticated: false,
        error:
          "The demo teacher account is not enabled on this deployment. " +
          "An administrator needs to configure a password for it before it can be used.",
      });
    }

    if (testTeacherMatch === TEST_TEACHER_MATCH.BAD_PASSWORD) {
      return res.status(401).json({
        authenticated: false,
        error: "Invalid account ID or password.",
      });
    }

    if (testTeacherMatch === TEST_TEACHER_MATCH.OK) {
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
          profilePictureUrl: await profilePictureUrlFor(user.id),
          isTeacher: true,
          role: "teacher",
          teacherProfile: normalizeTeacherProfile(profile),
          testAccount: true,
        },
      });
    }

    let sessionCookies;
    try {
      const authResult = await loginToEduSecure(cleanStudentId, password);
      if (typeof authResult === "string") {
        sessionCookies = authResult;
      } else {
        sessionCookies = authResult.sessionCookies;
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
            ? "The school portal (EduSecure) is slow or unreachable right now. Wait a moment and try again - login needs a live connection to edusecure.in."
            : authErr.message || "The school portal is currently unreachable. Please try again later.",
      });
    }

    const user = await sessionService.findOrCreateUser(cleanStudentId);

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

    // Fetch and cache initial homework in the background — this no longer
    // blocks the login response now that the Announcement.aspx verification
    // round-trip has been removed from loginToEduSecure.
    fetchHomeworkForSession(sessionCookies)
      .then((data) => homeworkCacheService.upsertHomework(user.id, data.homework))
      .catch((err) => {
        console.error("Failed to prefetch homework cache after login:", err.message);
      });

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
      const configuredTeacherIds = String(process.env.EDUSECURE_TEACHER_IDS || "")
        .split(",")
        .map((id) => id.trim().toLowerCase())
        .filter(Boolean);
      const isVerifiedTeacher =
        profile.role === "teacher" ||
        configuredTeacherIds.includes(cleanStudentId.toLowerCase());
      if (isVerifiedTeacher) {
        role = "teacher";
        // Batch the profile update and teacher role DB write in parallel.
        [, teacherProfile] = await Promise.all([
          Promise.all([
            sessionService.updateProfileFields(user.id, {
              section: profile.section,
              displayName: profile.displayName,
            }),
            db
              .update(schema.users)
              .set({ role: "teacher", updatedAt: new Date().toISOString() })
              .where(eq(schema.users.id, user.id)),
          ]),
          ensureTeacherProfile(user.id, {
            subjects: profile.subjects,
            assignedSections: profile.assignedSections.length ? profile.assignedSections : section ? [section] : [],
            classTeacherSections: profile.classTeacherSections,
          }),
        ]);
      } else {
        await sessionService.updateProfileFields(user.id, {
          section: profile.section,
          displayName: profile.displayName,
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
        profilePictureUrl: await profilePictureUrlFor(user.id),
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
  const startedAt = Date.now();
  const activeSession = await getRequestSession(req);

  if (!activeSession) {
    res.setHeader("Server-Timing", `session;dur=${Date.now() - startedAt}`);
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
  // A missing name or section is optional profile data, not an authentication
  // requirement. Repair it in the background so session validation stays fast,
  // while the client can retry this endpoint until the name is available.
  if (!isAdmin && !isTeacher && (isUnknownSection(section) || !displayName)) {
    void (async () => {
      try {
        const eduSession = await sessionService.getEduSecureSession(activeSession.user.id);
        if (!eduSession) return;
        const profile = await fetchProfileFromEduSecure(eduSession.sessionCookies);
        const resolvedName = profile.displayName && !displayName ? profile.displayName : null;
        await sessionService.updateProfileFields(activeSession.user.id, {
          section: profile.section,
          displayName: resolvedName,
        });
        if (profile.section) {
          await joinClassGroupInBackground(
            { id: activeSession.user.id, section: profile.section },
            { force: true }
          );
        }
      } catch (err) {
        console.error("Background profile refresh failed:", err.message);
      }
    })();
  }

  if (!isAdmin && !isTeacher && !isUnknownSection(section)) {
    joinClassGroupInBackground({ id: activeSession.user.id, section });
  }

  res.setHeader("Server-Timing", `session;dur=${Date.now() - startedAt}`);
  return res.json({
    authenticated: true,
    user: {
      id: activeSession.user.id,
      studentId: activeSession.user.studentId,
      displayName: displayName || (isAdmin ? "Administrator" : null),
      section: isUnknownSection(section) ? (isAdmin ? "Admin" : null) : section,
      profilePictureUrl: await profilePictureUrlFor(activeSession.user.id),
      isAdmin,
      isTeacher,
      role: activeSession.user.role || (isAdmin ? "admin" : "student"),
      teacherProfile: null,
    }
  });
});

router.post(
  "/profile/picture",
  rateLimit({ name: "profile-picture", windowMs: 60 * 1000, max: 6 }),
  async (req, res) => {
  const activeSession = await getRequestSession(req);
  if (!activeSession) return res.status(401).json({ error: "Not authenticated." });

  profilePictureUpload.single("picture")(req, res, async (uploadError) => {
    if (uploadError) {
      return res.status(400).json({
        error: uploadError.code === "LIMIT_FILE_SIZE"
          ? "That profile picture is too large. Please choose an image under 2 MB."
          : uploadError.message || "Please select a JPG, PNG, or WebP image.",
      });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ error: "Please select a profile picture." });
    }

    const resolved = resolveUploadType(req.file.originalname);
    if (!resolved || !matchesMagicBytes(req.file.buffer.subarray(0, 16), resolved.contentType)) {
      return res.status(400).json({ error: "That file is not a valid JPG, PNG, or WebP image." });
    }

    const moderation = await moderateImage({
      buffer: req.file.buffer,
      mimeType: resolved.contentType,
      text: "Student profile picture",
    });
    if (!moderation.ok) {
      return res.status(422).json({
        error: moderation.reason || "That image could not be approved for a school profile.",
      });
    }

    try {
      const updatedAt = new Date().toISOString();
      await db.delete(schema.profilePictures)
        .where(eq(schema.profilePictures.userId, activeSession.user.id))
        .run();
      await db.insert(schema.profilePictures).values({
        userId: activeSession.user.id,
        data: req.file.buffer.toString("base64"),
        mimeType: resolved.contentType,
        updatedAt,
      }).run();
      return res.json({
        success: true,
        profilePictureUrl: await profilePictureUrlFor(activeSession.user.id),
      });
    } catch (err) {
      console.error("Save profile picture error:", err);
      return res.status(500).json({ error: "Could not save your profile picture." });
    }
  });
  }
);

router.get("/profile/picture/:userId", async (req, res) => {
  const activeSession = await getRequestSession(req);
  if (!activeSession) return res.status(401).json({ error: "Not authenticated." });

  const picture = await db
    .select()
    .from(schema.profilePictures)
    .where(eq(schema.profilePictures.userId, req.params.userId))
    .get();
  if (!picture) return res.status(404).json({ error: "Profile picture not found." });

  const buffer = Buffer.from(picture.data, "base64");
  if (!matchesMagicBytes(buffer.subarray(0, 16), picture.mimeType)) {
    return res.status(404).json({ error: "Profile picture is unavailable." });
  }
  res.setHeader("Content-Type", picture.mimeType);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  return res.send(buffer);
});

router.delete("/profile/picture", async (req, res) => {
  const activeSession = await getRequestSession(req);
  if (!activeSession) return res.status(401).json({ error: "Not authenticated." });
  await db.delete(schema.profilePictures)
    .where(eq(schema.profilePictures.userId, activeSession.user.id))
    .run();
  return res.json({ success: true, profilePictureUrl: null });
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
      profilePictureUrl: await profilePictureUrlFor(activeSession.user.id),
    },
  });
});

// POST /api/auth/reconnect
// Re-establishes the EduSecure session without signing the student out.
//
// The school portal ends its own session within minutes, while the app session
// lasts 30 days, so the normal case is being perfectly signed in here while the
// scraper has nothing valid to talk to the school with. The password is
// deliberately never stored, so the only way back is to ask for it again - but
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

    // Accounts that never sign in through EduSecure have no school session to
    // renew, so say that rather than bouncing their password off the portal.
    if (isAdminAccount(req.user)) {
      return res.status(400).json({
        error: "The administrator account does not use the school portal.",
      });
    }

    let sessionCookies;
    try {
      const authResult = await loginToEduSecure(studentId, password);
      if (typeof authResult === "string") {
        sessionCookies = authResult;
      } else {
        sessionCookies = authResult.sessionCookies;
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

    // Warm the homework cache in the background after reconnect (same pattern
    // as the login route — Announcement.aspx is no longer fetched inline).
    fetchHomeworkForSession(sessionCookies)
      .then((data) => homeworkCacheService.upsertHomework(req.user.id, data.homework))
      .catch((err) => {
        console.error("Failed to upsert homework cache after reconnect:", err.message);
      });

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
