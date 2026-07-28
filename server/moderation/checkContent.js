/**
 * Single entry for content safety: rules first, then OpenAI Moderations.
 *
 * @typedef {{ ok: true } | { ok: false, reason: string }} CheckResult
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
    if (!rules.ok) return rules;

    const aiText = await moderateText(trimmed);
    if (!aiText.ok) return aiText;
  }

  if (mimeType && String(mimeType).startsWith("image/")) {
    const aiImage = await moderateImage({ filePath, buffer, mimeType });
    if (!aiImage.ok) return aiImage;
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
  if (!rules.ok) return rules;

  // Moderate fields separately so short titles aren't diluted by long bodies.
  for (const part of [title, body]) {
    if (!part || !String(part).trim()) continue;
    const ai = await moderateText(String(part).trim());
    if (!ai.ok) return ai;
  }

  return { ok: true };
}

module.exports = {
  GUIDELINE_MESSAGE,
  checkContent,
  checkRequestText,
};
