/**
 * Single entry for content safety: rules first, then OpenAI Moderations.
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

const { checkBadWords, GUIDELINE_MESSAGE } = require("./badWords");
const { moderateText, moderateImage } = require("./openaiModeration");

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
    const rules = checkBadWords(trimmed);
    if (!rules.ok) return { ...rules, kind: "text", strikeable: true };

    // Short plain chat ("ok", "thanks") already passed the blocklist — skip the
    // OpenAI round-trip so everyday messaging stays fast. Longer text and anything
    // with a link still goes through Moderations.
    const needsAiText =
      trimmed.length > 120 || /https?:\/\/|www\./i.test(trimmed);

    if (needsAiText) {
      const aiText = await moderateText(trimmed);
      if (!aiText.ok) {
        return {
          ...aiText,
          kind: "text",
          strikeable: aiText.strikeable !== false,
        };
      }
    }
  }

  if (mimeType && String(mimeType).startsWith("image/")) {
    // Photos are the highest-risk channel — always run rigorous image moderation
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

  const rules = checkBadWords(combined);
  if (!rules.ok) return { ...rules, kind: "text", strikeable: true };

  // Moderate fields separately so short titles aren't diluted by long bodies.
  for (const part of [title, body]) {
    if (!part || !String(part).trim()) continue;
    const ai = await moderateText(String(part).trim());
    if (!ai.ok) {
      return {
        ...ai,
        kind: "text",
        strikeable: ai.strikeable !== false,
      };
    }
  }

  return { ok: true };
}

module.exports = {
  GUIDELINE_MESSAGE,
  checkContent,
  checkRequestText,
};
