/**
 * Rules-first text filter for student messaging and section requests.
 * Uses `profanity-hindi` for Hindi/English abuse, plus an expanded local blocklist
 * for obfuscation, Hinglish/Hindi swear words, and character substitutions.
 */

const { isMessageDirty } = require("profanity-hindi");

const GUIDELINE_MESSAGE =
  "That message can't be sent — it doesn't follow school guidelines. Keep chats about homework only.";

// Comprehensive English + Hinglish / Hindi / Punjabi profanity blocklist
const BAD_WORDS = [
  // English abuse
  "fuck",
  "fucker",
  "fucking",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "dick",
  "dickhead",
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
  "dumbass",
  "jackass",
  "motherfucker",
  "stfu",
  "bullshit",

  // Hindi / Hinglish / Punjabi profanities & variations
  "madarchod",
  "maderchod",
  "madarchode",
  "behenchod",
  "bhenchod",
  "bhenchd",
  "bhen_chod",
  "bhosdike",
  "bhosdi",
  "bhosdika",
  "bhosdiwala",
  "bhosdiwaala",
  "bhosada",
  "chutiya",
  "chutia",
  "chutiyapa",
  "chutiyap",
  "chut",
  "choot",
  "gaand",
  "gand",
  "gandu",
  "gandfat",
  "gandmasti",
  "lund",
  "lauda",
  "laude",
  "lawda",
  "lawde",
  "lodu",
  "lode",
  "randi",
  "randwa",
  "haraami",
  "harami",
  "harambhor",
  "saala",
  "salla",
  "kutte",
  "kutta",
  "kutti",
  "kaminay",
  "kamina",
  "kamini",
  "bhen ke lode",
  "madarjat",
  "tatte",
  "tatta",
  "chood",
  "chod",
  "chode",
  "chodo",
  "bakchod",
  "bakchodi",
];

/**
 * Lowercases, strips zero-width / punctuation noise, collapses repeated letters,
 * normalizes common character substitutions (@, $, 0, 1, 3, 7, !), and inserts spaces.
 * @param {string} text
 * @returns {string}
 */
function normalizeForFilter(text) {
  if (!text || typeof text !== "string") return "";
  let s = text.toLowerCase().normalize("NFKC");
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, "");
  s = s.replace(/[@$0137!]/g, (ch) =>
    ({ "@": "a", "$": "s", "0": "o", "1": "i", "3": "e", "7": "t", "!": "i" }[ch] || ch)
  );
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

  // Library check on the raw message
  try {
    if (isMessageDirty(text)) {
      return { ok: false, reason: GUIDELINE_MESSAGE };
    }
  } catch (err) {
    console.error("[moderation] profanity-hindi failed:", err.message);
  }

  const normalized = normalizeForFilter(text);
  if (!normalized) return { ok: true };

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
    if (normalized.length > compact.length && w.length >= 3 && compact.includes(w)) {
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
