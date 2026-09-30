const crypto = require("crypto");
const { eq, and, inArray, sql } = require("drizzle-orm");
const { db, schema, runBatch } = require("../db/client");
const { toIstWallDate, parseHomeworkDate } = require("./homeworkDateUtils");
const { classifyHomework } = require("../typesafe/typesafeClient");
const { formatHomeworkEntry } = require("../formatting/homeworkFormatter");

const DEFAULT_CACHE_MAX_AGE_MINUTES = parseInt(process.env.CACHE_MAX_AGE_MINUTES || "15", 10);

/**
 * Executes async tasks with controlled concurrency.
 * @param {Array<any>} items
 * @param {number} concurrency
 * @param {Function} fn
 * @returns {Promise<Array<any>>}
 */
async function mapConcurrent(items, concurrency, fn) {
  if (!items || items.length === 0) return [];
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await fn(items[currentIndex], currentIndex);
    }
  }

  const workers = [];
  const workerCount = Math.min(items.length, Math.max(1, concurrency));
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

/** Broad bucket answers that must never overwrite a specific subject. */
const GENERIC_SUBJECTS = new Set(["Science", "Social Science"]);

function isSpecificSubject(subject) {
  return Boolean(subject) && subject !== "School Diary" && !GENERIC_SUBJECTS.has(subject);
}

/**
 * Merges subject candidates in priority order: the first specific answer
 * wins, otherwise the first non-"School Diary" answer, otherwise "School Diary".
 * A generic Science / Social Science guess never downgrades a specific one.
 * @param {...(string|null|undefined)} candidates
 * @returns {string}
 */
function pickSubject(...candidates) {
  let fallback = "";
  for (const candidate of candidates) {
    const value = typeof candidate === "string" ? candidate.trim() : "";
    if (!value) continue;
    if (isSpecificSubject(value)) return value;
    if (!fallback && value !== "School Diary") fallback = value;
  }
  return fallback || "School Diary";
}

/**
 * Uppercased raw text plus a camelCase-split copy, so joined words such as
 * "coveredChemistry" still expose "CHEMISTRY" as a standalone word.
 * @param {string} value
 * @returns {string}
 */
function searchableForms(value) {
  const str = typeof value === "string" ? value : "";
  const split = str
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return `${str.toUpperCase()} ${split.toUpperCase()}`.trim();
}

/**
 * Ordered most-specific-first: Political Science / Geography / Economics and
 * the individual sciences must win over the Social Science / Science catch-alls.
 * Bare "POLITICAL" is intentionally only matched for explicit labels (below),
 * so an SST chapter mentioning "political parties" stays Social Science.
 */
const SUBJECT_SCAN_RULES = [
  ["History", /\b(HISTORY|HIST)\b/],
  ["Mathematics", /\b(MATHEMATICS|MATHS|MATH|ALGEBRA|GEOMETRY|TRIGONOMETRY|गणित|ਗਣਿਤ)\b/],
  ["Physics", /\b(PHYSICS|PHYS|PHY)\b/],
  ["Chemistry", /\b(CHEMISTRY|CHEM|CHM)\b/],
  ["Biology", /\b(BIOLOGY|BIO)\b/],
  ["Political Science", /\b(POLITICAL[\s.\-:/]*SCIENCE|POLITICS|POL[\s.\-:/]*(?:SCI|SCIENCE))\b/],
  ["Geography", /\b(GEOGRAPHY|GEOG|GEO)\b/],
  ["Economics", /\b(ECONOMICS|ECONOMY|ECON)\b/],
  ["Computers", /\b(COMPUTER SCIENCE|COMPUTER SCI|COMPUTERS|COMPUTER|CODING|PROGRAMMING|ICT|कंप्यूटर)\b/],
  [
    "Social Science",
    /\b(SOCIAL[\s.\-:/]*SCIENCE|SOCAL[\s.\-:/]*SCIENCE|SOCIAL[\s.\-:/]*STUDIES|SOCAL[\s.\-:/]*STUDIES|SOCIAL|SOCAL|S[\s.]*ST|SST|SSC|CIVICS|SO[\s.]*SCIENCE|S[\s.]*SCIENCE|सामाजिक)\b/,
  ],
  ["Science", /\b(SCIENCE|SCI|EVS|विज्ञान)\b/],
  ["English", /\b(ENGLISH|LITERATURE|GRAMMAR|अंग्रेजी)\b/],
  ["Hindi", /\b(HINDI|हिंदी|हिन्दी)\b/],
  ["Punjabi", /\b(PUNJABI|PANJABI|ਪੰਜਾਬੀ|पंजाबी)\b/],
  ["French", /\b(FRENCH|FRANÇAIS|FRANCAIS)\b/],
  ["General Knowledge", /\b(GENERAL KNOWLEDGE|G\.K)\b/],
  ["Art", /\b(ART|DRAWING|CRAFT|PAINTING)\b/],
];

function scanSubject(searchText) {
  for (const [name, pattern] of SUBJECT_SCAN_RULES) {
    if (pattern.test(searchText)) return name;
  }
  return null;
}

/**
 * Detects subject from homework text or type string.
 * @param {string} text
 * @param {string} explicitSubject
 * @param {string} classworkType
 * @returns {string}
 */
function detectSubjectFromText(text = "", explicitSubject = "", classworkType = "") {
  const scanned = scanSubject(searchableForms(text));
  if (scanned) return scanned;

  if (explicitSubject && typeof explicitSubject === "string") {
    const trimmed = explicitSubject.trim();
    if (trimmed && !["HOMEWORK", "SCHOOL DIARY", "ANNOUNCEMENT"].includes(trimmed.toUpperCase())) {
      if (/HISTORY|HIST/i.test(trimmed)) return "History";
      if (/MATH|ALGEBRA|GEOMETRY|गणित/i.test(trimmed)) return "Mathematics";
      if (/PHYSICS|\bPHYS\b|\bPHY\b/i.test(trimmed)) return "Physics";
      if (/CHEMISTRY|CHEM/i.test(trimmed)) return "Chemistry";
      if (/BIOLOGY|BIO/i.test(trimmed)) return "Biology";
      if (/POLITICAL|POLITICS|POL[\s.\-:/]*(?:SCI|SCIENCE)/i.test(trimmed)) return "Political Science";
      if (/GEOGRAPHY|GEOG|GEO/i.test(trimmed)) return "Geography";
      if (/ECONOMICS|ECONOMY|ECON/i.test(trimmed)) return "Economics";
      if (/COMPUTER|CODING|IT|कंप्यूटर/i.test(trimmed)) return "Computers";
      if (/S\.ST|SOCIAL|SOCAL|SST|CIVICS|सामाजिक/i.test(trimmed)) return "Social Science";
      if (/SCIENCE|EVS|SCI|विज्ञान/i.test(trimmed)) return "Science";
      if (/ENGLISH|ENG|LITERATURE|GRAMMAR|अंग्रेजी/i.test(trimmed)) return "English";
      if (/HINDI|हिंदी/i.test(trimmed)) return "Hindi";
      if (/PUNJABI|पंजाबी/i.test(trimmed)) return "Punjabi";
      if (/FRENCH|FRANÇAIS/i.test(trimmed)) return "French";
      if (/G\.K|GK|GENERAL KNOWLEDGE/i.test(trimmed)) return "General Knowledge";
      if (/ART|DRAWING|CRAFT/i.test(trimmed)) return "Art";
      return trimmed;
    }
  }

  if (classworkType && typeof classworkType === "string") {
    const scannedType = scanSubject(searchableForms(classworkType));
    if (scannedType) return scannedType;
  }

  if (explicitSubject && typeof explicitSubject === "string" && explicitSubject.trim()) {
    return explicitSubject.trim();
  }
  return "School Diary";
}

/**
 * Vocabulary for the typo-tolerant fallback scans: subjects whose text is
 * unreadable or missing still resolve from the first 5 lines or the
 * attachment path. Multi-word terms match exactly; single words allow one
 * edit (>=5 chars) or two (>=8 chars).
 */
const SUBJECT_VOCABULARY = [
  ["political science", "Political Science"],
  ["politics", "Political Science"],
  ["pol sci", "Political Science"],
  ["political", "Political Science"],
  ["social science", "Social Science"],
  ["social studies", "Social Science"],
  ["social", "Social Science"],
  ["sst", "Social Science"],
  ["civics", "Social Science"],
  ["geography", "Geography"],
  ["geo", "Geography"],
  ["economics", "Economics"],
  ["economy", "Economics"],
  ["econ", "Economics"],
  ["history", "History"],
  ["hist", "History"],
  ["chemistry", "Chemistry"],
  ["chem", "Chemistry"],
  ["chm", "Chemistry"],
  ["biology", "Biology"],
  ["bio", "Biology"],
  ["physics", "Physics"],
  ["phys", "Physics"],
  ["phy", "Physics"],
  ["science", "Science"],
  ["sci", "Science"],
  ["evs", "Science"],
  ["mathematics", "Mathematics"],
  ["maths", "Mathematics"],
  ["math", "Mathematics"],
  ["algebra", "Mathematics"],
  ["geometry", "Mathematics"],
  ["trigonometry", "Mathematics"],
  ["arithmetic", "Mathematics"],
  ["english", "English"],
  ["grammar", "English"],
  ["literature", "English"],
  ["computers", "Computers"],
  ["computer", "Computers"],
  ["coding", "Computers"],
  ["programming", "Computers"],
  ["ict", "Computers"],
  ["hindi", "Hindi"],
  ["punjabi", "Punjabi"],
  ["panjabi", "Punjabi"],
  ["french", "French"],
  ["physical education", "Physical Edu."],
  ["physical edu", "Physical Edu."],
  ["general knowledge", "General Knowledge"],
  ["art", "Art"],
  ["drawing", "Art"],
  ["craft", "Art"],
  ["aptitude", "Aptitude"],
  ["reasoning", "Aptitude"],
  ["life skills", "Life Skills"],
  ["moral science", "Life Skills"],
  ["dance", "Dance"],
  ["yoga", "Yoga"],
  ["library", "Library"],
  ["kaushal vikas", "Kaushal Vikas"],
];

let subjectVocabCache = null;
function getSubjectVocab() {
  if (!subjectVocabCache) {
    const multi = new Map();
    const uni = new Map();
    for (const [term, subject] of SUBJECT_VOCABULARY) {
      if (term.includes(" ")) multi.set(term, subject);
      else uni.set(term, subject);
    }
    subjectVocabCache = { multi, uni };
  }
  return subjectVocabCache;
}

/** Lowercase Latin word tokens with camelCase words split apart. */
function tokenizeSubjectWords(value) {
  const split = String(value || "")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase();
  return split.split(/[^a-z]+/).filter(Boolean);
}

/**
 * Bounded Damerau-Levenshtein distance (adjacent transpositions cost 1,
 * so "histroy"/"Geogarphy" count as single-edit typos); returns max+1 as
 * soon as the row minimum proves the word cannot win.
 */
function levenshteinDistance(a, b, max) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (
        i > 1 && j > 1 &&
        a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]
      ) {
        best = Math.min(best, prev2[j - 2] + 1);
      }
      curr[j] = best;
      if (best < rowMin) rowMin = best;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = curr;
  }
  return prev[b.length];
}

function fuzzySubjectWord(word) {
  const { uni } = getSubjectVocab();
  const exact = uni.get(word);
  if (exact) return exact;
  const allowed = word.length >= 8 ? 2 : word.length >= 5 ? 1 : 0;
  if (allowed === 0) return null;
  let genericMatch = null;
  for (const [term, subject] of uni) {
    if (term.length < 5 || Math.abs(term.length - word.length) > allowed) continue;
    if (levenshteinDistance(word, term, allowed) > allowed) continue;
    if (isSpecificSubject(subject)) return subject;
    if (!genericMatch) genericMatch = subject;
  }
  return genericMatch;
}

/**
 * Matches free text (a filename, a diary excerpt) against the vocabulary.
 * Returns the first specific subject found, else the first generic one.
 * @param {string} value
 * @returns {string|null}
 */
function matchSubjectPhrase(value) {
  const { multi } = getSubjectVocab();
  const words = tokenizeSubjectWords(value);
  const found = [];
  for (let i = 0; i < words.length; i++) {
    if (i + 1 < words.length) {
      const phrase = multi.get(`${words[i]} ${words[i + 1]}`);
      if (phrase) {
        found.push(phrase);
        i += 1;
        continue;
      }
    }
    found.push(fuzzySubjectWord(words[i]));
  }
  return found.find(isSpecificSubject) || found.find(Boolean) || null;
}

/**
 * Typo-tolerant fallback for unreadable/missing subject text: scans only
 * the first 5 lines of the diary entry, so a subject buried deeper in a
 * long note is not picked up by accident.
 * @param {string} text
 * @param {number} maxLines
 * @returns {string|null}
 */
function subjectFromFirstLines(text, maxLines = 5) {
  if (typeof text !== "string" || !text.trim()) return null;
  return matchSubjectPhrase(text.split(/\r?\n/).slice(0, maxLines).join("\n"));
}

/**
 * Typo-tolerant fallback over the attachment URL path: folder names and
 * file names often carry the subject (".../history-worksheet.pdf").
 * @param {string} attachmentUrl
 * @returns {string|null}
 */
function subjectFromAttachment(attachmentUrl) {
  if (typeof attachmentUrl !== "string" || !attachmentUrl.trim()) return null;
  let path = attachmentUrl.trim().split("#")[0].split("?")[0];
  path = path.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    // Malformed percent-escapes: scan the raw path instead.
  }
  return matchSubjectPhrase(path);
}

/**
 * Normalizes content text for stable ID generation and deduplication.
 * Strips dynamic shortlinks (e.g. tiny.edusecure.in/random) and collapses whitespace.
 * @param {string} text 
 * @returns {string}
 */
function normalizeContentForHashing(text = "") {
  return (text || "")
    .replace(/https?:\/\/tiny\.edusecure\.in\/[A-Za-z0-9]+/gi, "http://tiny.edusecure.in/normalized")
    .replace(/[\s\r\n\t]+/g, " ")
    .trim();
}

/**
 * Deduplicates raw incoming homework items by (date + normalizedContent).
 * @param {Array<object>} items
 * @returns {Array<object>}
 */
function deduplicateIncomingHomework(items = []) {
  const seen = new Map();
  for (const item of items) {
    if (!item || !item.homework) continue;
    const date = (item.date || "").trim();
    const content = (item.homework || "").trim();
    if (!content) continue;
    const norm = normalizeContentForHashing(content);
    const key = `${date}\u0000${norm}`;
    if (!seen.has(key)) {
      seen.set(key, item);
    } else {
      const existing = seen.get(key);
      if ((!existing.attachment && item.attachment) || (!existing.subject && item.subject)) {
        seen.set(key, item);
      }
    }
  }
  return Array.from(seen.values());
}

/**
 * Generates a stable deterministic SHA-256 ID for a homework entry based on content.
 * Prevents duplicate insertions when subjects or tracking shortlinks update.
 * @param {string} userId 
 * @param {string} date 
 * @param {string} content 
 * @returns {string} SHA-256 hash string
 */
function generateHomeworkId(userId, date, content) {
  const normContent = normalizeContentForHashing(content);
  const rawKey = `${userId}:${(date || "").trim()}:${normContent}`;
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

function hasPersonalState(row) {
  return (row.completed !== null && row.completed !== undefined) || Boolean(row.note);
}

function preferDuplicateCandidate(candidate, existing) {
  const candidateHasState = hasPersonalState(candidate);
  const existingHasState = hasPersonalState(existing);
  return (
    (candidateHasState && !existingHasState) ||
    (candidateHasState === existingHasState &&
      candidate.subject === "History" && existing.subject !== "History")
  );
}

/** Returns duplicate row ids so their delete can share the upsert pipeline. */
function duplicateHomeworkIds(rows) {
  const seen = new Map();
  const duplicateIds = [];

  for (const row of rows) {
    const normalizedContent = normalizeContentForHashing(row.content);
    const key = `${(row.date || "").trim()}:${normalizedContent}`;
    if (!seen.has(key)) {
      seen.set(key, row);
      continue;
    }

    const existing = seen.get(key);
    if (preferDuplicateCandidate(row, existing)) {
      duplicateIds.push(existing.id);
      seen.set(key, row);
    } else {
      duplicateIds.push(row.id);
    }
  }

  return duplicateIds;
}

/** Converts raw joined rows into the stable client-facing homework shape. */
function clientHomeworkRows(rows) {
  const unique = new Map();

  for (const row of rows) {
    const normalizedContent = normalizeContentForHashing(row.content);
    const key = `${(row.date || "").trim()}:${normalizedContent}`;
    // Text scan first: a stale generic Science / Social Science label from an
    // older Jev pass must not hide what the entry actually says. First-lines
    // and attachment scans only fill in when the subject is still absent.
    const resolvedSubject = pickSubject(
      detectSubjectFromText(row.content, "", row.type),
      row.subject,
      subjectFromFirstLines(row.content),
      subjectFromAttachment(row.attachmentUrl)
    );
    if (
      !unique.has(key) ||
      (resolvedSubject !== "School Diary" && unique.get(key).subject === "School Diary")
    ) {
      unique.set(key, {
        id: row.id,
        type: row.type,
        date: row.date,
        subject: resolvedSubject,
        homework: row.content,
        attachment: row.attachmentUrl,
        completed: row.completed === 1 || row.completed === true,
        note: row.note || null,
        updatedAt: row.updatedAt,
      });
    }
  }

  return Array.from(unique.values());
}

// Reclassification runs on every load-in (throttled per user). Set
// ENABLE_PAST_DAYS_RECLASSIFY=false or a RECLASSIFY_UNTIL date to disable it.
const lastRecentReclassification = new Map();
const RECLASSIFY_THROTTLE_MS = 30 * 60 * 1000; // 30 minutes throttle per user
const DEFAULT_RECLASSIFY_LIMIT = 5; // last N homework entries, no matter their date
const upsertQueues = new Map(); // Per-user queue to prevent concurrent upsert collisions

// Per-user background AI passes (classify + filter + rewrite). HTTP responses
// never wait on these: a slow or down AI provider must not delay homework loads.
const aiPassesInFlight = new Map();

/**
 * Chains fn onto any AI pass already running for this user so two passes
 * never write the same rows concurrently. The map entry is set synchronously
 * so isAiPending() is accurate the moment a pass is requested.
 * @param {string} userId
 * @param {() => Promise<any>} fn
 * @returns {Promise<any>}
 */
function enqueueAiPass(userId, fn) {
  const running = aiPassesInFlight.get(userId);
  const base = running ? running.catch(() => {}) : Promise.resolve();
  const pending = base.then(fn).finally(() => {
    if (aiPassesInFlight.get(userId) === pending) {
      aiPassesInFlight.delete(userId);
    }
  });
  aiPassesInFlight.set(userId, pending);
  return pending;
}

function isRecentReclassifyActive() {
  if (process.env.ENABLE_PAST_DAYS_RECLASSIFY === "false") {
    return false;
  }
  if (process.env.RECLASSIFY_UNTIL) {
    const expiry = new Date(process.env.RECLASSIFY_UNTIL).getTime();
    if (Number.isFinite(expiry) && Date.now() > expiry) {
      return false;
    }
  }
  return true;
}

/**
 * Regex classifies every row first (instant, free), then runs the combined
 * Jev pass (subject + format verdict, one request) and, only for entries Jev
 * flags as unformatted, the AI Studio Gemma rewrite.
 * Jev's subject only upgrades the regex answer — it fills gaps and replaces
 * generic Science / Social Science buckets, but never overrides a specific
 * regex match, and a generic answer never overwrites a specific stored one.
 * Persists only the rows whose subject or content changed.
 * "School Diary" from TypeSafe fails open (provider error) and must not
 * clobber an already-resolved subject.
 * @param {string} userId
 * @param {Array<{id: string, date?: string, subject?: string|null, content?: string}>} rows
 * @param {string} section
 * @returns {Promise<{ count: number, updated: number }>}
 */
async function applyAiToRows(userId, rows, section = "") {
  if (!rows || rows.length === 0) return { count: 0, updated: 0 };

  const aiTextOf = (row) => (row.aiText ?? row.content ?? "").trim();
  const uniqueTexts = Array.from(
    new Set(rows.map(aiTextOf).filter(Boolean))
  );

  const textToSubject = new Map();
  const textToFallback = new Map();
  const textToFormatted = new Map();

  // Phase 1: Regex-first classification (instant, no API cost), plus the
  // typo-tolerant first-lines fallback for entries regex could not read.
  for (const text of uniqueTexts) {
    textToSubject.set(text, detectSubjectFromText(text, "", ""));
    textToFallback.set(text, subjectFromFirstLines(text));
  }

  // Phase 2: Jev refines the subject and supplies the format verdict for
  // every text so unformatted entries still reach the rewrite path.
  await mapConcurrent(uniqueTexts, 4, async (text) => {
    try {
      const { subject, isFormatted } = await classifyHomework(text, { section });
      const current = textToSubject.get(text);
      // Upgrade only: fill a gap or replace a generic bucket. A specific
      // regex match (the text literally names the subject) always wins.
      if (subject && subject !== "School Diary" && !isSpecificSubject(current)) {
        textToSubject.set(text, subject);
      }
      // Jev says the entry is already clean, or the verdict failed open:
      // show the subject and skip AI Studio (protects its rate limits).
      if (!isFormatted) {
        const formatSubject = pickSubject(textToSubject.get(text), textToFallback.get(text));
        const formatRes = await formatHomeworkEntry(text, formatSubject);
        // Only apply a real rewrite. A rate-limited, timed-out, or failed
        // format passes the raw text through with updated=false — writing
        // that over an already-formatted row reverted the stored body and
        // made the dashboard flip formatted ↔ unformatted on every flaky call.
        if (formatRes?.updated && formatRes.formattedText) {
          textToFormatted.set(text, formatRes.formattedText);
        }
      }
    } catch (err) {
      console.error("[homeworkCacheService] Error classifying/formatting:", err.message);
    }
  });

  const now = new Date().toISOString();
  const writes = [];
  let updatedCount = 0;

  for (const row of rows) {
    const text = aiTextOf(row);
    const aiSubject = textToSubject.get(text);
    const newSubject = pickSubject(
      aiSubject,
      row.subject,
      textToFallback.get(text),
      subjectFromAttachment(row.attachmentUrl)
    );
    const newContent = textToFormatted.get(text) || row.content;
    const subjectChanged = newSubject && newSubject !== row.subject;
    const contentChanged = newContent && newContent !== row.content;

    if (subjectChanged || contentChanged) {
      writes.push(
        db.update(schema.homework)
          .set({
            subject: newSubject,
            content: newContent,
            updatedAt: now,
          })
          .where(eq(schema.homework.id, row.id))
      );
      updatedCount++;
    }
  }

  if (writes.length > 0) {
    await runBatch(writes);
  }

  return { count: rows.length, updated: updatedCount };
}

class HomeworkCacheService {
  /**
   * Upserts fresh homework entries fetched from EduSecure into SQLite.
   * Serialized per userId to prevent race condition write conflicts.
   * @param {string} userId 
   * @param {Array<{type: string, date: string, homework: string, attachment: string|null}>} parsedHomework 
   * @returns {Array} List of saved homework items with user state
   */
  async upsertHomework(userId, parsedHomework, options = {}) {
    if (!userId || !Array.isArray(parsedHomework)) return [];

    const queue = upsertQueues.get(userId) || Promise.resolve();
    const current = queue
      .catch(() => {})
      .then(() => this._executeUpsertHomework(userId, parsedHomework, options));

    upsertQueues.set(userId, current);

    try {
      return await current;
    } finally {
      if (upsertQueues.get(userId) === current) {
        upsertQueues.delete(userId);
      }
    }
  }

  /**
   * Internal execution of upsertHomework.
   * Preserves existing user completion states and notes in homework_user_state.
   * @param {string} userId 
   * @param {Array<{type: string, date: string, homework: string, attachment: string|null}>} parsedHomework 
   * @returns {Array} List of saved homework items with user state
   */
  async _executeUpsertHomework(userId, parsedHomework, options = {}) {
    const deduplicatedHomework = deduplicateIncomingHomework(parsedHomework);
    const now = new Date().toISOString();

    // Read both homework and personal state once. Besides avoiding per-entry
    // lookups, retaining these joined rows lets us return the refreshed list
    // without a second SELECT after the write pipeline.
    const existingRows = await db
      .select({
        id: schema.homework.id,
        userId: schema.homework.userId,
        type: schema.homework.type,
        date: schema.homework.date,
        content: schema.homework.content,
        subject: schema.homework.subject,
        attachmentUrl: schema.homework.attachmentUrl,
        createdAt: schema.homework.createdAt,
        updatedAt: schema.homework.updatedAt,
        completed: schema.homeworkUserState.completed,
        note: schema.homeworkUserState.note,
      })
      .from(schema.homework)
      .leftJoin(
        schema.homeworkUserState,
        and(
          eq(schema.homework.id, schema.homeworkUserState.homeworkId),
          eq(schema.homeworkUserState.userId, userId)
        )
      )
      .where(eq(schema.homework.userId, userId))
      .all();

    const byId = new Map();
    const byDateContent = new Map();
    const byNormalizedDateContent = new Map();
    for (const row of existingRows) {
      byId.set(row.id, row);
      byDateContent.set(`${(row.date || "").trim()}\u0000${row.content || ""}`, row);
      const normalizedKey =
        `${(row.date || "").trim()}\u0000${normalizeContentForHashing(row.content)}`;
      const current = byNormalizedDateContent.get(normalizedKey);
      if (!current || preferDuplicateCandidate(row, current)) {
        byNormalizedDateContent.set(normalizedKey, row);
      }
    }

    let userSection = options.section || "";
    if (!userSection && userId && userId !== "remote-user") {
      try {
        const user = db
          .select({ section: schema.users.section })
          .from(schema.users)
          .where(eq(schema.users.id, userId))
          .get();
        userSection = user?.section || "";
      } catch (err) {
        console.error("[homeworkCacheService] Error resolving user section:", err.message);
      }
    }

    // Phase 1 (this method): write rows fast with a regex subject (plus any
    // stored/pipeline subject) — no AI calls on the request path. Phase 2
    // (background): refine every item via enqueueAiPass so a slow provider
    // never delays the scrape.
    const resolvedExistingSubjects = new Map();

    for (const item of deduplicatedHomework) {
      const date = (item.date || "").trim();
      const content = (item.homework || "").trim();
      if (!content) continue;

      const generatedId = generateHomeworkId(userId, date, content);
      const normalizedKey = `${date}\u0000${normalizeContentForHashing(content)}`;
      const candidates = [
        byId.get(generatedId),
        byDateContent.get(`${date}\u0000${content}`),
        byNormalizedDateContent.get(normalizedKey),
      ].filter(Boolean);
      const existing = candidates.reduce(
        (preferred, candidate) =>
          !preferred || preferDuplicateCandidate(candidate, preferred) ? candidate : preferred,
        null
      );

      if (existing?.subject && existing.subject !== "School Diary") {
        resolvedExistingSubjects.set(content, existing.subject);
      } else if (
        item.subject &&
        typeof item.subject === "string" &&
        item.subject.trim() &&
        !["HOMEWORK", "SCHOOL DIARY", "ANNOUNCEMENT"].includes(item.subject.trim().toUpperCase())
      ) {
        resolvedExistingSubjects.set(content, item.subject.trim());
      }
    }

    const writes = [];
    const resultRows = new Map(existingRows.map((row) => [row.id, row]));
    const rowsForAi = [];

    for (const item of deduplicatedHomework) {
      const type = item.type || "Homework";
      const date = (item.date || "").trim();
      const content = (item.homework || "").trim();
      if (!content) continue;

      const attachmentUrl = item.attachment || null;
      // Keep an already-stored (possibly AI-rewritten) body for matches; only
      // fresh rows start from the raw scraped text. Background AI rewrites later.
      const itemSubject =
        item.subject && typeof item.subject === "string" && item.subject.trim() &&
        !["HOMEWORK", "SCHOOL DIARY", "ANNOUNCEMENT"].includes(item.subject.trim().toUpperCase())
          ? item.subject.trim()
          : null;
      // Regex labels the row immediately; background Jev refines it later.
      // First-lines and attachment scans fill in only when nothing else did.
      const subject = pickSubject(
        detectSubjectFromText(content, "", type),
        resolvedExistingSubjects.get(content),
        itemSubject,
        subjectFromFirstLines(content),
        subjectFromAttachment(attachmentUrl)
      );
      const generatedId = generateHomeworkId(userId, date, content);

      const normalizedKey = `${date}\u0000${normalizeContentForHashing(content)}`;
      const candidates = [
        byId.get(generatedId),
        byDateContent.get(`${date}\u0000${content}`),
        byNormalizedDateContent.get(normalizedKey),
      ].filter(Boolean);
      const existing = candidates.reduce(
        (preferred, candidate) =>
          !preferred || preferDuplicateCandidate(candidate, preferred) ? candidate : preferred,
        null
      );
      // Keep a legacy row's primary key when its exact content already exists.
      // Updating a referenced primary key before homework_user_state would
      // violate SQLite's foreign key constraint and can discard personal state.
      const homeworkId = existing?.id || generatedId;
      const finalContent = existing?.content || content;

      if (existing) {
        writes.push(
          db.update(schema.homework)
            .set({
              date,
              subject,
              content: finalContent,
              attachmentUrl,
              type,
              updatedAt: now,
            })
            .where(eq(schema.homework.id, existing.id))
        );
      } else {
        writes.push(
          db.insert(schema.homework)
            .values({
              id: homeworkId,
              userId,
              sourceIdentifier: "edusecure",
              date,
              subject,
              content: finalContent,
              attachmentUrl,
              type,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: schema.homework.id,
              set: {
                date,
                subject,
                content: finalContent,
                attachmentUrl,
                type,
                updatedAt: now,
              },
            })
        );
      }

      // AI always sees the raw scraped text (stable key into the caches) and
      // updates by primary key afterwards; content holds the stored body so
      // change detection does not rewrite an already-formatted row every scrape.
      rowsForAi.push({
        id: homeworkId,
        date,
        subject,
        content: finalContent,
        aiText: content,
        attachmentUrl,
      });

      const merged = {
        ...existing,
        id: homeworkId,
        userId,
        type,
        date,
        // Must mirror the DB write above: returning the raw scrape here made
        // every refresh response show the unformatted text even though the
        // stored body was already AI-formatted, so the dashboard flip-flopped
        // between raw and formatted on every refresh/poll cycle.
        content: finalContent,
        subject,
        attachmentUrl,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        completed: existing?.completed ?? null,
        note: existing?.note ?? null,
      };
      byId.set(generatedId, merged);
      byId.set(homeworkId, merged);
      byDateContent.set(`${date}\u0000${content}`, merged);
      byNormalizedDateContent.set(normalizedKey, merged);
      resultRows.set(homeworkId, merged);
    }

    const duplicateIds = duplicateHomeworkIds(Array.from(resultRows.values()));
    if (duplicateIds.length > 0) {
      writes.push(
        db.delete(schema.homework).where(inArray(schema.homework.id, duplicateIds))
      );
      duplicateIds.forEach((id) => resultRows.delete(id));
    }

    // Remote writes and duplicate cleanup are all executed in one Turso
    // pipeline. The local driver keeps the same ordering in process.
    await runBatch(writes);

    // Phase 2: classify + filter + rewrite every item in the background.
    // skipAi is for tests that need a deterministic write pipeline.
    if (options.skipAi !== true && rowsForAi.length > 0) {
      enqueueAiPass(userId, () => applyAiToRows(userId, rowsForAi, userSection)).catch((err) => {
        console.error("[homeworkCacheService] Background AI enrichment failed:", err.message);
      });
    }

    return clientHomeworkRows(Array.from(resultRows.values()));
  }

  /**
   * Retrieves all cached homework entries for a specific user, joined with completion status and personal notes.
   * SECURITY: Strictly filters by userId to guarantee isolation.
   * @param {string} userId 
   * @returns {Array} List of homework entries
   */
  async getCachedHomework(userId) {
    if (!userId) return [];

    // Query homework left joining homework_user_state for completion status & personal notes
    const rows = await db
      .select({
        id: schema.homework.id,
        userId: schema.homework.userId,
        type: schema.homework.type,
        date: schema.homework.date,
        subject: schema.homework.subject,
        content: schema.homework.content,
        attachmentUrl: schema.homework.attachmentUrl,
        createdAt: schema.homework.createdAt,
        updatedAt: schema.homework.updatedAt,
        completed: schema.homeworkUserState.completed,
        note: schema.homeworkUserState.note,
      })
      .from(schema.homework)
      .leftJoin(
        schema.homeworkUserState,
        and(
          eq(schema.homework.id, schema.homeworkUserState.homeworkId),
          eq(schema.homeworkUserState.userId, userId)
        )
      )
      .where(eq(schema.homework.userId, userId))
      .all();

    return clientHomeworkRows(rows);
  }

  /**
   * Determines if the user's cached homework is stale or empty.
   * @param {string} userId 
   * @param {number} maxAgeMinutes 
   * @returns {boolean}
   */
  async isCacheStale(userId, maxAgeMinutes = DEFAULT_CACHE_MAX_AGE_MINUTES) {
    if (!userId) return true;

    // A single aggregate answers this. Re-reading and de-duplicating every
    // cached row just to look at one timestamp doubled the cost of a cache hit.
    const row = await db
      .select({ latest: sql`max(${schema.homework.updatedAt})` })
      .from(schema.homework)
      .where(eq(schema.homework.userId, userId))
      .get();

    const latest = row?.latest;
    if (!latest) return true;

    const latestMs = new Date(latest).getTime();
    if (!latestMs) return true;

    const ageMinutes = (Date.now() - latestMs) / (1000 * 60);
    if (ageMinutes >= maxAgeMinutes) return true;

    // Check if the latest update was on a previous calendar day in IST (UTC+05:30).
    // toIstWallDate shifts the instant so local getters return IST wall fields
    // regardless of server TZ (see homeworkDateUtils).
    const nowIst = toIstWallDate(new Date());
    const latestIst = toIstWallDate(new Date(latest));

    const isSameDay =
      nowIst.getFullYear() === latestIst.getFullYear() &&
      nowIst.getMonth() === latestIst.getMonth() &&
      nowIst.getDate() === latestIst.getDate();

    if (!isSameDay) return true;

    return false;
  }

  /**
   * Updates completion status of a homework item for the authenticated user.
   * SECURITY: Strictly verifies homework belongs to userId.
   * @param {string} userId 
   * @param {string} homeworkId 
   * @param {boolean} completed 
   * @returns {{success: boolean, completed: boolean}}
   */
  async updateHomeworkStatus(userId, homeworkId, completed) {
    if (!userId || !homeworkId) throw new Error("Invalid parameters.");

    // Ownership check and existing-state lookup share one query so ticking a
    // checkbox costs two round trips instead of three.
    const row = await this.findOwnedHomeworkState(userId, homeworkId);

    const now = new Date().toISOString();
    const isCompleted = completed ? 1 : 0;

    if (row.stateId) {
      await db.update(schema.homeworkUserState)
        .set({
          completed: isCompleted,
          updatedAt: now,
        })
        .where(eq(schema.homeworkUserState.id, row.stateId))
        .run();
    } else {
      await db.insert(schema.homeworkUserState)
        .values({
          id: crypto.randomUUID(),
          userId,
          homeworkId,
          completed: isCompleted,
          note: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    return {
      success: true,
      completed: !!isCompleted,
    };
  }

  /**
   * Verifies the homework belongs to the user and returns its personal-state row id.
   * SECURITY: Strictly verifies homework belongs to userId.
   * @param {string} userId
   * @param {string} homeworkId
   * @returns {Promise<{stateId: string|null}>}
   */
  async findOwnedHomeworkState(userId, homeworkId) {
    const row = await db
      .select({
        homeworkId: schema.homework.id,
        stateId: schema.homeworkUserState.id,
      })
      .from(schema.homework)
      .leftJoin(
        schema.homeworkUserState,
        and(
          eq(schema.homeworkUserState.homeworkId, schema.homework.id),
          eq(schema.homeworkUserState.userId, userId)
        )
      )
      .where(and(eq(schema.homework.id, homeworkId), eq(schema.homework.userId, userId)))
      .get();

    if (!row) {
      const err = new Error("Homework not found or unauthorized.");
      err.statusCode = 404;
      throw err;
    }

    return { stateId: row.stateId || null };
  }

  /**
   * Updates personal note for a homework item for the authenticated user.
   * SECURITY: Strictly verifies homework belongs to userId.
   * @param {string} userId 
   * @param {string} homeworkId 
   * @param {string} note 
   * @returns {{success: boolean, note: string|null}}
   */
  async updateHomeworkNote(userId, homeworkId, note) {
    if (!userId || !homeworkId) throw new Error("Invalid parameters.");

    const row = await this.findOwnedHomeworkState(userId, homeworkId);

    const now = new Date().toISOString();
    const cleanNote = typeof note === "string" ? note.trim() : null;

    if (row.stateId) {
      await db.update(schema.homeworkUserState)
        .set({
          note: cleanNote,
          updatedAt: now,
        })
        .where(eq(schema.homeworkUserState.id, row.stateId))
        .run();
    } else {
      await db.insert(schema.homeworkUserState)
        .values({
          id: crypto.randomUUID(),
          userId,
          homeworkId,
          completed: 0,
          note: cleanNote,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    return {
      success: true,
      note: cleanNote,
    };
  }

  /**
   * Whether the user qualifies for recent-homework re-classification on load-in.
   * Throttled per user to avoid redundant calls.
   * @param {string} userId
   * @param {boolean} force
   * @returns {boolean}
   */
  shouldReclassifyRecent(userId, force = false) {
    if (!userId) return false;
    if (!isRecentReclassifyActive()) return false;
    if (force) return true;
    const lastTime = lastRecentReclassification.get(userId);
    if (!lastTime) return true;
    return Date.now() - lastTime > RECLASSIFY_THROTTLE_MS;
  }

  /**
   * True while a background AI pass (classify + filter + rewrite) is queued or
   * running for this user. Responses report it so clients can re-fetch shortly
   * after the pass lands instead of waiting for the next periodic refresh.
   * @param {string} userId
   * @returns {boolean}
   */
  isAiPending(userId) {
    return Boolean(userId) && aiPassesInFlight.has(userId);
  }

  /**
   * Resolves once every queued/running AI pass for this user has settled.
   * Intended for tests and graceful shutdown.
   * @param {string} userId
   * @returns {Promise<void>}
   */
  async whenAiIdle(userId) {
    if (!userId) return;
    while (aiPassesInFlight.has(userId)) {
      try {
        await aiPassesInFlight.get(userId);
      } catch {
        // Pass errors are already logged; keep waiting for later chained work.
      }
    }
  }

  /**
   * Resends the user's last N cached homework entries (default: 5, no matter
   * their date) to TypeSafe AI for the subject + format check in one Jev
   * request, then to AI Studio (Gemma) only for entries flagged unformatted.
   *
   * The AI work is enqueued synchronously (so isAiPending flips immediately)
   * and runs in the background — callers must not await this on a request path.
   *
   * @param {string} userId
   * @param {{ section?: string, force?: boolean, limit?: number }} options
   * @returns {Promise<{ count: number, updated: number, skipped?: boolean }>}
   */
  reclassifyRecentHomework(userId, options = {}) {
    if (!userId) return Promise.resolve({ count: 0, updated: 0 });
    const defaultLimit = parseInt(process.env.RECLASSIFY_LIMIT || String(DEFAULT_RECLASSIFY_LIMIT), 10);
    const { section: passedSection, force = false, limit = defaultLimit } = options;

    if (!this.shouldReclassifyRecent(userId, force)) {
      return Promise.resolve({ count: 0, updated: 0, skipped: true });
    }

    lastRecentReclassification.set(userId, Date.now());

    return enqueueAiPass(userId, async () => {
      // 1. Fetch cached homework for this user
      const rows = await db
        .select({
          id: schema.homework.id,
          date: schema.homework.date,
          subject: schema.homework.subject,
          content: schema.homework.content,
          attachmentUrl: schema.homework.attachmentUrl,
        })
        .from(schema.homework)
        .where(eq(schema.homework.userId, userId))
        .all();

      if (!rows || rows.length === 0) {
        return { count: 0, updated: 0 };
      }

      // 2. Keep the last N entries by date, regardless of how old they are.
      // Unparseable dates sort oldest so real dated homework wins the window.
      const recentRows = rows
        .map((row) => ({ row, time: parseHomeworkDate(row.date)?.getTime() ?? 0 }))
        .sort((a, b) => b.time - a.time)
        .slice(0, Math.max(1, limit))
        .map(({ row }) => row);
      if (recentRows.length === 0) {
        return { count: 0, updated: 0 };
      }

      // 3. Resolve user section if not provided
      let userSection = passedSection || "";
      if (!userSection && userId !== "remote-user") {
        try {
          const user = db
            .select({ section: schema.users.section })
            .from(schema.users)
            .where(eq(schema.users.id, userId))
            .get();
          userSection = user?.section || "";
        } catch (err) {
          console.error("[homeworkCacheService] Error resolving user section:", err.message);
        }
      }

      const result = await applyAiToRows(userId, recentRows, userSection);
      if (result.updated > 0) {
        console.log(`[homeworkCacheService] Re-classified ${result.updated} of ${result.count} cached homework items for user ${userId}`);
      }
      return result;
    });
  }
}

const homeworkCacheService = new HomeworkCacheService();

module.exports = homeworkCacheService;
module.exports.detectSubjectFromText = detectSubjectFromText;
module.exports.pickSubject = pickSubject;
module.exports.subjectFromFirstLines = subjectFromFirstLines;
module.exports.subjectFromAttachment = subjectFromAttachment;
