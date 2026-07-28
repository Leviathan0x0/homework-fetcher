const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const { eq, and, desc } = require("drizzle-orm");
const sessionService = require("../auth/sessionService");
const { requireAuth } = require("../auth/requireAuth");
const { db, schema } = require("../db/client");
const { resolveUploadDir } = require("../uploads");
const {
  applyDownloadHeaders,
  readFileHead,
  resolveUploadType,
  uploadFileFilter,
} = require("../files/fileTypes");
const { MAX_UPLOAD_BYTES, rateLimit } = require("../limits");
const { checkContent } = require("../moderation/checkContent");
const { recordProfanityStrike } = require("../moderation/flagLogService");

const router = express.Router();

// Resolved lazily-safe: never throws on read-only serverless filesystems
const UPLOADS_DIR = resolveUploadDir("classwork").dir;

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
    fileSize: MAX_UPLOAD_BYTES,
  },
  // The extension allowlist is authoritative. The browser-declared MIME type
  // is attacker controlled, so accepting a file because that value looks
  // reasonable would let any extension through.
  fileFilter: uploadFileFilter,
});

/**
 * Middleware: Require valid session authentication.
 */

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

    const records = await db
      .select()
      .from(schema.classworkUploads)
      .where(eq(schema.classworkUploads.section, section))
      .orderBy(desc(schema.classworkUploads.createdAt))
      .all();

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
router.post(
  "/classwork",
  requireAuth,
  rateLimit({ name: "upload-classwork", windowMs: 60 * 1000, max: 20 }),
  async (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      const tooLarge = err.code === "LIMIT_FILE_SIZE";
      return res.status(tooLarge ? 413 : 400).json({
        error: tooLarge
          ? `Uploads are limited to ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB. Photos are compressed automatically — try re-selecting the file.`
          : err.message || "File upload failed.",
      });
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
      const trimmedTitle = title && typeof title === "string" ? title.trim() : null;
      const mimeType = resolveUploadType(req.file.originalname).contentType;

      const safety = await checkContent({
        text: [subject.trim(), trimmedTitle].filter(Boolean).join("\n"),
        filePath: req.file.path,
        mimeType,
      });
      if (!safety.ok) {
        fs.unlink(req.file.path, () => {});
        if (safety.kind === "text") {
          try {
            await recordProfanityStrike({
              userId: req.user.id,
              studentId: req.user.studentId,
              section: req.user.section,
              source: "classwork",
              snippet: [subject.trim(), trimmedTitle].filter(Boolean).join("\n"),
            });
          } catch (strikeErr) {
            console.error("Profanity strike log failed:", strikeErr.message);
          }
        }
        return res.status(400).json({ error: safety.reason });
      }

      const newUpload = {
        id,
        userId: req.user.id,
        studentId: req.user.studentId,
        section: req.user.section,
        subject: subject.trim(),
        title: trimmedTitle,
        date: todayDate,
        fileUrl: `/api/classwork/files/${id}`,
        filePath: req.file.path,
        originalFilename: req.file.originalname,
        fileSize: req.file.size,
        // Derived from the extension allowlist, never from the value the
        // browser declared, because this is what gets served back.
        mimeType,
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

    applyDownloadHeaders(res, {
      contentType: item.mimeType,
      filename: item.originalFilename,
      head: readFileHead(absolutePath),
    });

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
