/**
 * Rules-first text filter for student messaging and section requests.
 *
 * `profanity-hindi` contains useful English and romanized-Hindi data, but its
 * checker only compares space-delimited tokens. That means its multi-word
 * Hindi entries and punctuation/Unicode evasions are not reliably detected.
 * We compile the package data together with local Indic terms and run every
 * entry through one Unicode-aware matcher instead.
 */

const PACKAGE_ENGLISH_TERMS = Object.keys(
  require("profanity-hindi/data/english-bad-words")
);
const PACKAGE_HINDI_TERMS = Object.keys(
  require("profanity-hindi/data/hindi-bad-words")
);

const GUIDELINE_MESSAGE =
  "That message can't be sent - it doesn't follow school guidelines. Keep chats about homework only.";

// Gaps in the package's English list, including common school-chat shorthand.
const LOCAL_ENGLISH_TERMS = [
  "dumbass",
  "jackass",
  "bullshit",
  "dipshit",
  "fuck off",
  "fuck you",
  "go fuck yourself",
  "hoe",
  "kill yourself",
  "kys",
  "motherfucker",
  "naked",
  "nsfw",
  "nude",
  "nudes",
  "onlyfans",
  "pedo",
  "pedophile",
  "porn",
  "porno",
  "rape",
  "rapist",
  "retard",
  "retarded",
  "screw you",
  "stfu",
  "thot",
  "tits",
  "wtf",
  "xxx",
];

/**
 * Standalone abusive heads and spelling/shorthand variants found in Hindi,
 * Hinglish, Punjabi, Marathi, and Urdu school chat. These are intentionally
 * individual terms: the dependency mostly stores them inside long phrases,
 * which its own token-based checker can never match.
 */
const ROMANIZED_INDIC_TERMS = [
  "aand",
  "bakchod",
  "bakchodi",
  "bakrichod",
  "balatkaar",
  "balatkar",
  "bc",
  "behanchod",
  "behenchod",
  "betichod",
  "bhaand",
  "bhadavya",
  "bhadva",
  "bhadwa",
  "bhadve",
  "bhadwe",
  "bhadwi",
  "bhainchod",
  "bhaynchod",
  "bhenchod",
  "bhenchd",
  "bhnchod",
  "bhnchd",
  "bkl",
  "bhos",
  "bhosad",
  "bhosada",
  "bhosadchod",
  "bhosade",
  "bhosadi",
  "bhosda",
  "bhosdee",
  "bhosdi",
  "bhosdika",
  "bhosdike",
  "bhosdk",
  "bhosra",
  "bhosri",
  "boba",
  "bsdk",
  "bund",
  "chinaal",
  "chinal",
  "chod",
  "choda",
  "chode",
  "chodu",
  "chood",
  "choot",
  "chootia",
  "chootiya",
  "chootiye",
  "chud",
  "chuda",
  "chudasi",
  "chuse",
  "chusu",
  "chut",
  "chute",
  "chutia",
  "chutiya",
  "chutiyap",
  "chutiyapa",
  "chutiye",
  "ctya",
  "fuddi",
  "fudi",
  "fuddu",
  "gaand",
  "gaandu",
  "gand",
  "gandoo",
  "gandu",
  "ghand",
  "gndu",
  "harambhor",
  "haramkhor",
  "harami",
  "haramjada",
  "haramzaada",
  "haramzada",
  "jhaat",
  "jhant",
  "jhantu",
  "jhatoo",
  "jhavadya",
  "kamina",
  "kaminay",
  "kamine",
  "kamini",
  "kanjar",
  "kukarchod",
  "kutha",
  "kuthta",
  "kutta",
  "kutte",
  "kutti",
  "lauda",
  "laude",
  "laudu",
  "lavada",
  "lavadya",
  "lavda",
  "lavde",
  "lawda",
  "lawde",
  "loda",
  "lode",
  "lodu",
  "louda",
  "lowda",
  "lowde",
  "luhnd",
  "lund",
  "lundh",
  "maadar",
  "maadarchod",
  "madar",
  "madarchod",
  "madarchode",
  "madarchoth",
  "madarjat",
  "madarjaat",
  "mader",
  "maderchod",
  "mahder",
  "mc",
  "mdrchd",
  "muttha",
  "penchod",
  "puchi",
  "raand",
  "raandichya",
  "rand",
  "randi",
  "randwa",
  "rnd",
  "saala",
  "saale",
  "saali",
  "sala",
  "salla",
  "suar",
  "suvar",
  "suwar",
  "tatta",
  "tatte",
  "tatti",
];

// Native-script forms cannot be handled by the package's ASCII-only matcher.
const NATIVE_INDIC_TERMS = [
  // Devanagari (Hindi / Marathi)
  "आंड",
  "बलात्कार",
  "बहनचोद",
  "भैनचोद",
  "भेंचोद",
  "बेटीचोद",
  "भड़वा",
  "भडवा",
  "भोसड़ा",
  "भोसडा",
  "भोसड़ी",
  "भोसडी",
  "भोसड़ीके",
  "भोसडिके",
  "छिनाल",
  "चोद",
  "चोदू",
  "चूत",
  "चूतिया",
  "चूतिये",
  "चुतिया",
  "चुद",
  "फुद्दी",
  "फुद्दू",
  "गांड",
  "गाँड",
  "गाण्ड",
  "गांडू",
  "गंडू",
  "हरामखोर",
  "हरामी",
  "हरामजादा",
  "हरामज़ादा",
  "झांट",
  "झाँट",
  "झंटू",
  "कमीना",
  "कमीनी",
  "कमीने",
  "कंजर",
  "कुत्ता",
  "कुत्ती",
  "कुत्ते",
  "लंड",
  "लण्ड",
  "लौड़ा",
  "लौडे",
  "लोडू",
  "मादरचोद",
  "मदरचोद",
  "रांड",
  "रंडी",
  "रण्डी",
  "रंडवा",
  "साला",
  "साले",
  "साली",
  "सुअर",
  "टट्टी",
  "टट्टे",

  // Gurmukhi (Punjabi)
  "ਮਾਦਰਚੋਦ",
  "ਭੈਣਚੋਦ",
  "ਪੈਣਚੋਦ",
  "ਭੋਸੜਾ",
  "ਭੋਸੜੀ",
  "ਚੂਤ",
  "ਚੂਤੀਆ",
  "ਫੁੱਦੀ",
  "ਫੁੱਦੂ",
  "ਗਾਂਡ",
  "ਗਾਂਡੂ",
  "ਹਰਾਮੀ",
  "ਹਰਾਮਜ਼ਾਦਾ",
  "ਕਮੀਨਾ",
  "ਕੁੱਤਾ",
  "ਕੁੱਤੀ",
  "ਲੰਡ",
  "ਲੌੜਾ",
  "ਰੰਡੀ",
  "ਸਾਲਾ",
  "ਸਾਲੀ",
  "ਝਾਂਟ",
  "ਟੱਟੀ",
  "ਭੜਵਾ",
  "ਬੁੰਡ",

  // Perso-Arabic forms commonly used in Hindi/Urdu chat
  "مادرچود",
  "بہنچود",
  "بھوسڑا",
  "بھوسڑی",
  "چوت",
  "چوتیا",
  "گانڈ",
  "لنڈ",
  "لوڑا",
  "رنڈی",
  "حرامی",
  "حرامزادہ",
  "سالہ",
  "کمینہ",
];

/**
 * Common leetspeak and cross-alphabet homoglyphs. NFKD handles full-width and
 * mathematical alphabets; this table covers characters it intentionally does
 * not fold (for example Cyrillic "а" used in an otherwise Latin word).
 */
const CHARACTER_FOLD = Object.freeze({
  "@": "a",
  "4": "a",
  "8": "b",
  "(": "c",
  "3": "e",
  "€": "e",
  "6": "g",
  "9": "g",
  "#": "h",
  "!": "i",
  "1": "i",
  "|": "i",
  "0": "o",
  "$": "s",
  "5": "s",
  "+": "t",
  "7": "t",
  "2": "z",
  "æ": "ae",
  "œ": "oe",
  "ß": "ss",
  "ı": "i",
  "ɑ": "a",
  "а": "a",
  "α": "a",
  "ь": "b",
  "в": "b",
  "β": "b",
  "ϲ": "c",
  "с": "c",
  "ԁ": "d",
  "е": "e",
  "ε": "e",
  "ғ": "f",
  "ɡ": "g",
  "һ": "h",
  "і": "i",
  "ї": "i",
  "ι": "i",
  "ј": "j",
  "κ": "k",
  "ӏ": "l",
  "м": "m",
  "ո": "n",
  "о": "o",
  "ο": "o",
  "օ": "o",
  "р": "p",
  "ρ": "p",
  "ԛ": "q",
  "г": "r",
  "ѕ": "s",
  "т": "t",
  "τ": "t",
  "υ": "u",
  "ս": "u",
  "ν": "v",
  "ԝ": "w",
  "х": "x",
  "χ": "x",
  "у": "y",
  "ү": "y",
  "ᴢ": "z",
  "ζ": "z",
});

/**
 * Canonicalizes case, width, Latin diacritics, leetspeak, homoglyphs, invisible
 * formatting characters, and punctuation while preserving native Indic text.
 * @param {string} text
 * @returns {string}
 */
function normalizeForFilter(text) {
  if (!text || typeof text !== "string") return "";

  let normalized = text.toLowerCase().normalize("NFKD");

  // Strip accents from Latin characters without destroying Indic vowel marks.
  normalized = normalized.replace(/(\p{Script=Latin})\p{M}+/gu, "$1");
  normalized = normalized.replace(/\p{Cf}/gu, "");
  normalized = normalized.replace(/[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu, "");
  normalized = Array.from(
    normalized,
    (character) => CHARACTER_FOLD[character] || character
  ).join("");
  normalized = normalized.replace(/[^\p{L}\p{M}\p{N}]+/gu, " ");
  normalized = normalized.replace(/([\p{L}\p{M}\p{N}])\1{2,}/gu, "$1$1");
  return normalized.replace(/\s+/g, " ").trim();
}

/**
 * Builds an exact token/phrase matcher that also permits separators and
 * repeated characters between every expected character. For example, the
 * same compiled entry catches ordinary, stretched, dotted, and spaced forms.
 * @param {string} term
 * @returns {RegExp|null}
 */
function compileTerm(term) {
  const characters = Array.from(normalizeForFilter(term).replace(/\s/g, ""));
  if (!characters.length) return null;

  const body = characters
    // Input runs are capped at two above. A bounded quantifier still catches
    // stretched letters while avoiding pathological regex backtracking.
    .map((character) => `${escapeRegex(character)}{1,2}`)
    .join("\\s*");

  // Digits are intentionally allowed at the boundary so numeric padding does
  // not turn a blocked word into a new token. Letter/mark boundaries prevent
  // short terms such as "ass" from matching innocent words like "class".
  return new RegExp(
    `(?<![\\p{L}\\p{M}])${body}(?![\\p{L}\\p{M}])`,
    "u"
  );
}

const ALL_TERMS = [
  ...PACKAGE_ENGLISH_TERMS,
  ...PACKAGE_HINDI_TERMS,
  ...LOCAL_ENGLISH_TERMS,
  ...ROMANIZED_INDIC_TERMS,
  ...NATIVE_INDIC_TERMS,
];

const TERM_PATTERNS = Array.from(
  new Map(
    ALL_TERMS.map((term) => [normalizeForFilter(term).replace(/\s/g, ""), term])
  ).values()
)
  .map(compileTerm)
  .filter(Boolean);

/**
 * @param {string} text
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function checkBadWords(text) {
  if (!text || typeof text !== "string" || !text.trim()) return { ok: true };

  const separatorFold = text.replace(/[\d@$€#!|+()]/g, " ");
  const edgePaddingFold = text.replace(
    /(?<![\p{L}\p{M}])[\d@$€#!|+()]+|[\d@$€#!|+()]+(?![\p{L}\p{M}])/gu,
    " "
  );

  // Interpret ambiguous leet characters three ways: as substitutions, as
  // separators, and as removable token-edge padding. This catches internal
  // leetspeak, inserted digits, and mixed forms such as "sh1t123".
  const candidates = new Set([
    normalizeForFilter(text),
    normalizeForFilter(separatorFold),
    normalizeForFilter(edgePaddingFold),
  ]);
  candidates.delete("");
  if (!candidates.size) return { ok: true };

  if (
    Array.from(candidates).some((candidate) =>
      TERM_PATTERNS.some((pattern) => pattern.test(candidate))
    )
  ) {
    return { ok: false, reason: GUIDELINE_MESSAGE };
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
