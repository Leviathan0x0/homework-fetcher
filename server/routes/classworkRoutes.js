const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const multer = require("multer");
const { eq, desc } = require("drizzle-orm");
const { requireAuth } = require("../auth/requireAuth");
const { db, schema, isRemote } = require("../db/client");
const { resolveUploadDir, isServerless } = require("../uploads");
const {
  applyDownloadHeaders,
  readFileHead,
  resolveUploadType,
  uploadFileFilter,
} = require("../files/fileTypes");
const { MAX_UPLOAD_BYTES, rateLimit } = require("../limits");
const { checkContent } = require("../moderation/checkContent");
const { recordProfanityStrike, withStrikeWarning } = require("../moderation/flagLogService");

const router = express.Router();

// Same rule as message attachments: without a persistent volume, store bytes in
// the hosted database so classwork photos/PDFs survive serverless refreshes.
const STORE_CLASSWORK_IN_DB = !process.env.UPLOADS_DIR && (isRemote || isServerless);

const UPLOADS_DIR = STORE_CLASSWORK_IN_DB
  ? path.join(os.tmpdir(), "homework-fetcher-uploads", "classwork")
  : resolveUploadDir("classwork").dir;

const storage = STORE_CLASSWORK_IN_DB
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
      },
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${crypto.randomUUID()}${ext}`);
      },
    });

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
  },
  fileFilter: uploadFileFilter,
});

function cleanupUpload(file) {
  if (file?.path) fs.unlink(file.path, () => {});
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

    const records = await db
      .select()
      .from(schema.classworkUploads)
      .where(eq(schema.classworkUploads.section, section))
      .orderBy(desc(schema.classworkUploads.createdAt))
      .all();

    const filtered = records.filter((item) => {
      if (date && item.date !== date) return false;
      if (subject && subject !== "All" && item.subject.toLowerCase() !== String(subject).toLowerCase()) {
        return false;
      }
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
        cleanupUpload(req.file);
        return res.status(400).json({ error: "Subject is required." });
      }

      try {
        const resolved = resolveUploadType(req.file.originalname);
        if (!resolved) {
          cleanupUpload(req.file);
          return res.status(400).json({ error: "Only homework PDFs and photos (JPG, PNG, or WebP) can be shared here." });
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const todayDate = date && String(date).trim() ? String(date).trim() : now.split("T")[0];
        const trimmedTitle = title && typeof title === "string" ? title.trim() : null;
        const mimeType = resolved.contentType;

        const safety = await checkContent({
          text: [subject.trim(), trimmedTitle].filter(Boolean).join("\n"),
          filePath: req.file.path || null,
          buffer: req.file.buffer || null,
          mimeType,
        });
        if (!safety.ok) {
          cleanupUpload(req.file);
          if (safety.strikeable) {
            try {
              const strike = await recordProfanityStrike({
                userId: req.user.id,
                studentId: req.user.studentId,
                section: req.user.section,
                source: "classwork",
                snippet:
                  safety.kind === "image"
                    ? `[blocked image] ${req.file.originalname}`
                    : [subject.trim(), trimmedTitle].filter(Boolean).join("\n"),
              });
              return res.status(400).json({ error: withStrikeWarning(safety.reason, strike) });
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
          filePath: STORE_CLASSWORK_IN_DB ? "db" : req.file.path,
          originalFilename: req.file.originalname,
          fileSize: req.file.size,
          mimeType,
          createdAt: now,
          updatedAt: now,
        };

        await db.insert(schema.classworkUploads).values(newUpload).run();

        if (STORE_CLASSWORK_IN_DB) {
          await db
            .insert(schema.classworkAttachments)
            .values({
              classworkId: id,
              data: req.file.buffer.toString("base64"),
              createdAt: now,
            })
            .run();
        }

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
              await db
                .insert(schema.notifications)
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
        cleanupUpload(req.file);
        return res.status(500).json({ error: "Failed to save classwork entry." });
      }
    });
  }
);

/**
 * GET /api/classwork/files/:id
 * Streams or downloads uploaded classwork file.
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

    if (item.section !== req.user.section) {
      return res.status(403).json({ error: "Access denied. File belongs to another section." });
    }

    // 1. Bytes stored in the database (serverless / hosted DB without UPLOADS_DIR)
    const stored = await db
      .select()
      .from(schema.classworkAttachments)
      .where(eq(schema.classworkAttachments.classworkId, id))
      .get();

    if (stored) {
      const buffer = Buffer.from(stored.data, "base64");
      applyDownloadHeaders(res, {
        contentType: item.mimeType,
        filename: item.originalFilename,
        head: buffer.subarray(0, 16),
      });
      res.setHeader("Content-Length", String(buffer.length));
      return res.send(buffer);
    }

    // 2. On-disk file (persistent volume / local uploads/)
    if (item.filePath && item.filePath !== "db" && fs.existsSync(item.filePath)) {
      applyDownloadHeaders(res, {
        contentType: item.mimeType,
        filename: item.originalFilename,
        head: readFileHead(item.filePath),
      });
      return res.sendFile(path.resolve(item.filePath));
    }

    return res.status(404).json({ error: "File content unavailable on server." });
  } catch (err) {
    console.error("Stream Classwork File Error:", err);
    return res.status(500).json({ error: "Failed to download file." });
  }
});

/**
 * DELETE /api/classwork/:id
 * Deletes an uploaded classwork entry.
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

    if (item.userId !== req.user.id) {
      return res.status(403).json({ error: "Unauthorized. You can only delete your own uploads." });
    }

    await db
      .delete(schema.classworkAttachments)
      .where(eq(schema.classworkAttachments.classworkId, id))
      .run();

    if (item.filePath && item.filePath !== "db" && fs.existsSync(item.filePath)) {
      fs.unlink(item.filePath, (unlinkErr) => {
        if (unlinkErr) console.error("Error unlinking classwork file:", unlinkErr);
      });
    }

    await db.delete(schema.classworkUploads).where(eq(schema.classworkUploads.id, id)).run();

    return res.json({
      success: true,
      message: "Classwork upload deleted successfully.",
    });
  } catch (err) {
    console.error("Delete Classwork Error:", err);
    return res.status(500).json({ error: "Failed to delete classwork upload." });
  }
});

module.exports = router;
