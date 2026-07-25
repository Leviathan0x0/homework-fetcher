const express = require("express");
const sessionService = require("../auth/sessionService");
const { fetchProfileFromEduSecure } = require("../auth/sessionService");
const { loginToEduSecure } = require("../edusecure/edusecureAuth");
const { sessionCookieOptions } = require("../config");

const FALLBACK_SECTION = "Section 10-A";
const needsRefresh = (s) => !s || s === FALLBACK_SECTION;

const router = express.Router();

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { studentId, password } = req.body || {};

    if (!studentId || typeof studentId !== "string" || !studentId.trim()) {
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
    const isDummyAccount = studentId.trim().toLowerCase().startsWith("dummy") || 
                           studentId.trim().toLowerCase() === "testuser" || 
                           studentId.trim().toLowerCase() === "student2";

    if (isDummyAccount) {
      // Mock session cookies for testing uploads/messages without EduSecure portal requirements
      sessionCookies = `ASP.NET_SessionId=dummy_test_session_${studentId.trim()}`;
    } else {
      try {
        sessionCookies = await loginToEduSecure(studentId, password);
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
    }

    const user = sessionService.findOrCreateUser(studentId);
    if (isDummyAccount && (!user.section || user.section === FALLBACK_SECTION)) {
      sessionService.updateSection(user.id, "9-F");
    }
    sessionService.saveEduSecureSession(user.id, sessionCookies);

    const appToken = sessionService.createAppSession(user.id);

    res.cookie("app_session", appToken, sessionCookieOptions({
      maxAge: 30 * 24 * 60 * 60 * 1000
    }));

    let section = user.section;
    let displayName = user.displayName;
    if (!isDummyAccount && (needsRefresh(section) || !displayName)) {
      try {
        const profile = await fetchProfileFromEduSecure(sessionCookies);
        if (profile.section && needsRefresh(section)) {
          sessionService.updateSection(user.id, profile.section);
          section = profile.section;
        }
        if (profile.displayName && !displayName) {
          sessionService.updateDisplayName(user.id, profile.displayName);
          displayName = profile.displayName;
        }
      } catch (err) {
        console.error("Profile fetch failed:", err.message);
      }
    }

    return res.json({
      authenticated: true,
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
  const token = req.cookies?.app_session;
  const activeSession = sessionService.getAppSession(token);

  if (!activeSession) {
    return res.json({
      authenticated: false
    });
  }

  let section = activeSession.user.section;
  let displayName = activeSession.user.displayName;
  if (needsRefresh(section) || !displayName) {
    try {
      const eduSession = sessionService.getEduSecureSession(activeSession.user.id);
      if (eduSession) {
        const profile = await fetchProfileFromEduSecure(eduSession.sessionCookies);
        if (profile.section && needsRefresh(section)) {
          sessionService.updateSection(activeSession.user.id, profile.section);
          section = profile.section;
        }
        if (profile.displayName && !displayName) {
          sessionService.updateDisplayName(activeSession.user.id, profile.displayName);
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

// POST /api/auth/logout
router.post("/logout", (req, res) => {
  const token = req.cookies?.app_session;

  if (token) {
    sessionService.destroyAppSession(token);
  }

  res.clearCookie("app_session", sessionCookieOptions());

  return res.json({
    success: true,
    authenticated: false
  });
});

module.exports = router;
