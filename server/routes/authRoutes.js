const express = require("express");
const multer = require("multer");
const sessionService = require("../auth/sessionService");
const { fetchProfileFromEduSecure, isUnknownSection, isAdminAccount } = require("../auth/sessionService");
const { loginToEduSecure } = require("../edusecure/edusecureAuth");
const { fetchHomeworkForSession } = require("../edusecure/homeworkService");
const { sessionCookieOptions } = require("../config");
const { getRequestSession, getRequestToken, requireAuth } = require("../auth/requireAuth");
const {
  hashPassword,
  verifyPassword,
  validatePassword,
} = require("../auth/passwords");
const { recordSecurityEvent, EVENTS, OUTCOMES } = require("../auth/securityAudit");
const passwordResetService = require("../auth/passwordResetService");
const { rateLimit } = require("../limits");
const { db, schema } = require("../db/client");
const { eq } = require("drizzle-orm");
const { resolveUploadType, matchesMagicBytes } = require("../files/fileTypes");
const { moderateImage } = require("../moderation/openaiModeration");
const homeworkCacheService = require("../homework/homeworkCacheService");
const { checkContent } = require("../moderation/checkContent");
const { ensureSectionConversation } = require("../messaging/sectionConversation");
const {
  matchTestTeacherLogin,
  TEST_TEACHER_MATCH,
  testTeacherUser,
  profileFromEnvironment,
  ensureTeacherProfile,
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
    const ADMIN_PASS = process.env.ADMIN_PASSWORD || "";
    const isAdminLogin =
      cleanStudentId.toLowerCase() === ADMIN_ID.toLowerCase() ||
      cleanStudentId.toLowerCase() === "admin";

    if (isAdminLogin) {
      // No baked-in default password: an unset ADMIN_PASSWORD refuses admin login.
      if (!ADMIN_PASS || password !== ADMIN_PASS) {
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

    // --- MMSS64 password path ---
    //
    // A student who has set their own password signs in with it, and only with it.
    // The lookup happens without `findOrCreateUser`, so probing an unknown school
    // ID does not bring an account into existence for it.
    //
    // There is no fallback to the portal below. Once an account has a hash, the
    // portal is no longer an acceptable answer to "who is this", because the
    // school password and the MMSS64 password are now two different secrets: one
    // that has been shared with the school and one that has not. Falling back on a
    // failed app-password check would make the app password advisory.
    const account = await db
      .select({
        id: schema.users.id,
        studentId: schema.users.studentId,
        displayName: schema.users.displayName,
        section: schema.users.section,
        role: schema.users.role,
        passwordHash: schema.users.passwordHash,
      })
      .from(schema.users)
      .where(eq(schema.users.studentId, cleanStudentId))
      .get();

    if (account && account.passwordHash) {
      const passwordMatches = await verifyPassword(password, account.passwordHash);
      if (!passwordMatches) {
        // Identical wording to an unknown ID: no oracle for which school IDs exist.
        return res.status(401).json({
          authenticated: false,
          error: "Invalid student ID or password."
        });
      }

      const appToken = await sessionService.createAppSession(account.id, account);
      res.cookie("app_session", appToken, sessionCookieOptions({
        maxAge: sessionService.SESSION_TTL_MS
      }));

      const role = account.role || "student";
      // The portal is not contacted on this path, so profile fields come from the
      // row the last successful portal login wrote.
      let teacherProfile = null;
      if (role === "teacher" || role === "class_teacher") {
        const stored = await db
          .select()
          .from(schema.teacherProfiles)
          .where(eq(schema.teacherProfiles.userId, account.id))
          .get();
        teacherProfile = stored ? normalizeTeacherProfile(stored) : null;
      }

      void joinClassGroupInBackground({ id: account.id, section: account.section });

      return res.json({
        authenticated: true,
        token: appToken,
        user: {
          id: account.id,
          studentId: account.studentId,
          displayName: account.displayName || null,
          section: isUnknownSection(account.section) ? null : account.section,
          profilePictureUrl: await profilePictureUrlFor(account.id),
          isAdmin: role === "admin" || account.studentId === "admin_mmss",
          isTeacher: role === "teacher" || role === "class_teacher",
          role,
          teacherProfile,
        }
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

    // Resolve section before any background work closes over it (T10: the
    // prefetch used to capture `section` from a later `let` binding).
    let section = user.section;
    let displayName = user.displayName;
    let teacherProfile = null;
    let role = user.role || "student";

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

    // Fetch and cache initial homework in the background. This no longer
    // blocks the login response now that the Announcement.aspx verification
    // round-trip has been removed from loginToEduSecure.
    fetchHomeworkForSession(sessionCookies)
      .then((data) => homeworkCacheService.upsertHomework(user.id, data.homework, { section }))
      .catch((err) => {
        console.error("Failed to prefetch homework cache after login:", err.message);
      });

    res.cookie("app_session", appToken, sessionCookieOptions({
      maxAge: sessionService.SESSION_TTL_MS
    }));

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
        isAdmin: role === "admin" || user.studentId === "admin_mmss",
        isTeacher: role === "teacher" || role === "class_teacher",
        role,
        teacherProfile: teacherProfile ? normalizeTeacherProfile(teacherProfile) : null,
      }
    });

  } catch (err) {
    console.error("Auth Login Error:", err);
    return res.status(500).json({
      authenticated: false,
      error: "An unexpected error occurred during login."
    });
  }
});

// ------------------------------------------------------- passwords & recovery

/**
 * Whether this deployment can prove a student's identity through the school portal
 * well enough to let them set their own MMSS64 password. It cannot, and a constant
 * rather than a setting because flipping it on without new evidence is the bug.
 *
 * What would make it true: a portal response that *positively* identifies a signed-in
 * session -- a marker only reachable while authenticated -- that is reliably
 * distinguishable from invalid credentials, unfamiliar markup, a WAF page, a CAPTCHA,
 * a lockout, an expired session and a network failure. Proof must come from captured
 * success and failure responses plus a test account, run against the real
 * round-trip. Until that exists, the predicate in `server/edusecure/edusecureAuth.js`
 * is the only thing available: it is a deny-list, so it passes when nothing goes
 * wrong rather than when authentication succeeds.
 */
const EDUSECURE_ENROLLMENT_AVAILABLE = false;

/** Identical wording for "no password" and "wrong password", so the two are one answer. */
const PASSWORD_REJECTED = "That password is not correct.";

/**
 * What a student is told when they ask to set their own password. It has to name
 * the way out, and it must not say whether their account has a password, which
 * accounts exist, or why the feature is off in words that invite retrying.
 */
const ENROLLMENT_UNAVAILABLE_MESSAGE =
  "Setting your own MMSS64 password is not available on this server yet. " +
  "Ask an administrator to start a password reset for your account -- they will give " +
  "you a one-time code that lets you set your own password.";

/** One write, used by the endpoints that can burn CPU proving a password. */
const PASSWORD_ROUTE_LIMIT = { windowMs: 5 * 60 * 1000, max: 5 };

/** Reads only the fields the security endpoints need. Never the hash itself. */
async function loadPasswordState(userId) {
  const user = await db
    .select({
      id: schema.users.id,
      studentId: schema.users.studentId,
      passwordHash: schema.users.passwordHash,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!user) return { found: false, hasPassword: false };
  const stored = await db
    .select({ id: schema.edusecureSessions.id })
    .from(schema.edusecureSessions)
    .where(eq(schema.edusecureSessions.userId, userId))
    .get();
  return {
    found: true,
    hasPassword: Boolean(user.passwordHash),
    edusecureCredentialConfigured: Boolean(stored),
  };
}

/**
 * GET /api/auth/security
 *
 * Which controls the settings page should offer. Booleans only -- never a credential,
 * not its length, not a last-updated timestamp that could be used as an oracle.
 */
router.get("/security", requireAuth, async (req, res) => {
  try {
    const state = await loadPasswordState(req.user.id);
    if (!state.found) {
      return res.status(404).json({ error: "That account no longer exists." });
    }
    return res.json({
      hasMmssPassword: state.hasPassword,
      edusecureCredentialConfigured: state.edusecureCredentialConfigured,
      edusecureVerificationAvailable: EDUSECURE_ENROLLMENT_AVAILABLE,
    });
  } catch (err) {
    console.error("Security status error:", err.message);
    return res.status(500).json({ error: "Could not load your account security settings." });
  }
});

/**
 * POST /api/auth/security/password
 *
 * First-time setup of an MMSS64 password. Always refuses: the identity proof this
 * would need is the fail-open portal check, so the endpoint exists only to say so
 * and point at the supported process.
 *
 * A refusal sent *before* the body is parsed is deliberate. Reading the school
 * password only to refuse to use it would mean touching a credential this endpoint
 * has no accepted use for.
 */
router.post("/security/password", requireAuth, rateLimit({ ...PASSWORD_ROUTE_LIMIT, name: "password-setup" }), async (req, res) => {
  await recordSecurityEvent({
    event: EVENTS.ENROLLMENT_REFUSED,
    outcome: OUTCOMES.REFUSED,
    targetUserId: req.user?.id || null,
    targetStudentId: req.user?.studentId || null,
    detail: { reason: "enrollment_unavailable", source: "security_password_post" },
  });
  return res.status(403).json({
    error: ENROLLMENT_UNAVAILABLE_MESSAGE,
    code: "enrollment_unavailable",
  });
});

/**
 * PATCH /api/auth/security/password
 *
 * Changes an MMSS64 password that already exists. Requires the current one, refuses
 * the unchanged-password case, then revokes every session before the new credential
 * becomes live, and finally issues the caller a fresh session in its place.
 */
router.patch("/security/password", requireAuth, rateLimit({ ...PASSWORD_ROUTE_LIMIT, name: "password-change" }), async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    const state = await loadPasswordState(req.user.id);
    if (!state.found) {
      return res.status(404).json({ error: "That account no longer exists." });
    }

    // Validation before verification: an unusable new password is rejected without
    // spending a scrypt derivation, and the order leaks nothing.
    const validation = validatePassword(newPassword);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }
    if (typeof newPassword !== "string" || typeof confirmPassword !== "string" || newPassword !== confirmPassword) {
      return res.status(400).json({ error: "The two passwords do not match." });
    }

    // No hash and a wrong password answer identically, so this cannot be used to
    // learn which accounts have been migrated to an MMSS64 password.
    const stored = await db
      .select({ passwordHash: schema.users.passwordHash })
      .from(schema.users)
      .where(eq(schema.users.id, req.user.id))
      .get();

    if (!stored?.passwordHash) {
      return res.status(401).json({ error: PASSWORD_REJECTED });
    }
    if (typeof currentPassword !== "string" || !currentPassword) {
      return res.status(401).json({ error: PASSWORD_REJECTED });
    }
    if (!(await verifyPassword(currentPassword, stored.passwordHash))) {
      return res.status(401).json({ error: PASSWORD_REJECTED });
    }
    // A change to the same password re-issues every session while leaving the
    // credential identical: all the disruption, none of the benefit.
    if (currentPassword === newPassword) {
      return res.status(400).json({ error: "Choose a password different from your current one." });
    }

    const passwordHash = await hashPassword(newPassword);

    // Revoke before the new credential is live, so there is never a moment when the
    // new password works and the old sessions still do. If the write below fails the
    // account is simply signed out and can sign back in with the old password.
    await sessionService.destroyAllUserSessions(req.user.id, { rethrow: true });

    await db
      .update(schema.users)
      .set({ passwordHash, updatedAt: new Date().toISOString() })
      .where(eq(schema.users.id, req.user.id))
      .run();

    const appToken = await sessionService.createAppSession(req.user.id, req.user);
    res.cookie("app_session", appToken, sessionCookieOptions({
      maxAge: sessionService.SESSION_TTL_MS
    }));

    await recordSecurityEvent({
      event: EVENTS.PASSWORD_CHANGED,
      outcome: OUTCOMES.SUCCESS,
      actorUserId: req.user.id,
      targetUserId: req.user.id,
      targetStudentId: req.user.studentId,
      detail: { method: "change_password" },
    });
    // Every session was revoked above. The count is not recorded: the drivers
    // report it inconsistently, and a wrong number in an audit row is worse than
    // the absence of one.
    await recordSecurityEvent({
      event: EVENTS.SESSIONS_REVOKED,
      outcome: OUTCOMES.SUCCESS,
      actorUserId: req.user.id,
      targetUserId: req.user.id,
      targetStudentId: req.user.studentId,
      detail: { reason: "password_changed", scope: "all_sessions" },
    });

    return res.json({
      success: true,
      separatePasswordEnabled: true,
      edusecureCredentialConfigured: state.edusecureCredentialConfigured,
    });
  } catch (err) {
    console.error("Password change error:", err.message);
    return res.status(500).json({ error: "Could not change your password. Try again." });
  }
});

/**
 * POST /api/auth/password-reset-requests
 *
 * A student asking for help. Answerable while signed in and while locked out, and
 * identical for both: the response names nothing about the account, because an
 * unauthenticated caller who is told "no such student" has just been given a way to
 * test school IDs. One pending request per student, updated in place.
 */
router.post("/password-reset-requests", rateLimit({ name: "password-reset-request", windowMs: 15 * 60 * 1000, max: 5 }), async (req, res) => {
  try {
    const { studentId, message } = req.body || {};
    const cleanedId = String(studentId || "").trim().slice(0, 64);
    if (!cleanedId) {
      return res.status(400).json({ error: "Enter your school ID." });
    }

    // The session is used when present and ignored when not: an unauthenticated
    // caller supplies the ID, and an authenticated one cannot ask on behalf of
    // someone else through this body.
    let account = null;
    try {
      account = await getRequestSession(req);
    } catch {
      account = null;
    }
    const requesterId = account?.user ? account.user.studentId : cleanedId;

    await passwordResetService.createResetRequest({
      studentId: requesterId,
      message,
      userId: account?.user ? account.user.id : null,
    });

    return res.status(202).json({
      ok: true,
      message:
        "If an administrator can help with that account, they will see your request. " +
        "Nothing has changed yet.",
    });
  } catch (err) {
    console.error("Password reset request error:", err.message);
    return res.status(500).json({ error: "Could not submit that request. Try again." });
  }
});

/**
 * GET /api/auth/password-reset-requests
 *
 * The requesting student's own requests. The student comes from the session, never
 * from a query parameter, so there is nothing to edit to read someone else's.
 */
router.get("/password-reset-requests", requireAuth, async (req, res) => {
  try {
    const requests = await passwordResetService.listOwnResetRequests({
      userId: req.user.id,
      studentId: req.user.studentId,
    });
    return res.json({ requests });
  } catch (err) {
    console.error("Password reset request list error:", err.message);
    return res.status(500).json({ error: "Could not load your requests." });
  }
});

/**
 * POST /api/auth/password-reset
 *
 * Redeems an administrator-issued token and sets the password the student chooses.
 * No session is created: the student signs in with their new password immediately
 * afterwards, which is the outcome this flow is meant to reach.
 */
router.post("/password-reset", rateLimit({ name: "password-reset-redeem", windowMs: 15 * 60 * 1000, max: 10 }), async (req, res) => {
  try {
    const { token, newPassword, confirmPassword } = req.body || {};
    if (typeof token !== "string" || !token.trim()) {
      return res.status(400).json({ error: "Enter the reset code your administrator gave you." });
    }
    if (typeof newPassword !== "string" || typeof confirmPassword !== "string" || newPassword !== confirmPassword) {
      return res.status(400).json({ error: "The two passwords do not match." });
    }

    const result = await passwordResetService.redeemResetToken({ token: token.trim(), newPassword });
    if (!result.ok) {
      const status = result.code === "server_error" ? 500 : 400;
      return res.status(status).json({ error: result.error, code: result.code });
    }

    return res.json({
      ok: true,
      message: "Your password is set. Sign in with your new MMSS64 password.",
    });
  } catch (err) {
    console.error("Password reset redemption error:", err.message);
    return res.status(500).json({ error: "Could not set your password. Try again." });
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
    activeSession.user.role === "admin";
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

  // Display names are shown to other students — run the same text-safety
  // gate as chat/requests so a swipe cannot slip past via the profile form.
  const safety = await checkContent({ text: cleaned });
  if (!safety.ok) {
    return res.status(422).json({
      error: "That name can't be used - it doesn't follow school guidelines.",
    });
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
    // as the login route; Announcement.aspx is no longer fetched inline).
    fetchHomeworkForSession(sessionCookies)
      .then((data) => homeworkCacheService.upsertHomework(req.user.id, data.homework, { section: req.user.section }))
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
