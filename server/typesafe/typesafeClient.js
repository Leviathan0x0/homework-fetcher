/**
 * TypeSafe AI (Jev System One) client for:
 * 1. Swear words & profanity filtering (noul primitive)
 * 2. Homework subject classification (choice primitive)
 * 3. Formatting verdict (noul primitive), asked together with the subject
 *    in a single request so the homework pass only pays for one Jev call
 *    per text (Jev token spend has to stay bounded).
 */

const DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_TIMEOUT_MS = parseInt(process.env.TYPESAFE_TIMEOUT_MS || "8000", 10);
const RETRY_DELAY_MS = process.env.NODE_ENV === "test" ? 10 : 300;
const SUBJECT_FAILURE_THRESHOLD = 3;
const SUBJECT_COOLDOWN_MS = 30 * 1000;

const CANONICAL_SUBJECTS = [
  "Computers",
  "Biology",
  "Chemistry",
  "Physics",
  "English",
  "Geography",
  "Economics",
  "History",
  "Civics",
  "Mathematics",
  "Hindi",
  "Physical Edu.",
  "Punjabi",
  "Art Education",
  "Kaushal Vikas",
  "Library",
  "Aptitude",
  "Life Skills",
  "Dance",
  "Yoga",
  "EVS",
  "Social Science",
  "Science",
];

const ROMAN_MAP = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8,
  IX: 9, X: 10, XI: 11, XII: 12,
};

// In-memory caching for subject, formatting verdict, and swear classifications
const subjectCache = new Map();
const swearCache = new Map();
const formatCache = new Map();
const MAX_CACHE_ENTRIES = 1000;

// Circuit breaker scoped to classifySubject only. Swear checks keep their own
// error path. Failures accumulate; open state answers "School Diary" without
// caching so recovery is not delayed by a bad verdict.
let subjectFailures = 0;
let subjectCooldownUntil = 0;

function clearCache() {
  subjectCache.clear();
  swearCache.clear();
  formatCache.clear();
  subjectFailures = 0;
  subjectCooldownUntil = 0;
}

function noteSubjectFailure() {
  subjectFailures++;
  if (subjectFailures >= SUBJECT_FAILURE_THRESHOLD) {
    subjectCooldownUntil = Date.now() + SUBJECT_COOLDOWN_MS;
    subjectFailures = 0;
  }
}

function noteSubjectSuccess() {
  subjectFailures = 0;
  subjectCooldownUntil = 0;
}

function getCachedSubject(text, usePolSci) {
  const key = `${usePolSci ? "POLSCI" : "CIVICS"}\u0000${text}`;
  return subjectCache.get(key);
}

function setCachedSubject(text, usePolSci, subject) {
  if (subjectCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = subjectCache.keys().next().value;
    subjectCache.delete(firstKey);
  }
  const key = `${usePolSci ? "POLSCI" : "CIVICS"}\u0000${text}`;
  subjectCache.set(key, subject);
}

function getCachedFormat(text) {
  if (!formatCache.has(text)) return undefined;
  return formatCache.get(text);
}

function setCachedFormat(text, isFormatted) {
  if (formatCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = formatCache.keys().next().value;
    formatCache.delete(firstKey);
  }
  formatCache.set(text, isFormatted);
}

function getCachedSwear(text) {
  return swearCache.get(text);
}

function setCachedSwear(text, result) {
  if (swearCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = swearCache.keys().next().value;
    swearCache.delete(firstKey);
  }
  swearCache.set(text, result);
}

function getEndpoint() {
  return process.env.TYPESAFE_API_ENDPOINT || DEFAULT_ENDPOINT;
}

function getApiKey() {
  return (process.env.TYPESAFE_API_KEY || "").trim();
}

/**
 * Strips emails, phone-like digit runs, and other contact PII so raw diary
 * text is less identifying before it leaves for the TypeSafe / AI Studio APIs.
 * @param {string} text
 * @returns {string}
 */
function redactContactPii(text) {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, (match) => {
      // Keep short digit runs (dates, page refs); only strip phone-like ones.
      const digits = match.replace(/\D/g, "");
      return digits.length >= 10 ? "[redacted-number]" : match;
    });
}

/**
 * Returns true if the student is in Class 9 or 10.
 * For Class 9th and 10th, Civics is replaced by Political Science.
 *
 * @param {string|null|undefined} section
 * @returns {boolean}
 */
function isPoliticalScienceClass(section) {
  if (section == null) return false;
  const cleaned = String(section).trim();
  if (!cleaned) return false;

  // Standard formats like "9-A", "10-B", "10A", "9F", "IX-F", "X A"
  const directMatch = cleaned.match(/^([IVXivx]+|\d{1,2})(?:[-–\s]+[A-Za-z]|[A-Za-z]?$|[-–\s]|$)/i);
  if (directMatch) {
    const rawClass = directMatch[1].toUpperCase();
    const num = ROMAN_MAP[rawClass] || parseInt(rawClass, 10);
    if (num === 9 || num === 10) return true;
    return false;
  }

  // Named phrases like "Class 9", "Grade 10", "9th", "10th", "Section 10-A"
  const phraseMatch = cleaned.match(/(?:class|grade|section)?\s*([IVXivx]+|\d{1,2})(?:th)?(?:\s*[-–\s]\s*[A-Za-z]|\s*[A-Za-z]?\b|$)/i);
  if (phraseMatch) {
    const raw = phraseMatch[1].toUpperCase();
    const num = ROMAN_MAP[raw] || parseInt(raw, 10);
    if (num === 9 || num === 10) return true;
  }

  return false;
}

/**
 * Builds the subject criteria map for TypeSafe choice primitive.
 * @param {boolean} isPoliticalScience
 * @returns {Record<string, string|null>}
 */
function getSubjectCriteria(isPoliticalScience = false) {
  const criteria = {};
  for (const subject of CANONICAL_SUBJECTS) {
    if (subject === "Civics" && isPoliticalScience) {
      criteria["Political Science"] = null;
    } else {
      criteria[subject] = null;
    }
  }
  criteria["School Diary"] = "General school notice, circular, holiday update, or non-subject diary entry";
  return criteria;
}

/**
 * Calls TypeSafe API with timeout and transient error retry.
 * @param {object} payload
 * @param {number} maxRetries
 * @returns {Promise<Response>}
 */
async function callTypesafeApi(payload, maxRetries = 1) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error("TYPESAFE_API_KEY is not configured");
    err.code = "missing_api_key";
    throw err;
  }

  let attempt = 0;
  while (true) {
    attempt++;
    try {
      return await fetch(getEndpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (err) {
      if (attempt <= maxRetries) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Classifies if a message or text contains swear words / profanity using Jev (noul primitive).
 *
 * @param {string} text
 * @returns {Promise<{ ok: boolean, isSwear: boolean, noul: number, error?: string }>}
 */
async function classifySwear(text) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) {
    return { ok: true, isSwear: false, noul: 0 };
  }

  const cached = getCachedSwear(trimmed);
  if (cached) {
    return cached;
  }

  const payload = {
    model: "jev-latest",
    state: redactContactPii(trimmed),
    questions: {
      contains_swear: {
        type: "noul",
        instructions:
          "Does this text contain any swear words, profanity, vulgarity, insults, abusive language, hate speech, or harassment (in English, Hindi, Punjabi, or Hinglish)?",
      },
    },
  };

  try {
    const res = await callTypesafeApi(payload);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[typesafe] classifySwear HTTP ${res.status}: ${errText.slice(0, 200)}`);
      return { ok: false, isSwear: false, noul: 0, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const noul = data?.answers?.contains_swear?.noul ?? 0;
    const isSwear = typeof noul === "number" && noul >= 0.5;
    const result = { ok: true, isSwear, noul };
    setCachedSwear(trimmed, result);
    return result;
  } catch (err) {
    console.error(`[typesafe] classifySwear error:`, err.message);
    return { ok: false, isSwear: false, noul: 0, error: err.message };
  }
}

/**
 * Runs the homework questions against Jev, sending only the questions whose
 * answers are not already cached (a second question still costs Jev tokens).
 *
 * On provider failure everything fails open: subject falls back to
 * "School Diary" (uncached) and the formatting verdict assumes "well
 * formatted" so AI Studio quota is not spent on an unknown.
 *
 * @param {string} text
 * @param {{ section?: string, isPoliticalScience?: boolean }} options
 * @param {{ includeFormat?: boolean }} questionOpts
 * @returns {Promise<{ ok: boolean, subject: string, isFormatted: boolean, error?: string }>}
 */
async function runHomeworkQuestions(
  text,
  { section = "", isPoliticalScience = null } = {},
  { includeFormat = false } = {}
) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) {
    return { ok: true, subject: "School Diary", isFormatted: true };
  }

  const usePolSci =
    isPoliticalScience !== null
      ? Boolean(isPoliticalScience)
      : isPoliticalScienceClass(section);

  const cachedSubject = getCachedSubject(trimmed, usePolSci);
  const cachedFormat = includeFormat ? getCachedFormat(trimmed) : undefined;
  const needSubject = !cachedSubject;
  const needFormat = includeFormat && cachedFormat === undefined;

  if (!needSubject && !needFormat) {
    return {
      ok: true,
      subject: cachedSubject,
      isFormatted: includeFormat ? cachedFormat : true,
    };
  }

  if (Date.now() < subjectCooldownUntil) {
    // Provider is failing: fail open without caching, so the next window
    // retries immediately instead of serving a sticky verdict.
    return {
      ok: false,
      subject: needSubject ? "School Diary" : cachedSubject,
      isFormatted: needFormat ? true : cachedFormat ?? true,
      error: "cooldown",
    };
  }

  const criteria = getSubjectCriteria(usePolSci);
  const questions = {};
  if (needSubject) {
    questions.subject = {
      type: "choice",
      instructions:
        "Which academic subject is this school homework or classwork for? If it is a general school announcement, notice, circular, or non-academic entry, choose School Diary.",
      criteria,
    };
  }
  if (needFormat) {
    questions.well_formatted = {
      type: "noul",
      instructions:
        "Is this school homework or classwork entry already well formatted, clean, and easy for students to understand, without needing any rewriting? Ignore whether it names a subject.",
    };
  }

  const payload = {
    model: "jev-latest",
    state: redactContactPii(trimmed),
    questions,
  };

  try {
    const res = await callTypesafeApi(payload);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[typesafe] classifyHomework HTTP ${res.status}: ${errText.slice(0, 200)}`);
      noteSubjectFailure();
      return {
        ok: false,
        subject: needSubject ? "School Diary" : cachedSubject,
        isFormatted: needFormat ? true : cachedFormat ?? true,
        error: `HTTP ${res.status}`,
      };
    }

    const data = await res.json();
    noteSubjectSuccess();

    let subject = cachedSubject;
    if (needSubject) {
      const choice = data?.answers?.subject?.choice;
      subject = choice && criteria[choice] !== undefined ? choice : "School Diary";
      setCachedSubject(trimmed, usePolSci, subject);
    }

    let isFormatted = cachedFormat ?? true;
    if (needFormat) {
      const noul = data?.answers?.well_formatted?.noul;
      if (typeof noul === "number") {
        isFormatted = noul >= 0.5;
        setCachedFormat(trimmed, isFormatted);
      } else {
        // Missing answer: fail open and do not cache, so the next pass retries.
        isFormatted = true;
      }
    }

    return { ok: true, subject, isFormatted };
  } catch (err) {
    console.error(`[typesafe] classifyHomework error:`, err.message);
    noteSubjectFailure();
    return {
      ok: false,
      subject: needSubject ? "School Diary" : cachedSubject,
      isFormatted: needFormat ? true : cachedFormat ?? true,
      error: err.message,
    };
  }
}

/**
 * Classifies the academic subject of a homework entry using Jev (choice primitive).
 *
 * @param {string} text - Homework content text
 * @param {{ section?: string, isPoliticalScience?: boolean }} options
 * @returns {Promise<string>} Chosen subject name or "School Diary"
 */
async function classifySubject(text, options = {}) {
  const { subject } = await runHomeworkQuestions(text, options, { includeFormat: false });
  return subject;
}

/**
 * Asks Jev for the subject AND the formatting verdict in one request.
 *
 * @param {string} text - Homework content text
 * @param {{ section?: string, isPoliticalScience?: boolean }} options
 * @returns {Promise<{ ok: boolean, subject: string, isFormatted: boolean, error?: string }>}
 */
async function classifyHomework(text, options = {}) {
  return runHomeworkQuestions(text, options, { includeFormat: true });
}

module.exports = {
  CANONICAL_SUBJECTS,
  ROMAN_MAP,
  isPoliticalScienceClass,
  getSubjectCriteria,
  redactContactPii,
  classifySwear,
  classifySubject,
  classifyHomework,
  clearCache,
};
