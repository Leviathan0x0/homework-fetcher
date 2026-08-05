const express = require("express");
const crypto = require("crypto");
const { eq, and, desc, inArray } = require("drizzle-orm");
const { db, schema } = require("../db/client");
const { requireAuth } = require("../auth/requireAuth");
const { createNotifications } = require("../notifications/notificationService");
const {
  isTeacher,
  getTeacherProfile,
  ensureTeacherProfile,
  assertSectionAccess,
  assertClassTeacherAccess,
  testTeacherUser,
} = require("../teacher/teacherService");
const { isPlaceholderTestText } = require("../admin/purgeTestContent");

const router = express.Router();

async function requireTeacher(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Not authenticated." });
  if (req.user.role === "admin" || isTeacher(req.user)) return next();
  return res.status(403).json({ error: "Teacher privileges are required." });
}

function isAdmin(user) {
  return user?.role === "admin" || user?.studentId === "admin_mmss";
}

async function teacherProfileFor(user) {
  return getTeacherProfile(user.id) || ensureTeacherProfile(user.id);
}

async function canUseSection(user, section, classTeacherOnly = false) {
  if (isAdmin(user)) return true;
  return classTeacherOnly
    ? assertClassTeacherAccess(user.id, section)
    : assertSectionAccess(user.id, section);
}

function cleanArray(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((v) => String(v).trim()).filter(Boolean)));
}

function now() {
  return new Date().toISOString();
}

function normalizeAttachment(raw) {
  if (!raw || typeof raw !== "object") return null;
  const filename = String(raw.filename || "attachment").trim().slice(0, 160);
  const mimeType = String(raw.mimeType || "application/octet-stream").trim().slice(0, 120);
  const data = String(raw.data || "");
  if (!data.startsWith("data:") || data.length > 8 * 1024 * 1024) return null;
  return { filename, mimeType, data };
}

router.use(requireAuth);

// Student-facing assignment feed.
router.get("/assignments/student", async (req, res) => {
  try {
    const targets = await db
      .select()
      .from(schema.teacherAssignmentTargets)
      .where(eq(schema.teacherAssignmentTargets.studentId, req.user.id))
      .orderBy(desc(schema.teacherAssignmentTargets.createdAt))
      .all();
    if (!targets.length) return res.json({ assignments: [] });

    const assignmentIds = targets.map((target) => target.assignmentId);
    const assignments = await db
      .select()
      .from(schema.teacherAssignments)
      .where(inArray(schema.teacherAssignments.id, assignmentIds))
      .all();
    const byId = new Map(assignments.map((assignment) => [assignment.id, assignment]));
    const attachments = await db
      .select()
      .from(schema.teacherAssignmentAttachments)
      .where(inArray(schema.teacherAssignmentAttachments.assignmentId, assignmentIds))
      .all();
    const attachmentByAssignment = new Map(attachments.map((attachment) => [attachment.assignmentId, attachment]));
    const demoTeacherId = testTeacherUser().id;
    const visible = targets
      .map((target) => {
        const assignment = byId.get(target.assignmentId);
        if (!assignment) return null;
        if (
          assignment.teacherUserId === demoTeacherId ||
          isPlaceholderTestText(assignment.title) ||
          isPlaceholderTestText(assignment.content)
        ) {
          return null;
        }
        return {
          ...assignment,
          targetId: target.id,
          section: target.section,
          status: target.status,
          submittedAt: target.submittedAt,
          attachmentUrl: attachmentByAssignment.has(target.assignmentId)
            ? `/api/teacher/assignments/${target.assignmentId}/attachment`
            : null,
          attachmentFilename: attachmentByAssignment.get(target.assignmentId)?.filename || null,
          attachmentMimeType: attachmentByAssignment.get(target.assignmentId)?.mimeType || null,
        };
      })
      .filter(Boolean);
    return res.json({ assignments: visible });
  } catch (err) {
    console.error("Student teacher assignments error:", err);
    return res.status(500).json({ error: "Failed to load teacher assignments." });
  }
});

router.post("/assignments/:targetId/submit", async (req, res) => {
  try {
    const target = await db
      .select()
      .from(schema.teacherAssignmentTargets)
      .where(
        and(
          eq(schema.teacherAssignmentTargets.id, req.params.targetId),
          eq(schema.teacherAssignmentTargets.studentId, req.user.id)
        )
      )
      .get();
    if (!target) return res.status(404).json({ error: "Assignment target not found." });
    const submissionText = String(req.body?.submissionText || "").trim();
    if (!submissionText) return res.status(400).json({ error: "Submission text is required." });
    await db
      .update(schema.teacherAssignmentTargets)
      .set({ status: "submitted", submissionText, submittedAt: now(), updatedAt: now() })
      .where(eq(schema.teacherAssignmentTargets.id, target.id))
      .run();
    const assignment = await db
      .select()
      .from(schema.teacherAssignments)
      .where(eq(schema.teacherAssignments.id, target.assignmentId))
      .get();
    if (assignment?.teacherUserId) {
      try {
        await createNotifications(
          [assignment.teacherUserId],
          "new_submission",
          `New submission: ${assignment.title}`,
          `${req.user.displayName || req.user.studentId} submitted work for review.`,
          "teacher-assignments",
          target.id
        );
      } catch (notificationErr) {
        console.error("Teacher submission notification failed:", notificationErr.message);
      }
    }
    return res.json({ success: true, status: "submitted" });
  } catch (err) {
    console.error("Submit teacher assignment error:", err);
    return res.status(500).json({ error: "Failed to submit assignment." });
  }
});

router.get("/leave/my", async (req, res) => {
  try {
    const requests = await db.select().from(schema.leaveRequests)
      .where(eq(schema.leaveRequests.studentId, req.user.id))
      .orderBy(desc(schema.leaveRequests.createdAt)).all();
    return res.json({ requests });
  } catch (err) {
    console.error("Student leave requests error:", err);
    return res.status(500).json({ error: "Failed to load leave requests." });
  }
});

router.post("/leave/my", async (req, res) => {
  try {
    const { fromDate, toDate, reason } = req.body || {};
    if (!fromDate || !toDate || !String(reason || "").trim()) return res.status(400).json({ error: "Dates and a reason are required." });
    if (String(toDate) < String(fromDate)) return res.status(400).json({ error: "End date cannot be before start date." });
    const stamped = now();
    const request = { id: crypto.randomUUID(), studentId: req.user.id, section: req.user.section || "", fromDate: String(fromDate), toDate: String(toDate), reason: String(reason).trim(), status: "pending", reviewedBy: null, reviewedAt: null, reviewerNote: null, createdAt: stamped, updatedAt: stamped };
    await db.insert(schema.leaveRequests).values(request).run();
    return res.status(201).json({ request });
  } catch (err) {
    console.error("Create student leave request error:", err);
    return res.status(500).json({ error: "Failed to submit leave request." });
  }
});

router.get("/assignments/:id/attachment", async (req, res) => {
  try {
    const assignment = await db.select().from(schema.teacherAssignments).where(eq(schema.teacherAssignments.id, req.params.id)).get();
    if (!assignment) return res.status(404).json({ error: "Attachment not found." });
    const target = await db.select().from(schema.teacherAssignmentTargets)
      .where(and(eq(schema.teacherAssignmentTargets.assignmentId, assignment.id), eq(schema.teacherAssignmentTargets.studentId, req.user.id))).get();
    if (!target && assignment.teacherUserId !== req.user.id && !isAdmin(req.user)) return res.status(403).json({ error: "Access denied." });
    const attachment = await db.select().from(schema.teacherAssignmentAttachments)
      .where(eq(schema.teacherAssignmentAttachments.assignmentId, assignment.id)).get();
    if (!attachment) return res.status(404).json({ error: "Attachment not found." });
    const match = attachment.data.match(/^data:[^;]+;base64,(.*)$/s);
    const buffer = Buffer.from(match ? match[1] : attachment.data, "base64");
    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${attachment.filename.replace(/["\r\n]/g, "")}"`);
    return res.send(buffer);
  } catch (err) {
    console.error("Teacher assignment attachment error:", err);
    return res.status(500).json({ error: "Failed to load attachment." });
  }
});

router.use(requireTeacher);

router.get("/profile", async (req, res) => {
  const profile = await teacherProfileFor(req.user);
  return res.json({ profile });
});

router.get("/dashboard", async (req, res) => {
  try {
    const profile = await teacherProfileFor(req.user);
    const sections = profile.assignedSections || [];
    const assignments = await db
      .select()
      .from(schema.teacherAssignments)
      .where(eq(schema.teacherAssignments.teacherUserId, req.user.id))
      .orderBy(desc(schema.teacherAssignments.createdAt))
      .all();
    const assignmentIds = assignments.map((item) => item.id);
    const targets = assignmentIds.length
      ? await db
          .select()
          .from(schema.teacherAssignmentTargets)
          .where(inArray(schema.teacherAssignmentTargets.assignmentId, assignmentIds))
          .all()
      : [];
    const duties = await db
      .select()
      .from(schema.teacherDuties)
      .where(eq(schema.teacherDuties.assignedBy, req.user.id))
      .orderBy(desc(schema.teacherDuties.createdAt))
      .limit(10)
      .all();
    const announcements = await db
      .select()
      .from(schema.teacherAnnouncements)
      .where(eq(schema.teacherAnnouncements.teacherUserId, req.user.id))
      .orderBy(desc(schema.teacherAnnouncements.createdAt))
      .limit(5)
      .all();
    return res.json({
      profile,
      stats: {
        sections: sections.length,
        assignments: assignments.length,
        pendingSubmissions: targets.filter((target) => target.status === "submitted").length,
        openDuties: duties.filter((duty) => duty.status === "open").length,
        announcements: announcements.length,
      },
      recentAssignments: assignments.slice(0, 6),
      recentDuties: duties,
      recentAnnouncements: announcements,
    });
  } catch (err) {
    console.error("Teacher dashboard error:", err);
    return res.status(500).json({ error: "Failed to load teacher dashboard." });
  }
});

router.get("/roster", async (req, res) => {
  try {
    const profile = await teacherProfileFor(req.user);
    const requested = req.query.section ? [String(req.query.section)] : profile.assignedSections;
    const sections = requested.filter((section) => profile.assignedSections.includes(section) || isAdmin(req.user));
    if (!sections.length) return res.json({ students: [] });
    const students = await db
      .select()
      .from(schema.users)
      .where(inArray(schema.users.section, sections))
      .all();
    return res.json({
      students: students
        .filter((student) => student.role === "student")
        .map((student) => ({
          id: student.id,
          studentId: student.studentId,
          displayName: student.displayName || student.studentId,
          section: student.section,
        })),
    });
  } catch (err) {
    console.error("Teacher roster error:", err);
    return res.status(500).json({ error: "Failed to load class roster." });
  }
});

router.get("/students/:studentId/notes", async (req, res) => {
  try {
    const student = await db.select().from(schema.users).where(eq(schema.users.id, req.params.studentId)).get();
    if (!student || student.role !== "student") return res.status(404).json({ error: "Student not found." });
    if (!await canUseSection(req.user, student.section, false)) return res.status(403).json({ error: "Student is outside your assigned sections." });
    const notes = await db.select().from(schema.teacherStudentNotes)
      .where(and(eq(schema.teacherStudentNotes.teacherUserId, req.user.id), eq(schema.teacherStudentNotes.studentId, student.id)))
      .orderBy(desc(schema.teacherStudentNotes.updatedAt)).all();
    return res.json({ student: { id: student.id, studentId: student.studentId, displayName: student.displayName || student.studentId, section: student.section }, notes });
  } catch (err) {
    console.error("Teacher notes error:", err);
    return res.status(500).json({ error: "Failed to load student notes." });
  }
});

router.post("/students/:studentId/notes", async (req, res) => {
  try {
    const student = await db.select().from(schema.users).where(eq(schema.users.id, req.params.studentId)).get();
    const note = String(req.body?.note || "").trim();
    if (!student || student.role !== "student") return res.status(404).json({ error: "Student not found." });
    if (!note) return res.status(400).json({ error: "Note cannot be empty." });
    if (!await canUseSection(req.user, student.section, false)) return res.status(403).json({ error: "Student is outside your assigned sections." });
    const stamped = now();
    const record = { id: crypto.randomUUID(), teacherUserId: req.user.id, studentId: student.id, note, createdAt: stamped, updatedAt: stamped };
    await db.insert(schema.teacherStudentNotes).values(record).run();
    return res.status(201).json({ note: record });
  } catch (err) {
    console.error("Create teacher note error:", err);
    return res.status(500).json({ error: "Failed to save private note." });
  }
});

router.get("/assignments", async (req, res) => {
  try {
    const assignments = await db
      .select()
      .from(schema.teacherAssignments)
      .where(eq(schema.teacherAssignments.teacherUserId, req.user.id))
      .orderBy(desc(schema.teacherAssignments.createdAt))
      .all();
    const attachments = assignments.length
      ? await db.select().from(schema.teacherAssignmentAttachments).where(inArray(schema.teacherAssignmentAttachments.assignmentId, assignments.map((item) => item.id))).all()
      : [];
    const attachmentByAssignment = new Map(attachments.map((item) => [item.assignmentId, item]));
    // Load every assignment's targets in one query instead of one per assignment.
    const targets = assignments.length
      ? await db.select().from(schema.teacherAssignmentTargets).where(inArray(schema.teacherAssignmentTargets.assignmentId, assignments.map((item) => item.id))).all()
      : [];
    const targetsByAssignment = new Map();
    for (const target of targets) {
      if (!targetsByAssignment.has(target.assignmentId)) {
        targetsByAssignment.set(target.assignmentId, []);
      }
      targetsByAssignment.get(target.assignmentId).push(target);
    }
    const result = [];
    for (const assignment of assignments) {
      const attachment = attachmentByAssignment.get(assignment.id);
      result.push({
        ...assignment,
        targets: targetsByAssignment.get(assignment.id) || [],
        attachmentUrl: attachment ? `/api/teacher/assignments/${assignment.id}/attachment` : null,
        attachmentFilename: attachment?.filename || null,
        attachmentMimeType: attachment?.mimeType || null,
      });
    }
    return res.json({ assignments: result });
  } catch (err) {
    console.error("Teacher assignments error:", err);
    return res.status(500).json({ error: "Failed to load assignments." });
  }
});

router.post("/assignments", async (req, res) => {
  try {
    const { subject, title, content, dueDate, sections } = req.body || {};
    const cleanSections = cleanArray(sections);
    if (!subject || !title || !content || !dueDate || !cleanSections.length) {
      return res.status(400).json({ error: "Subject, title, content, due date, and sections are required." });
    }
    const profile = await teacherProfileFor(req.user);
    const unauthorized = cleanSections.find((section) => !profile.assignedSections.includes(section) && !isAdmin(req.user));
    if (unauthorized) return res.status(403).json({ error: `You are not assigned to section ${unauthorized}.` });

    const id = crypto.randomUUID();
    const stamped = now();
    const assignment = {
      id,
      teacherUserId: req.user.id,
      subject: String(subject).trim(),
      title: String(title).trim(),
      content: String(content).trim(),
      attachmentUrl: req.body.attachmentUrl ? String(req.body.attachmentUrl).trim() : null,
      dueDate: String(dueDate).trim(),
      createdAt: stamped,
      updatedAt: stamped,
    };
    await db.insert(schema.teacherAssignments).values(assignment).run();
    const attachment = normalizeAttachment(req.body.attachment);
    if (attachment) {
      await db.insert(schema.teacherAssignmentAttachments).values({
        id: crypto.randomUUID(),
        assignmentId: id,
        ...attachment,
        createdAt: stamped,
      }).run();
    }
    const students = await db
      .select()
      .from(schema.users)
      .where(inArray(schema.users.section, cleanSections))
      .all();
    const targets = students
      .filter((student) => student.role === "student")
      .map((student) => ({
        id: crypto.randomUUID(),
        assignmentId: id,
        section: student.section,
        studentId: student.id,
        status: "assigned",
        submittedAt: null,
        submissionText: null,
        createdAt: stamped,
        updatedAt: stamped,
      }));
    if (targets.length) await db.insert(schema.teacherAssignmentTargets).values(targets).run();
    const studentUserIds = students
      .filter((student) => student.role === "student")
      .map((student) => student.id);
    if (studentUserIds.length) {
      await createNotifications(
        studentUserIds,
        "teacher_assignment",
        `New assignment: ${assignment.title}`,
        `${assignment.subject} is due ${assignment.dueDate}.`,
        "today",
        assignment.id
      );
    }
    return res.status(201).json({
      success: true,
      assignment: {
        ...assignment,
        targetCount: targets.length,
        hasAttachment: Boolean(attachment),
        attachmentUrl: attachment ? `/api/teacher/assignments/${id}/attachment` : null,
      },
    });
  } catch (err) {
    console.error("Create teacher assignment error:", err);
    return res.status(500).json({ error: "Failed to create assignment." });
  }
});

router.get("/assignments/:id/submissions", async (req, res) => {
  const assignment = await db
    .select()
    .from(schema.teacherAssignments)
    .where(and(eq(schema.teacherAssignments.id, req.params.id), eq(schema.teacherAssignments.teacherUserId, req.user.id)))
    .get();
  if (!assignment) return res.status(404).json({ error: "Assignment not found." });
  const targets = await db
    .select()
    .from(schema.teacherAssignmentTargets)
    .where(eq(schema.teacherAssignmentTargets.assignmentId, assignment.id))
    .all();
  return res.json({ assignment, submissions: targets });
});

router.get("/attendance", async (req, res) => {
  const sessions = await db
    .select()
    .from(schema.attendanceSessions)
    .where(eq(schema.attendanceSessions.teacherUserId, req.user.id))
    .orderBy(desc(schema.attendanceSessions.date))
    .limit(30)
    .all();
  return res.json({ sessions });
});

router.get("/attendance/report", async (req, res) => {
  try {
    const profile = await teacherProfileFor(req.user);
    const section = req.query.section ? String(req.query.section) : null;
    if (section && !await canUseSection(req.user, section, false)) return res.status(403).json({ error: "Section access denied." });
    const from = req.query.from ? String(req.query.from) : "0000-01-01";
    const to = req.query.to ? String(req.query.to) : "9999-12-31";
    const sessions = await db.select().from(schema.attendanceSessions).where(eq(schema.attendanceSessions.teacherUserId, req.user.id)).all();
    const selected = sessions.filter((session) => (!section || session.section === section) && session.date >= from && session.date <= to);
    const records = selected.length ? await db.select().from(schema.attendanceRecords).where(inArray(schema.attendanceRecords.sessionId, selected.map((s) => s.id))).all() : [];
    const students = profile.assignedSections.length ? await db.select().from(schema.users).where(inArray(schema.users.section, profile.assignedSections)).all() : [];
    const byStudent = new Map();
    records.forEach((record) => {
      const item = byStudent.get(record.studentId) || { sessions: 0, present: 0, absent: 0, late: 0, excused: 0 };
      item.sessions += 1;
      item[record.status] = (item[record.status] || 0) + 1;
      byStudent.set(record.studentId, item);
    });
    const summary = students.filter((student) => student.role === "student" && (!section || student.section === section)).map((student) => ({
      studentId: student.studentId,
      displayName: student.displayName || student.studentId,
      section: student.section,
      ...(byStudent.get(student.id) || { sessions: 0, present: 0, absent: 0, late: 0, excused: 0 }),
    }));
    return res.json({ from, to, section, sessions: selected, summary });
  } catch (err) {
    console.error("Attendance report error:", err);
    return res.status(500).json({ error: "Failed to build attendance report." });
  }
});

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

router.get("/exports/attendance.csv", async (req, res) => {
  const report = await (async () => {
    const profile = await teacherProfileFor(req.user);
    const section = req.query.section ? String(req.query.section) : null;
    const sessions = await db.select().from(schema.attendanceSessions).where(eq(schema.attendanceSessions.teacherUserId, req.user.id)).all();
    const selected = sessions.filter((session) => (!section || session.section === section) && (!req.query.from || session.date >= String(req.query.from)) && (!req.query.to || session.date <= String(req.query.to)));
    const records = selected.length ? await db.select().from(schema.attendanceRecords).where(inArray(schema.attendanceRecords.sessionId, selected.map((s) => s.id))).all() : [];
    const students = await db.select().from(schema.users).where(inArray(schema.users.section, profile.assignedSections)).all();
    const names = new Map(students.map((student) => [student.id, student]));
    return records.map((record) => {
      const student = names.get(record.studentId) || {};
      const session = selected.find((item) => item.id === record.sessionId) || {};
      return [student.studentId, student.displayName || student.studentId, student.section, session.date, record.status, record.note];
    });
  })();
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=attendance-export.csv");
  return res.send([["Student ID", "Student", "Section", "Date", "Status", "Note"], ...report].map((row) => row.map(csvEscape).join(",")).join("\n"));
});

router.get("/exports/assignments.csv", async (req, res) => {
  const assignments = await db.select().from(schema.teacherAssignments).where(eq(schema.teacherAssignments.teacherUserId, req.user.id)).orderBy(desc(schema.teacherAssignments.createdAt)).all();
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=assignments-export.csv");
  return res.send([["Subject", "Title", "Due date", "Created"], ...assignments.map((item) => [item.subject, item.title, item.dueDate, item.createdAt])].map((row) => row.map(csvEscape).join(",")).join("\n"));
});

router.post("/attendance", async (req, res) => {
  try {
    const { section, date, title, records } = req.body || {};
    if (!section || !date || !Array.isArray(records)) return res.status(400).json({ error: "Section, date, and records are required." });
    if (!await canUseSection(req.user, section, true)) return res.status(403).json({ error: "Only the class teacher can record attendance for this section." });
    const sessionId = crypto.randomUUID();
    await db.insert(schema.attendanceSessions).values({
      id: sessionId,
      teacherUserId: req.user.id,
      section: String(section),
      date: String(date),
      title: title ? String(title).trim() : "Daily attendance",
      createdAt: now(),
    }).run();
    const roster = await db.select().from(schema.users).where(eq(schema.users.section, section)).all();
    const rosterIds = new Set(roster.filter((student) => student.role === "student").map((student) => student.id));
    const attendanceRecords = records
      .filter((record) => rosterIds.has(record.studentId))
      .map((record) => ({
        id: crypto.randomUUID(),
        sessionId,
        studentId: record.studentId,
        status: ["present", "absent", "late", "excused"].includes(record.status) ? record.status : "present",
        note: record.note ? String(record.note).trim() : null,
        updatedAt: now(),
      }));
    if (attendanceRecords.length) await db.insert(schema.attendanceRecords).values(attendanceRecords).run();
    return res.status(201).json({ success: true, sessionId, count: attendanceRecords.length });
  } catch (err) {
    console.error("Save attendance error:", err);
    return res.status(500).json({ error: "Failed to save attendance." });
  }
});

router.get("/duties", async (req, res) => {
  const duties = await db
    .select()
    .from(schema.teacherDuties)
    .where(eq(schema.teacherDuties.assignedBy, req.user.id))
    .orderBy(desc(schema.teacherDuties.createdAt))
    .all();
  return res.json({ duties });
});

router.post("/duties", async (req, res) => {
  const { title, description, dueDate, section, assigneeId } = req.body || {};
  if (!title) return res.status(400).json({ error: "Duty title is required." });
  if (section && !await canUseSection(req.user, section, true)) return res.status(403).json({ error: "You are not the class teacher for this section." });
  const duty = {
    id: crypto.randomUUID(),
    assignedBy: req.user.id,
    assigneeId: assigneeId || null,
    section: section || null,
    title: String(title).trim(),
    description: description ? String(description).trim() : null,
    dueDate: dueDate || null,
    status: "open",
    createdAt: now(),
    updatedAt: now(),
  };
  await db.insert(schema.teacherDuties).values(duty).run();
  if (duty.assigneeId) await createNotifications([duty.assigneeId], "teacher_duty", `New duty: ${duty.title}`, duty.description || "A duty was assigned to you.", "teacher-duties", duty.id);
  return res.status(201).json({ success: true, duty });
});

router.patch("/duties/:id", async (req, res) => {
  const duty = await db.select().from(schema.teacherDuties).where(and(eq(schema.teacherDuties.id, req.params.id), eq(schema.teacherDuties.assignedBy, req.user.id))).get();
  if (!duty) return res.status(404).json({ error: "Duty not found." });
  const status = ["open", "in_progress", "done", "cancelled"].includes(req.body?.status) ? req.body.status : duty.status;
  await db.update(schema.teacherDuties).set({ status, updatedAt: now() }).where(eq(schema.teacherDuties.id, duty.id)).run();
  return res.json({ success: true, status });
});

router.get("/announcements", async (req, res) => {
  const announcements = await db.select().from(schema.teacherAnnouncements).where(eq(schema.teacherAnnouncements.teacherUserId, req.user.id)).orderBy(desc(schema.teacherAnnouncements.createdAt)).all();
  return res.json({ announcements });
});

router.post("/announcements", async (req, res) => {
  const { section, title, content } = req.body || {};
  if (!section || !title || !content) return res.status(400).json({ error: "Section, title, and content are required." });
  if (!await canUseSection(req.user, section, true)) return res.status(403).json({ error: "Only the class teacher can announce to this section." });
  const announcement = {
    id: crypto.randomUUID(),
    teacherUserId: req.user.id,
    section: String(section),
    title: String(title).trim(),
    content: String(content).trim(),
    createdAt: now(),
  };
  await db.insert(schema.teacherAnnouncements).values(announcement).run();
  const students = await db.select().from(schema.users).where(eq(schema.users.section, section)).all();
  const studentIds = students.filter((student) => student.role === "student").map((student) => student.id);
  if (studentIds.length) await createNotifications(studentIds, "teacher_announcement", announcement.title, announcement.content, "today", announcement.id);
  return res.status(201).json({ success: true, announcement });
});

router.get("/parents", async (req, res) => {
  const profile = await teacherProfileFor(req.user);
  const students = await db.select().from(schema.users).where(inArray(schema.users.section, profile.assignedSections)).all();
  const studentIds = new Set(students.filter((student) => student.role === "student").map((student) => student.studentId));
  const parents = await db.select().from(schema.users).where(eq(schema.users.role, "parent")).all();
  return res.json({
    parents: parents
      .filter((parent) => !parent.section || profile.assignedSections.includes(parent.section) || studentIds.has(parent.studentId))
      .map((parent) => ({ id: parent.id, studentId: parent.studentId, displayName: parent.displayName || parent.studentId, section: parent.section })),
  });
});

router.get("/leave", async (req, res) => {
  const profile = await teacherProfileFor(req.user);
  const requests = await db.select().from(schema.leaveRequests)
    .where(inArray(schema.leaveRequests.section, profile.assignedSections))
    .orderBy(desc(schema.leaveRequests.createdAt)).all();
  const students = await db.select().from(schema.users).where(inArray(schema.users.id, requests.map((item) => item.studentId).filter(Boolean))).all();
  const names = new Map(students.map((student) => [student.id, student]));
  return res.json({ requests: requests.map((request) => ({ ...request, student: names.get(request.studentId)?.displayName || names.get(request.studentId)?.studentId || request.studentId })) });
});

router.patch("/leave/:id", async (req, res) => {
  const request = await db.select().from(schema.leaveRequests).where(eq(schema.leaveRequests.id, req.params.id)).get();
  if (!request) return res.status(404).json({ error: "Leave request not found." });
  if (!await canUseSection(req.user, request.section, true)) return res.status(403).json({ error: "Only the class teacher can approve leave for this section." });
  const status = ["approved", "rejected", "pending"].includes(req.body?.status) ? req.body.status : request.status;
  await db.update(schema.leaveRequests).set({ status, reviewerNote: req.body?.reviewerNote ? String(req.body.reviewerNote).trim() : null, reviewedBy: req.user.id, reviewedAt: now(), updatedAt: now() }).where(eq(schema.leaveRequests.id, request.id)).run();
  await createNotifications([request.studentId], "leave_request_update", `Leave request ${status}`, `Your leave request for ${request.fromDate} to ${request.toDate} was ${status}.`, "leave", request.id);
  return res.json({ success: true, status });
});

module.exports = router;
