const fs = require("fs");
const os = require("os");
const path = require("path");

const isServerless =
  !!process.env.VERCEL ||
  !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
  !!process.env.LAMBDA_TASK_ROOT ||
  !!process.env.NOW_BUILDER;

/**
 * Resolves a writable directory for uploaded files.
 *
 * Serverless deployments bundle the code on a read-only filesystem, so creating
 * a directory next to the source would throw while the module is being loaded
 * and take the whole API down. Candidates are therefore tried in order and the
 * temporary directory is used as a last resort.
 *
 * @param {string} subdirectory e.g. "messages" or "classwork"
 * @returns {{dir: string, persistent: boolean}}
 */
function resolveUploadDir(subdirectory) {
  const configuredRoot = process.env.UPLOADS_DIR;
  const candidates = [];

  if (configuredRoot) candidates.push({ root: configuredRoot, persistent: true });
  if (!isServerless) candidates.push({ root: path.join(__dirname, "../uploads"), persistent: true });
  candidates.push({ root: path.join(os.tmpdir(), "homework-fetcher-uploads"), persistent: false });

  for (const candidate of candidates) {
    const dir = path.join(candidate.root, subdirectory);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return { dir, persistent: candidate.persistent };
    } catch (err) {
      console.error(`Uploads directory ${dir} is not usable: ${err.message}`);
    }
  }

  // Nothing was writable; return the temp path so callers can still report a
  // useful error instead of crashing at import time.
  return { dir: path.join(os.tmpdir(), "homework-fetcher-uploads", subdirectory), persistent: false };
}

module.exports = { resolveUploadDir, isServerless };
