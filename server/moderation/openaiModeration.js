/**
 * OpenAI Moderation API (omni-moderation-latest) for text + images.
 * Purpose-built for NSFW / hate / harassment — far cheaper than chat vision.
 */

const fs = require("fs");
const { GUIDELINE_MESSAGE } = require("./badWords");

const MODEL = "omni-moderation-latest";
const ENDPOINT = "https://api.openai.com/v1/moderations";

/** Categories that must hard-block student content. */
const BLOCK_CATEGORIES = [
  "sexual",
  "sexual/minors",
  "hate",
  "hate/threatening",
  "harassment",
  "harassment/threatening",
  "self-harm",
  "self-harm/intent",
  "self-harm/instructions",
  "violence",
  "violence/graphic",
];

let missingKeyWarned = false;

function getApiKey() {
  return (process.env.OPENAI_API_KEY || "").trim();
}

/**
 * @returns {boolean}
 */
function isModerationConfigured() {
  return Boolean(getApiKey());
}

function warnMissingKeyOnce() {
  if (missingKeyWarned) return;
  missingKeyWarned = true;
  console.warn(
    "[moderation] OPENAI_API_KEY is not set — AI text/image checks are skipped. Rules (bad words + file types) still apply. Set OPENAI_API_KEY for production."
  );
}

/**
 * @param {object} result single result from Moderations API
 * @returns {boolean}
 */
function isFlagged(result) {
  if (!result) return false;
  if (result.flagged) return true;
  const cats = result.categories || {};
  return BLOCK_CATEGORIES.some((key) => cats[key] === true);
}

/**
 * @param {Array<object>|string} input
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
async function callModeration(input) {
  const apiKey = getApiKey();
  if (!apiKey) {
    warnMissingKeyOnce();
    return { ok: true };
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, input }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[moderation] OpenAI Moderations HTTP ${res.status}: ${body.slice(0, 300)}`);
    // Fail closed when the key is present but the API errors — school safety.
    return {
      ok: false,
      reason: "Content could not be verified right now. Please try again in a moment.",
    };
  }

  const data = await res.json();
  const result = Array.isArray(data.results) ? data.results[0] : null;
  if (isFlagged(result)) {
    return { ok: false, reason: GUIDELINE_MESSAGE };
  }
  return { ok: true };
}

/**
 * @param {string} text
 */
async function moderateText(text) {
  if (!text || !String(text).trim()) return { ok: true };
  return callModeration(String(text).trim());
}

/**
 * Moderates an image file on disk (or in-memory buffer) via data URL.
 * @param {{ filePath?: string|null, buffer?: Buffer|null, mimeType: string }} options
 */
async function moderateImage({ filePath = null, buffer = null, mimeType }) {
  if (!mimeType || !String(mimeType).startsWith("image/")) {
    return { ok: true };
  }

  let bytes = buffer;
  if (!bytes && filePath) {
    try {
      bytes = fs.readFileSync(filePath);
    } catch (err) {
      console.error("[moderation] Failed to read image for check:", err.message);
      return {
        ok: false,
        reason: "Content could not be verified right now. Please try again in a moment.",
      };
    }
  }
  if (!bytes || !bytes.length) {
    return { ok: true };
  }

  const b64 = Buffer.from(bytes).toString("base64");
  const dataUrl = `data:${mimeType};base64,${b64}`;

  return callModeration([
    {
      type: "image_url",
      image_url: { url: dataUrl },
    },
  ]);
}

module.exports = {
  MODEL,
  isModerationConfigured,
  moderateText,
  moderateImage,
};
