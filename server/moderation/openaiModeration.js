/**
 * OpenAI Moderation API (omni-moderation-latest) for text + images.
 * Purpose-built for NSFW / hate / harassment - far cheaper than chat vision.
 *
 * Photos are stricter than text: missing API key, read failures, and borderline
 * sexual/violence scores all hard-block. Homework sharing must stay clean.
 */

const fs = require("fs");
const { GUIDELINE_MESSAGE } = require("./badWords");
const { matchesMagicBytes } = require("../files/fileTypes");

const MODEL = "omni-moderation-latest";
const ENDPOINT = "https://api.openai.com/v1/moderations";

const VERIFY_FAILED_MESSAGE =
  "We couldn’t check that photo right now. Please try again in a moment.";

/** Categories that must hard-block when OpenAI sets them true. */
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
  "illicit",
  "illicit/violent",
];

/**
 * Score ceilings for images - below OpenAI’s default flag thresholds so
 * borderline NSFW is blocked for a school app. Tuned for homework photos.
 */
const IMAGE_SCORE_LIMITS = {
  sexual: 0.12,
  "sexual/minors": 0.01,
  violence: 0.35,
  "violence/graphic": 0.2,
  "self-harm": 0.12,
  "self-harm/intent": 0.08,
  "self-harm/instructions": 0.08,
};

/** Milder ceilings for text-only (rules + profanity-hindi already catch a lot). */
const TEXT_SCORE_LIMITS = {
  sexual: 0.25,
  "sexual/minors": 0.05,
  "harassment/threatening": 0.4,
  "hate/threatening": 0.35,
  "self-harm/intent": 0.2,
  "self-harm/instructions": 0.2,
};

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
    "[moderation] OPENAI_API_KEY is not set - AI text checks are skipped; photo uploads are blocked until it is set."
  );
}

/**
 * @param {object|null} result
 * @param {Record<string, number>} scoreLimits
 * @returns {boolean}
 */
function shouldBlock(result, scoreLimits) {
  if (!result) return true;
  if (result.flagged) return true;

  const cats = result.categories || {};
  if (BLOCK_CATEGORIES.some((key) => cats[key] === true)) return true;

  const scores = result.category_scores || {};
  for (const [key, limit] of Object.entries(scoreLimits)) {
    const score = Number(scores[key] || 0);
    if (score >= limit) return true;
  }
  return false;
}

/**
 * @param {Array<object>|string} input
 * @param {{ requireKey?: boolean, scoreLimits?: Record<string, number>, failReason?: string }} options
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
async function callModeration(input, options = {}) {
  const {
    requireKey = false,
    scoreLimits = TEXT_SCORE_LIMITS,
    failReason = GUIDELINE_MESSAGE,
  } = options;

  const apiKey = getApiKey();
  if (!apiKey) {
    warnMissingKeyOnce();
    if (requireKey) {
      return { ok: false, reason: VERIFY_FAILED_MESSAGE, strikeable: false };
    }
    return { ok: true };
  }

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, input }),
    });
  } catch (err) {
    console.error("[moderation] OpenAI Moderations network error:", err.message);
    return {
      ok: false,
      reason: requireKey ? VERIFY_FAILED_MESSAGE : "Content could not be verified right now. Please try again in a moment.",
      strikeable: false,
    };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[moderation] OpenAI Moderations HTTP ${res.status}: ${body.slice(0, 300)}`);
    return {
      ok: false,
      reason: requireKey ? VERIFY_FAILED_MESSAGE : "Content could not be verified right now. Please try again in a moment.",
      strikeable: false,
    };
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    console.error("[moderation] Invalid Moderations JSON:", err.message);
    return {
      ok: false,
      reason: requireKey ? VERIFY_FAILED_MESSAGE : GUIDELINE_MESSAGE,
      strikeable: false,
    };
  }

  const result = Array.isArray(data.results) ? data.results[0] : null;
  if (shouldBlock(result, scoreLimits)) {
    // Policy block (vulgar / NSFW / abuse) - counts toward staff strikes.
    return { ok: false, reason: failReason, strikeable: true };
  }
  return { ok: true };
}

/**
 * @param {string} text
 */
async function moderateText(text) {
  if (!text || !String(text).trim()) return { ok: true };
  return callModeration(String(text).trim(), {
    requireKey: false,
    scoreLimits: TEXT_SCORE_LIMITS,
    failReason: GUIDELINE_MESSAGE,
  });
}

/**
 * Rigorous image moderation. Always requires OPENAI_API_KEY.
 * Optional caption/text is sent with the image for multimodal context.
 *
 * @param {{
 *   filePath?: string|null,
 *   buffer?: Buffer|null,
 *   mimeType: string,
 *   text?: string|null,
 * }} options
 */
async function moderateImage({ filePath = null, buffer = null, mimeType, text = null }) {
  if (!mimeType || !String(mimeType).startsWith("image/")) {
    return { ok: true };
  }

  let bytes = buffer;
  if (!bytes && filePath) {
    try {
      bytes = fs.readFileSync(filePath);
    } catch (err) {
      console.error("[moderation] Failed to read image for check:", err.message);
      return { ok: false, reason: VERIFY_FAILED_MESSAGE, strikeable: false };
    }
  }
  if (!bytes || !bytes.length) {
    return { ok: false, reason: VERIFY_FAILED_MESSAGE, strikeable: false };
  }

  // Reject polyglot / spoofed "images" before spending an API call.
  const head = Buffer.isBuffer(bytes) ? bytes.subarray(0, 16) : Buffer.from(bytes).subarray(0, 16);
  if (!matchesMagicBytes(head, mimeType)) {
    return {
      ok: false,
      reason: "Only real homework photo files (JPG, PNG, WebP) are allowed.",
      strikeable: false,
    };
  }

  // Cap payload size for Moderation API (docs allow up to 20MB; we keep smaller).
  const MAX_IMAGE_MODERATION_BYTES = 8 * 1024 * 1024;
  if (bytes.length > MAX_IMAGE_MODERATION_BYTES) {
    return {
      ok: false,
      reason: "That photo is too large to verify. Please compress it and try again.",
      strikeable: false,
    };
  }

  const b64 = Buffer.from(bytes).toString("base64");
  const dataUrl = `data:${mimeType};base64,${b64}`;

  /** @type {Array<object>} */
  const input = [];
  const caption = typeof text === "string" ? text.trim() : "";
  if (caption) {
    input.push({ type: "text", text: caption });
  }
  input.push({
    type: "image_url",
    image_url: { url: dataUrl },
  });

  return callModeration(input, {
    requireKey: true,
    scoreLimits: IMAGE_SCORE_LIMITS,
    failReason: GUIDELINE_MESSAGE,
  });
}

module.exports = {
  MODEL,
  IMAGE_SCORE_LIMITS,
  TEXT_SCORE_LIMITS,
  isModerationConfigured,
  moderateText,
  moderateImage,
};
