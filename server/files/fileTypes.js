const fs = require("fs");
const path = require("path");

/**
 * Upload type policy shared by classwork and message attachments.
 *
 * The content type a browser declares at upload time is attacker controlled,
 * so it is never stored and never echoed back. The file extension decides both
 * whether an upload is accepted and which content type the server will serve.
 */

// Extension -> the only content type the server will ever serve for it.
const ALLOWED_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".pdf", "application/pdf"],
  [".txt", "text/plain"],
  [".csv", "text/csv"],
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
]);

// SVG is intentionally absent: it is an XML document that renders as a page on
// the app origin, which makes it a phishing and scripting surface.

// Only these render safely in a browser. Everything else is downloaded.
const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

const UNSUPPORTED_FILE_MESSAGE =
  "Unsupported file format. Please upload an image, PDF, or common document file.";

/**
 * Resolves the server-chosen content type for an uploaded filename.
 * @param {string} originalName
 * @returns {{ext: string, contentType: string}|null} null when not allowed
 */
function resolveUploadType(originalName) {
  const ext = path.extname(originalName || "").toLowerCase();
  const contentType = ALLOWED_TYPES.get(ext);
  if (!contentType) return null;
  return { ext, contentType };
}

/**
 * Multer fileFilter enforcing the extension allowlist.
 */
function uploadFileFilter(req, file, cb) {
  if (resolveUploadType(file.originalname)) {
    cb(null, true);
  } else {
    cb(new Error(UNSUPPORTED_FILE_MESSAGE));
  }
}

const MAGIC_BYTES = [
  { type: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { type: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { type: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
];

/**
 * Confirms that the first bytes of a file match the content type the server
 * intends to serve inline. Anything unrecognised is treated as a download.
 * @param {Buffer|null} head first bytes of the file
 * @param {string} contentType
 * @returns {boolean}
 */
function matchesMagicBytes(head, contentType) {
  if (!head || head.length < 4) return false;
  if (contentType === "image/webp") {
    return (
      head.length >= 12 &&
      head.toString("ascii", 0, 4) === "RIFF" &&
      head.toString("ascii", 8, 12) === "WEBP"
    );
  }
  const signature = MAGIC_BYTES.find((entry) => entry.type === contentType);
  if (!signature) return false;
  return signature.bytes.every((byte, i) => head[i] === byte);
}

/**
 * Writes the response headers for a stored upload.
 *
 * Uploads are served from the same origin as the API, so every response is
 * pinned to a server-chosen type, marked `nosniff`, and sandboxed into an
 * opaque origin. Only verified images and PDFs are allowed to render inline;
 * everything else downloads instead of becoming a page on this origin.
 *
 * @param {import("express").Response} res
 * @param {{contentType: string, filename: string, head?: Buffer|null}} options
 */
function applyDownloadHeaders(res, { contentType, filename, head = null }) {
  const inline = INLINE_TYPES.has(contentType) && matchesMagicBytes(head, contentType);
  const servedType = inline ? contentType : "application/octet-stream";
  const safeFilename = encodeURIComponent(filename || "download");

  res.setHeader("Content-Type", servedType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename*=UTF-8''${safeFilename}`
  );
}

/**
 * Reads the leading bytes of a stored file so its type can be verified before
 * it is served inline.
 * @param {string} filePath
 * @returns {Buffer|null}
 */
function readFileHead(filePath, length = 16) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
}

module.exports = {
  ALLOWED_TYPES,
  INLINE_TYPES,
  UNSUPPORTED_FILE_MESSAGE,
  applyDownloadHeaders,
  matchesMagicBytes,
  readFileHead,
  resolveUploadType,
  uploadFileFilter,
};
