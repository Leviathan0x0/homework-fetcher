/**
 * Rules-first text filter for student messaging and section requests.
 * Uses `profanity-hindi` for Hindi/English abuse, plus a local blocklist
 * for obfuscation and gaps the library misses.
 */

const { isMessageDirty } = require("profanity-hindi");

const GUIDELINE_MESSAGE =
  "That message can’t be sent — it doesn’t follow school guidelines. Keep chats about homework only.";

// Extra English + school-chat slang / obfuscation gaps beyond profanity-hindi.
const BAD_WORDS = [
  "fuck",
  "fucker",
  "fucking",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "dick",
  "cock",
  "pussy",
  "cunt",
  "slut",
  "whore",
  "nigger",
  "nigga",
  "retard",
  "retarded",
  "faggot",
  "fag",
  "rape",
  "rapist",
  "porn",
  "porno",
  "xxx",
  "nude",
  "nudes",
  "naked",
  "boobs",
  "tits",
  "blowjob",
  "handjob",
  "onlyfans",
  "hentai",
  "nsfw",
  "kill yourself",
  "kys",
  "madarchod",
  "behenchod",
  "bhenchod",
  "bhosdike",
  "bhosdi",
  "chutiya",
  "chutia",
  "gaand",
  "gand",
  "lund",
  "lawda",
  "laude",
  "randi",
  "haraami",
  "harami",
  "saala",
  "kutte",
  "kutta",
];

/**
 * Lowercases, strips zero-width / punctuation noise, collapses repeated letters,
 * and inserts spaces so spaced-out abuse ("f u c k") still matches.
 * @param {string} text
 * @returns {string}
 */
function normalizeForFilter(text) {
  if (!text || typeof text !== "string") return "";
  let s = text.toLowerCase().normalize("NFKC");
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, "");
  s = s.replace(/[@$0]/g, (ch) => ({ "@": "a", $: "s", "0": "o" }[ch]));
  s = s.replace(/[^a-z0-9\s]/g, " ");
  s = s.replace(/(.)\1{2,}/g, "$1$1");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * @param {string} text
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function checkBadWords(text) {
  if (!text || typeof text !== "string" || !text.trim()) return { ok: true };

  // Library check on the raw message (Hindi romanized + common English abuse).
  try {
    if (isMessageDirty(text)) {
      return { ok: false, reason: GUIDELINE_MESSAGE };
    }
  } catch (err) {
    console.error("[moderation] profanity-hindi failed:", err.message);
  }

  const normalized = normalizeForFilter(text);
  if (!normalized) return { ok: true };

  // Spaced-out abuse only: "f u c k" → compact "fuck". Avoid naive substring
  // checks on the spaced string (e.g. biology "sexual reproduction").
  const compact = normalized.replace(/\s+/g, "");
  for (const word of BAD_WORDS) {
    const w = word.toLowerCase();
    if (w.includes(" ")) {
      if (normalized.includes(w)) {
        return { ok: false, reason: GUIDELINE_MESSAGE };
      }
      continue;
    }
    const re = new RegExp(`(?:^|\\s)${escapeRegex(w)}(?:$|\\s)`, "i");
    if (re.test(normalized)) {
      return { ok: false, reason: GUIDELINE_MESSAGE };
    }
    // Obfuscation path: source had spaces between letters ("f u c k" → "fuck").
    // Only when spacing was present, so normal phrases aren't substring-matched.
    if (normalized.length > compact.length && w.length >= 4 && compact.includes(w)) {
      return { ok: false, reason: GUIDELINE_MESSAGE };
    }
  }
  return { ok: true };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  GUIDELINE_MESSAGE,
  checkBadWords,
  normalizeForFilter,
};
