const express = require("express");
const { getRequestSession } = require("../auth/requireAuth");
const { db, schema } = require("../db/client");
const { eq, desc, count, ne } = require("drizzle-orm");
const {
  DEFAULT_SETTINGS,
  getSetting,
  seedDefaultSettings,
} = require("../admin/settingsService");
const { saveTeacherProfile } = require("../teacher/teacherService");

const router = express.Router();

const ALLOWED_SETTING_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));

async function requireAdmin(req, res, next) {
  const activeSession = await getRequestSession(req);
  if (!activeSession || !activeSession.user) {
    return res.status(401).json({ error: "Not authenticated." });
  }

  const user = activeSession.user;
  const isAdmin =
    user.studentId === "admin_mmss" ||
    user.role === "admin" ||
    user.section === "Admin";
  if (!isAdmin) {
    return res.status(403).json({ error: "Access denied. Administrator privileges required." });
  }

  req.adminUser = user;
  next();
}

function isAdminUser(u) {
  return (
    u.studentId === "admin_mmss" ||
    u.role === "admin" ||
    u.section === "Admin"
  );
}

// GET /api/admin/stats
router.get("/stats", requireAdmin, async (req, res) => {
  try {
    const [
      totalUsersRes,
      mutedUsersRes,
      homeworkRes,
      classworkRes,
      alertsRes,
      reportsRes,
    ] = await Promise.all([
      db.select({ count: count() }).from(schema.users).where(ne(schema.users.studentId, "admin_mmss")).all(),
      db.select({ count: count() }).from(schema.users).where(eq(schema.users.isMuted, 1)).all(),
      db.select({ count: count() }).from(schema.homework).all(),
      db.select({ count: count() }).from(schema.classworkUploads).all(),
      db.select({ count: count() }).from(schema.broadcastAlerts).where(eq(schema.broadcastAlerts.active, 1)).all(),
      db.select({ count: count() }).from(schema.adminFlagLog).where(eq(schema.adminFlagLog.status, "pending")).all(),
    ]);

    return res.json({
      stats: {
        totalStudents: totalUsersRes[0]?.count || 0,
        mutedStudents: mutedUsersRes[0]?.count || 0,
        totalHomework: homeworkRes[0]?.count || 0,
        totalClasswork: classworkRes[0]?.count || 0,
        activeAlerts: alertsRes[0]?.count || 0,
        pendingReports: reportsRes[0]?.count || 0,
        systemStatus: "Operational",
      },
    });
  } catch (err) {
    console.error("Admin stats error:", err);
    return res.status(500).json({ error: "Failed to fetch admin stats." });
  }
});

// GET /api/admin/students
router.get("/students", requireAdmin, async (req, res) => {
  try {
    const usersList = await db.select().from(schema.users).all();

    const students = usersList
      .filter((u) => !isAdminUser(u))
      .map((u) => ({
        id: u.id,
        studentId: u.studentId,
        displayName: u.displayName || u.studentId,
        section: u.section || "Unassigned",
        muted: Boolean(u.isMuted),
        mutedReason: u.mutedReason || null,
        mutedAt: u.mutedAt || null,
        role: u.role || "student",
        createdAt: u.createdAt,
      }))
      .sort((a, b) => String(a.studentId).localeCompare(String(b.studentId)));

    return res.json({ students });
  } catch (err) {
    console.error("Admin students error:", err);
    return res.status(500).json({ error: "Failed to fetch student directory." });
  }
});

// POST /api/admin/students/mute
router.post("/students/mute", requireAdmin, async (req, res) => {
  try {
    const { studentId, mute, reason } = req.body || {};
    if (!studentId) {
      return res.status(400).json({ error: "studentId is required." });
    }

    const targetUser = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.studentId, studentId))
      .get();

    if (!targetUser) {
      return res.status(404).json({ error: `Student ${studentId} not found in database.` });
    }
    if (isAdminUser(targetUser)) {
      return res.status(400).json({ error: "Cannot mute an administrator account." });
    }

    const shouldMute = Boolean(mute);
    await db
      .update(schema.users)
      .set({
        isMuted: shouldMute ? 1 : 0,
        mutedReason: shouldMute ? reason || "Muted by administrator" : null,
        mutedAt: shouldMute ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.users.id, targetUser.id));

    return res.json({
      success: true,
      studentId,
      muted: shouldMute,
      message: `Student ${studentId} has been ${shouldMute ? "muted" : "unmuted"}.${
        shouldMute && reason ? ` Reason: ${reason}` : ""
      }`,
    });
  } catch (err) {
    console.error("Admin mute error:", err);
    return res.status(500).json({ error: "Failed to update mute status." });
  }
});

// GET /api/admin/teachers
router.get("/teachers", requireAdmin, async (req, res) => {
  try {
    const teacherUsers = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.role, "teacher"))
      .all();

    return res.json({
      teachers: teacherUsers.map((u) => ({
        id: u.id,
        studentId: u.studentId,
        displayName: u.displayName || u.studentId,
        section: u.section || null,
        role: u.role,
        createdAt: u.createdAt,
      })),
    });
  } catch (err) {
    console.error("Admin teachers error:", err);
    return res.status(500).json({ error: "Failed to fetch teachers." });
  }
});

// PUT /api/admin/teachers/:id/profile — assign sections and class-teacher scope
router.put("/teachers/:id/profile", requireAdmin, async (req, res) => {
  try {
    const teacher = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, req.params.id))
      .get();
    if (!teacher) return res.status(404).json({ error: "Teacher account not found." });
    const profile = await saveTeacherProfile(teacher.id, {
      subjects: Array.isArray(req.body?.subjects) ? req.body.subjects : [],
      assignedSections: Array.isArray(req.body?.assignedSections) ? req.body.assignedSections : [],
      classTeacherSections: Array.isArray(req.body?.classTeacherSections) ? req.body.classTeacherSections : [],
    });
    await db
      .update(schema.users)
      .set({ role: "teacher", updatedAt: new Date().toISOString() })
      .where(eq(schema.users.id, teacher.id))
      .run();
    return res.json({ success: true, profile });
  } catch (err) {
    console.error("Admin teacher profile error:", err);
    return res.status(500).json({ error: "Failed to update teacher permissions." });
  }
});

// GET /api/admin/alerts
router.get("/alerts", requireAdmin, async (req, res) => {
  try {
    const alertsList = await db
      .select()
      .from(schema.broadcastAlerts)
      .orderBy(desc(schema.broadcastAlerts.createdAt))
      .all();

    return res.json({
      alerts: alertsList.map((a) => ({
        ...a,
        active: Boolean(a.active),
      })),
    });
  } catch (err) {
    console.error("Admin alerts error:", err);
    return res.status(500).json({ error: "Failed to fetch alerts." });
  }
});

// POST /api/admin/alerts
router.post("/alerts", requireAdmin, async (req, res) => {
  try {
    const { title, message, level, targetSection } = req.body || {};
    if (!title || !message) {
      return res.status(400).json({ error: "Title and message are required." });
    }

    const newAlert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: String(title).trim(),
      message: String(message).trim(),
      level: level || "info",
      targetSection: targetSection || "All",
      active: 1,
      createdAt: new Date().toISOString(),
    };

    await db.insert(schema.broadcastAlerts).values(newAlert);
    return res.json({
      success: true,
      alert: { ...newAlert, active: true },
    });
  } catch (err) {
    console.error("Admin create alert error:", err);
    return res.status(500).json({ error: "Failed to create broadcast alert." });
  }
});

// DELETE /api/admin/alerts/:id
router.delete("/alerts/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete(schema.broadcastAlerts).where(eq(schema.broadcastAlerts.id, id));
    return res.json({ success: true, id });
  } catch (err) {
    console.error("Admin delete alert error:", err);
    return res.status(500).json({ error: "Failed to delete alert." });
  }
});

// GET /api/admin/reports
router.get("/reports", requireAdmin, async (req, res) => {
  try {
    const reportsList = await db
      .select()
      .from(schema.adminFlagLog)
      .orderBy(desc(schema.adminFlagLog.createdAt))
      .all();

    const userIds = [...new Set(reportsList.map((r) => r.userId).filter(Boolean))];
    const usersById = {};
    if (userIds.length) {
      const users = await db.select().from(schema.users).all();
      for (const u of users) {
        if (userIds.includes(u.id)) usersById[u.id] = u;
      }
    }

    return res.json({
      reports: reportsList.map((r) => ({
        id: r.id,
        type: r.type,
        studentId: r.studentId,
        displayName: usersById[r.userId]?.displayName || r.studentId,
        section: r.section,
        conversationId: r.conversationId,
        reason: r.reason,
        detail: r.detail,
        source: r.source,
        status: r.status || "pending",
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    console.error("Admin reports error:", err);
    return res.status(500).json({ error: "Failed to fetch reports." });
  }
});

// POST /api/admin/reports/resolve
router.post("/reports/resolve", requireAdmin, async (req, res) => {
  try {
    const { reportId, action } = req.body || {};
    if (!reportId) {
      return res.status(400).json({ error: "reportId is required." });
    }

    const report = await db
      .select()
      .from(schema.adminFlagLog)
      .where(eq(schema.adminFlagLog.id, reportId))
      .get();

    if (!report) {
      return res.status(404).json({ error: "Report not found." });
    }

    const statusVal =
      action === "dismiss" ? "dismissed" : action === "mute" ? "muted" : "resolved";

    if (action === "mute" && report.studentId) {
      await db
        .update(schema.users)
        .set({
          isMuted: 1,
          mutedReason: report.reason || "Muted from flagged report",
          mutedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.users.studentId, report.studentId));
    }

    await db
      .update(schema.adminFlagLog)
      .set({ status: statusVal })
      .where(eq(schema.adminFlagLog.id, reportId));

    return res.json({
      success: true,
      reportId,
      status: statusVal,
      message: `Report ${reportId} marked as ${statusVal}.`,
    });
  } catch (err) {
    console.error("Admin resolve report error:", err);
    return res.status(500).json({ error: "Failed to resolve report." });
  }
});

// GET /api/admin/settings
router.get("/settings", requireAdmin, async (req, res) => {
  try {
    await seedDefaultSettings();
    const settingsList = await db.select().from(schema.systemSettings).all();
    const settingsMap = { ...DEFAULT_SETTINGS };

    settingsList.forEach((s) => {
      settingsMap[s.key] = s.value;
    });

    return res.json({ settings: settingsMap });
  } catch (err) {
    console.error("Admin get settings error:", err);
    return res.status(500).json({ error: "Failed to fetch system settings." });
  }
});

// POST /api/admin/settings
router.post("/settings", requireAdmin, async (req, res) => {
  try {
    const { key, value } = req.body || {};
    if (!key || value === undefined || value === null) {
      return res.status(400).json({ error: "key and value are required." });
    }
    if (!ALLOWED_SETTING_KEYS.has(key)) {
      return res.status(400).json({ error: `Unknown setting key: ${key}` });
    }

    const stringVal = value === true || value === "1" || value === 1 ? "1" : value === false || value === "0" || value === 0 ? "0" : String(value);
    if (stringVal !== "0" && stringVal !== "1") {
      return res.status(400).json({ error: "Setting value must be 0 or 1." });
    }

    const existing = await db
      .select()
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, key))
      .get();

    const now = new Date().toISOString();
    if (existing) {
      await db
        .update(schema.systemSettings)
        .set({ value: stringVal, updatedAt: now })
        .where(eq(schema.systemSettings.key, key));
    } else {
      await db.insert(schema.systemSettings).values({
        key,
        value: stringVal,
        updatedAt: now,
      });
    }

    const confirmed = await getSetting(key, stringVal);
    return res.json({ success: true, key, value: confirmed });
  } catch (err) {
    console.error("Admin update setting error:", err);
    return res.status(500).json({ error: "Failed to update system setting." });
  }
});

// GET /api/admin/classwork/pending — pending classwork when approval is required
router.get("/classwork/pending", requireAdmin, async (req, res) => {
  try {
    const pending = await db
      .select()
      .from(schema.classworkUploads)
      .where(eq(schema.classworkUploads.approvalStatus, "pending"))
      .orderBy(desc(schema.classworkUploads.createdAt))
      .all();

    return res.json({
      classwork: pending.map((item) => ({
        id: item.id,
        studentId: item.studentId,
        section: item.section,
        subject: item.subject,
        title: item.title,
        date: item.date,
        originalFilename: item.originalFilename,
        createdAt: item.createdAt,
        approvalStatus: item.approvalStatus || "pending",
      })),
    });
  } catch (err) {
    console.error("Admin pending classwork error:", err);
    return res.status(500).json({ error: "Failed to fetch pending classwork." });
  }
});

// POST /api/admin/classwork/approve
router.post("/classwork/approve", requireAdmin, async (req, res) => {
  try {
    const { id, approve } = req.body || {};
    if (!id) return res.status(400).json({ error: "id is required." });

    const status = approve === false ? "rejected" : "approved";
    await db
      .update(schema.classworkUploads)
      .set({
        approvalStatus: status,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.classworkUploads.id, id));

    return res.json({ success: true, id, approvalStatus: status });
  } catch (err) {
    console.error("Admin approve classwork error:", err);
    return res.status(500).json({ error: "Failed to update classwork approval." });
  }
});

module.exports = router;
