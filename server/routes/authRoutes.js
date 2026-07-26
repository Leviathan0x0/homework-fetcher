const express = require("express");
const sessionService = require("../auth/sessionService");
const { fetchProfileFromEduSecure } = require("../auth/sessionService");
const { loginToEduSecure } = require("../edusecure/edusecureAuth");
const { sessionCookieOptions } = require("../config");
const { getRequestSession, getRequestToken } = require("../auth/requireAuth");

const FALLBACK_SECTION = "Section 10-A";
const needsRefresh = (s) => !s || s === FALLBACK_SECTION;

const router = express.Router();

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

    let sessionCookies;
    try {
      sessionCookies = await loginToEduSecure(cleanStudentId, password);
    } catch (authErr) {
      console.error("EduSecure Auth Error:", authErr && authErr.message ? authErr.message : authErr);
      // Only report bad credentials when the portal actually rejected them;
      // outages or blocked egress would otherwise look like a wrong password.
      if (!authErr || authErr.code === "invalid_credentials") {
        return res.status(401).json({
          authenticated: false,
          error: "Invalid student ID or password."
        });
      }
      return res.status(502).json({
        authenticated: false,
        error: authErr.message || "The school portal is currently unreachable. Please try again later."
      });
    }

    const user = await sessionService.findOrCreateUser(cleanStudentId);
    await sessionService.saveEduSecureSession(user.id, sessionCookies);

    const appToken = await sessionService.createAppSession(user.id);

    res.cookie("app_session", appToken, sessionCookieOptions({
      maxAge: sessionService.SESSION_TTL_MS
    }));

    let section = user.section;
    let displayName = user.displayName;
    if (needsRefresh(section) || !displayName) {
      try {
        const profile = await fetchProfileFromEduSecure(sessionCookies);
        if (profile.section && needsRefresh(section)) {
          await sessionService.updateSection(user.id, profile.section);
          section = profile.section;
        }
        if (profile.displayName && !displayName) {
          await sessionService.updateDisplayName(user.id, profile.displayName);
          displayName = profile.displayName;
        }
      } catch (err) {
        console.error("Profile fetch failed:", err.message);
      }
    }

    return res.json({
      authenticated: true,
      // Browsers use the httpOnly cookie set above; native clients store this
      // token and send it as `Authorization: Bearer <token>`.
      token: appToken,
      user: {
        id: user.id,
        studentId: user.studentId,
        displayName: displayName || null,
        section,
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
  // Only the section is worth re-fetching here; the display name is set by the
  // student, so scraping the portal on every /me call would only add latency.
  if (needsRefresh(section)) {
    try {
      const eduSession = await sessionService.getEduSecureSession(activeSession.user.id);
      if (eduSession) {
        const profile = await fetchProfileFromEduSecure(eduSession.sessionCookies);
        if (profile.section && needsRefresh(section)) {
          await sessionService.updateSection(activeSession.user.id, profile.section);
          section = profile.section;
        }
        if (profile.displayName && !displayName) {
          await sessionService.updateDisplayName(activeSession.user.id, profile.displayName);
          displayName = profile.displayName;
        }
      }
    } catch (err) {
      console.error("Profile refresh failed:", err.message);
    }
  }

  return res.json({
    authenticated: true,
    user: {
      id: activeSession.user.id,
      studentId: activeSession.user.studentId,
      displayName: displayName || null,
      section,
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
      section: activeSession.user.section,
    },
  });
});

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
