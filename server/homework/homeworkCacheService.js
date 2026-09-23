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

/**
 * Detects subject from homework text or type string.
 * @param {string} text 
 * @param {string} explicitSubject 
 * @param {string} classworkType 
 * @returns {string}
 */
function detectSubjectFromText(_text = "", explicitSubject = "", _classworkType = "") {
  /* [OLD CODE COMMENTED OUT]: Legacy regex / rule-based subject detection

  // Priority 1: Detect subject from actual homework content text first (e.g. "SOCIAL SCIENCE- GEOGRAPHY")
  const upperText = (text || "").toUpperCase();
  if (/\b(HISTORY|HIST)\b/.test(upperText)) return "History";
  if (/\b(MATHEMATICS|MATHS|MATH|ALGEBRA|GEOMETRY|TRIGONOMETRY|गणित|ਗਣਿਤ)\b/.test(upperText)) return "Mathematics";
  if (/\b(PHYSICS)\b/.test(upperText)) return "Physics";
  if (/\b(CHEMISTRY)\b/.test(upperText)) return "Chemistry";
  if (/\b(BIOLOGY)\b/.test(upperText)) return "Biology";
  if (/\b(COMPUTER SCIENCE|COMPUTER SCI|COMPUTERS|COMPUTER|CODING|PROGRAMMING|ICT|कंप्यूटर)\b/.test(upperText)) return "Computers";
  if (/\b(SOCIAL[\s.\-:/]*SCIENCE|SOCAL[\s.\-:/]*SCIENCE|SOCIAL[\s.\-:/]*STUDIES|SOCAL[\s.\-:/]*STUDIES|SOCIAL|SOCAL|S[\s.]*ST|SST|SSC|CIVICS|GEOGRAPHY|POLITICAL SCIENCE|SO[\s.]*SCIENCE|S[\s.]*SCIENCE|सामाजिक)\b/.test(upperText)) return "Social Science";
  if (/\b(SCIENCE|SCI|EVS|विज्ञान)\b/.test(upperText)) return "Science";
  if (/\b(ENGLISH|LITERATURE|GRAMMAR|अंग्रेजी)\b/.test(upperText)) return "English";
  if (/\b(HINDI|हिंदी|हिन्दी)\b/.test(upperText)) return "Hindi";
  if (/\b(PUNJABI|PANJABI|ਪੰਜਾਬੀ|पंजाबी)\b/.test(upperText)) return "Punjabi";
  if (/\b(FRENCH|FRANÇAIS|FRANCAIS)\b/.test(upperText)) return "French";
  if (/\b(GENERAL KNOWLEDGE|G\.K)\b/.test(upperText)) return "General Knowledge";
  if (/\b(ART|DRAWING|CRAFT|PAINTING)\b/.test(upperText)) return "Art";

  // Priority 2: Explicit subject provided by EduSecure
  if (explicitSubject && typeof explicitSubject === "string") {
    const trimmed = explicitSubject.trim();
    if (trimmed && !["HOMEWORK", "SCHOOL DIARY", "ANNOUNCEMENT"].includes(trimmed.toUpperCase())) {
      if (/HISTORY|HIST/i.test(trimmed)) return "History";
      if (/MATH|ALGEBRA|GEOMETRY|गणित/i.test(trimmed)) return "Mathematics";
      if (/PHYSICS|PHYS/i.test(trimmed)) return "Physics";
      if (/CHEMISTRY|CHEM/i.test(trimmed)) return "Chemistry";
      if (/BIOLOGY|BIO/i.test(trimmed)) return "Biology";
      if (/S\.ST|SOCIAL|SOCAL|SST|CIVICS|GEOGRAPHY|POLITICAL|सामाजिक/i.test(trimmed)) return "Social Science";
      if (/SCIENCE|EVS|SCI|विज्ञान/i.test(trimmed)) return "Science";
      if (/ENGLISH|ENG|LITERATURE|GRAMMAR|अंग्रेजी/i.test(trimmed)) return "English";
      if (/HINDI|हिंदी/i.test(trimmed)) return "Hindi";
      if (/COMPUTER|COMPUTERS|CODING|IT|कंप्यूटर/i.test(trimmed)) return "Computers";
      if (/PUNJABI|पंजाबी/i.test(trimmed)) return "Punjabi";
      if (/FRENCH|FRANÇAIS/i.test(trimmed)) return "French";
      if (/G\.K|GK|GENERAL KNOWLEDGE/i.test(trimmed)) return "General Knowledge";
      if (/ART|DRAWING|CRAFT/i.test(trimmed)) return "Art";
      return trimmed;
    }
  }

  // Priority 3: Fallback signal from classworkType if no subject from homework content
  if (classworkType && typeof classworkType === "string") {
    const upperCw = classworkType.toUpperCase();
    if (/\b(HISTORY|HIST)\b/.test(upperCw)) return "History";
    if (/\b(MATH|MATHEMATICS)\b/.test(upperCw)) return "Mathematics";
    if (/\b(PHYSICS)\b/.test(upperCw)) return "Physics";
    if (/\b(CHEMISTRY)\b/.test(upperCw)) return "Chemistry";
    if (/\b(BIOLOGY)\b/.test(upperCw)) return "Biology";
    if (/\b(COMPUTER SCIENCE|COMPUTER SCI|COMPUTERS|COMPUTER)\b/.test(upperCw)) return "Computers";
    if (/\b(SOCIAL[\s.\-:/]*SCIENCE|SOCAL[\s.\-:/]*SCIENCE|SOCIAL[\s.\-:/]*STUDIES|SOCAL[\s.\-:/]*STUDIES|SOCIAL|SOCAL|S[\s.]*ST|SST)\b/.test(upperCw)) return "Social Science";
    if (/\b(SCIENCE)\b/.test(upperCw)) return "Science";
    if (/\b(ENGLISH)\b/.test(upperCw)) return "English";
    if (/\b(HINDI)\b/.test(upperCw)) return "Hindi";
    if (/\b(PUNJABI)\b/.test(upperCw)) return "Punjabi";
    if (/\b(FRENCH)\b/.test(upperCw)) return "French";
  }

  */

  if (explicitSubject && typeof explicitSubject === "string" && explicitSubject.trim()) {
    return explicitSubject.trim();
  }
  return "School Diary";
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
    // [OLD CODE COMMENTED OUT]: const resolvedSubject = detectSubjectFromText(row.content, row.subject, row.type);
    const resolvedSubject = row.subject || "School Diary";
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
 * Runs the combined Jev pass (subject + format verdict, one request) and,
 * only for entries Jev flags as unformatted, the AI Studio Gemma rewrite.
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
  const textToFormatted = new Map();
  await mapConcurrent(uniqueTexts, 4, async (text) => {
    try {
      const { subject, isFormatted } = await classifyHomework(text, { section });
      textToSubject.set(text, subject);
      // Jev says the entry is already clean, or the verdict failed open:
      // show the subject and skip AI Studio (protects its rate limits).
      if (!isFormatted) {
        const formatRes = await formatHomeworkEntry(text, subject);
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
    const newSubject = aiSubject && aiSubject !== "School Diary" ? aiSubject : row.subject;
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

    // Phase 1 (this method): write rows fast using existing/pipeline subjects —
    // no AI calls on the request path. Phase 2 (background): classify every
    // item via enqueueAiPass so a slow provider never delays the scrape.
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
      const subject =
        resolvedExistingSubjects.get(content) ||
        (item.subject && typeof item.subject === "string" && item.subject.trim() ? item.subject.trim() : null) ||
        "School Diary";
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
      rowsForAi.push({ id: homeworkId, date, subject, content: finalContent, aiText: content });

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
