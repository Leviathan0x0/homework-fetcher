const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const { eq, and, desc } = require("drizzle-orm");
const sessionService = require("../auth/sessionService");
const { db, schema } = require("../db/client");
const { resolveUploadDir } = require("../uploads");

const router = express.Router();

// Resolved lazily-safe: never throws on read-only serverless filesystems
const UPLOADS_DIR = resolveUploadDir("classwork").dir;

// File extension & MIME type validation
const ALLOWED_MIME_TYPES = new Set([
  // Images
  "image/png",
  "image/jpeg",
  "image/pjpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt"
]);

// Configure Multer safe storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    // Generate safe UUID filename on disk to prevent path traversal & unsafe user filenames
    const ext = path.extname(file.originalname).toLowerCase();
    const safeFilename = `${crypto.randomUUID()}${ext}`;
    cb(null, safeFilename);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB limit
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype.toLowerCase();

    if (ALLOWED_EXTENSIONS.has(ext) || ALLOWED_MIME_TYPES.has(mime)) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file format. Please upload an image, PDF, or common document file."));
    }
  },
});

/**
 * Middleware: Require valid session authentication.
 */
async function requireAuth(req, res, next) {
  const token = req.cookies?.app_session;
  const activeSession = await sessionService.getAppSession(token);

  if (!activeSession) {
    return res.status(401).json({
      code: "UNAUTHENTICATED",
      message: "Not authenticated. Please sign in."
    });
  }

  req.user = activeSession.user;
  next();
}

/**
 * GET /api/classwork
 * Returns classwork uploads for the authenticated student's section only.
 */
router.get("/classwork", requireAuth, async (req, res) => {
  try {
    const section = req.user.section;
    const { date, subject } = req.query;

    if (!section) {
      return res.json({ section: null, count: 0, classwork: [] });
    }

    let query = await db
      .select()
      .from(schema.classworkUploads)
      .where(eq(schema.classworkUploads.section, section))
      .orderBy(desc(schema.classworkUploads.createdAt));

    const records = query.all();

    // Filter in-memory if optional query params are passed
    const filtered = records.filter((item) => {
      if (date && item.date !== date) return false;
      if (subject && subject !== "All" && item.subject.toLowerCase() !== String(subject).toLowerCase()) return false;
      return true;
    });

    const result = filtered.map((item) => ({
      id: item.id,
      studentId: item.studentId,
      section: item.section,
      subject: item.subject,
      title: item.title,
      date: item.date,
      fileUrl: item.fileUrl,
      originalFilename: item.originalFilename,
      fileSize: item.fileSize,
      mimeType: item.mimeType,
      createdAt: item.createdAt,
      isOwner: item.userId === req.user.id,
    }));

    return res.json({
      section,
      count: result.length,
      classwork: result,
    });
  } catch (err) {
    console.error("Get Classwork Error:", err);
    return res.status(500).json({ error: "Failed to fetch classwork uploads." });
  }
});

/**
 * POST /api/classwork
 * Uploads today's classwork file for a subject.
 */
router.post("/classwork", requireAuth, async (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "File size exceeds limit of 10 MB." });
      }
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ error: err.message || "File upload failed." });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Please select a file to upload." });
    }

    const { subject, title, date } = req.body || {};

    if (!subject || typeof subject !== "string" || !subject.trim()) {
      // Clean up uploaded file if subject is invalid
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "Subject is required." });
    }

    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const todayDate = date && String(date).trim() ? String(date).trim() : now.split("T")[0];

      const newUpload = {
        id,
        userId: req.user.id,
        studentId: req.user.studentId,
        section: req.user.section,
        subject: subject.trim(),
        title: title && typeof title === "string" ? title.trim() : null,
        date: todayDate,
        fileUrl: `/api/classwork/files/${id}`,
        filePath: req.file.path,
        originalFilename: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype || "application/octet-stream",
        createdAt: now,
        updatedAt: now,
      };

      await db.insert(schema.classworkUploads).values(newUpload).run();

      try {
        const sectionUsers = await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.section, newUpload.section))
          .all();
        const otherUserIds = sectionUsers
          .map((u) => u.id)
          .filter((uid) => uid !== req.user.id);
        if (otherUserIds.length > 0) {
          const notifNow = new Date().toISOString();
          for (const uid of otherUserIds) {
            await db.insert(schema.notifications)
              .values({
                id: crypto.randomUUID(),
                userId: uid,
                type: "new_classwork",
                title: `New classwork: ${newUpload.subject}`,
                body: `${req.user.studentId} uploaded ${newUpload.originalFilename}`,
                link: "classwork",
                referenceId: newUpload.id,
                isRead: 0,
                createdAt: notifNow,
              })
              .run();
          }
        }
      } catch (notifErr) {
        console.error("Failed to create classwork notifications:", notifErr.message);
      }

      return res.status(201).json({
        success: true,
        classwork: {
          id: newUpload.id,
          studentId: newUpload.studentId,
          section: newUpload.section,
          subject: newUpload.subject,
          title: newUpload.title,
          date: newUpload.date,
          fileUrl: newUpload.fileUrl,
          originalFilename: newUpload.originalFilename,
          fileSize: newUpload.fileSize,
          mimeType: newUpload.mimeType,
          createdAt: newUpload.createdAt,
          isOwner: true,
        },
      });
    } catch (dbErr) {
      console.error("Save Classwork Error:", dbErr);
      fs.unlink(req.file.path, () => {});
      return res.status(500).json({ error: "Failed to save classwork entry." });
    }
  });
});

/**
 * GET /api/classwork/files/:id
 * Streams or downloads uploaded classwork file.
 * STRICT SECTION AUTHORIZATION: Only students in the same section can download/view.
 */
router.get("/classwork/files/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const item = await db
      .select()
      .from(schema.classworkUploads)
      .where(eq(schema.classworkUploads.id, id))
      .get();

    if (!item) {
      return res.status(404).json({ error: "File not found." });
    }

    // STRICT SECTION AUTHORIZATION ENFORCEMENT
    if (item.section !== req.user.section) {
      return res.status(403).json({ error: "Access denied. File belongs to another section." });
    }

    const absolutePath = path.resolve(item.filePath);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: "File content unavailable on server." });
    }

    const safeFilename = encodeURIComponent(item.originalFilename);

    res.setHeader("Content-Type", item.mimeType);

    // Determine disposition (inline for images/PDFs, attachment for docs)
    const isInline = item.mimeType.startsWith("image/") || item.mimeType === "application/pdf" || item.mimeType === "text/plain";
    const dispositionType = isInline ? "inline" : "attachment";
    res.setHeader("Content-Disposition", `${dispositionType}; filename="${safeFilename}"`);

    return res.sendFile(absolutePath);
  } catch (err) {
    console.error("Stream Classwork File Error:", err);
    return res.status(500).json({ error: "Failed to download file." });
  }
});

/**
 * DELETE /api/classwork/:id
 * Deletes an uploaded classwork entry.
 * STRICT OWNERSHIP ENFORCEMENT: Only the user who uploaded the file can delete it.
 */
router.delete("/classwork/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const item = await db
      .select()
      .from(schema.classworkUploads)
      .where(eq(schema.classworkUploads.id, id))
      .get();

    if (!item) {
      return res.status(404).json({ error: "Classwork entry not found." });
    }

    // STRICT OWNERSHIP ENFORCEMENT
    if (item.userId !== req.user.id) {
      return res.status(403).json({ error: "Unauthorized. You can only delete your own uploads." });
    }

    // Delete file from disk
    if (item.filePath && fs.existsSync(item.filePath)) {
      fs.unlink(item.filePath, (unlinkErr) => {
        if (unlinkErr) console.error("Error unlinking classwork file:", unlinkErr);
      });
    }

    // Delete record from DB
    await db.delete(schema.classworkUploads)
      .where(eq(schema.classworkUploads.id, id))
      .run();

    return res.json({
      success: true,
      message: "Classwork upload deleted successfully."
    });
  } catch (err) {
    console.error("Delete Classwork Error:", err);
    return res.status(500).json({ error: "Failed to delete classwork upload." });
  }
});

module.exports = router;
