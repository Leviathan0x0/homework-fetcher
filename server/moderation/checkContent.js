/**
 * Single entry for content safety: TypeSafe AI (Jev) for swear words,
 * OpenAI Moderations for image safety.
 *
 * @typedef {{
 *   ok: true
 * } | {
 *   ok: false,
 *   reason: string,
 *   kind: 'text' | 'image',
 *   strikeable?: boolean
 * }} CheckResult
 */

const { GUIDELINE_MESSAGE, checkBadWords } = require("./badWords");
// [OLD CODE COMMENTED OUT]: OpenAI text moderation (replaced by Jev + local fallback)
// const { moderateText } = require("./openaiModeration");
const { moderateImage } = require("./openaiModeration");
const { classifySwear } = require("../typesafe/typesafeClient");

/**
 * Text safety check: Jev first, local rules whenever Jev is unavailable so an
 * outage does not open the floodgates (availability fail-open, not policy).
 * @param {string} trimmed
 * @returns {Promise<{ ok: true } | { ok: false, reason: string, kind: 'text', strikeable: boolean }>}
 */
async function checkTextSafety(trimmed) {
  const swearCheck = await classifySwear(trimmed);
  if (swearCheck.isSwear) {
    return { ok: false, reason: GUIDELINE_MESSAGE, kind: "text", strikeable: true };
  }
  if (!swearCheck.ok) {
    const rules = checkBadWords(trimmed);
    if (!rules.ok) {
      return { ok: false, reason: rules.reason, kind: "text", strikeable: true };
    }
  }
  return { ok: true };
}

/**
 * @param {{
 *   text?: string|null,
 *   filePath?: string|null,
 *   buffer?: Buffer|null,
 *   mimeType?: string|null,
 * }} options
 * @returns {Promise<CheckResult>}
 */
async function checkContent({ text = null, filePath = null, buffer = null, mimeType = null } = {}) {
  const trimmed = typeof text === "string" ? text.trim() : "";

  if (trimmed) {
    const textCheck = await checkTextSafety(trimmed);
    if (!textCheck.ok) return textCheck;
  }

  if (mimeType && String(mimeType).startsWith("image/")) {
    // Photos are the highest-risk channel - always run rigorous image moderation
    // (requires OPENAI_API_KEY; fails closed if verification is unavailable).
    const aiImage = await moderateImage({
      filePath,
      buffer,
      mimeType,
      text: trimmed || null,
    });
    if (!aiImage.ok) {
      return {
        ...aiImage,
        kind: "image",
        // Vulgar / NSFW policy hits count as a strike; verify/size/type failures do not.
        strikeable: aiImage.strikeable === true,
      };
    }
  }

  return { ok: true };
}

/**
 * Convenience for request title + body in one call.
 * @param {string} title
 * @param {string} body
 * @returns {Promise<CheckResult>}
 */
async function checkRequestText(title, body) {
  const combined = [title, body].filter(Boolean).join("\n");
  if (!combined.trim()) return { ok: true };

  // TypeSafe AI (Jev) first, local rules as fallback — same policy as checkContent.
  for (const part of [title, body]) {
    const trimmedPart = typeof part === "string" ? part.trim() : "";
    if (!trimmedPart) continue;
    const textCheck = await checkTextSafety(trimmedPart);
    if (!textCheck.ok) return textCheck;
  }

  return { ok: true };
}

module.exports = {
  GUIDELINE_MESSAGE,
  checkContent,
  checkRequestText,
};
