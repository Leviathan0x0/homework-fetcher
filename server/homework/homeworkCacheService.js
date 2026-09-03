const crypto = require("crypto");
const { eq, and, inArray, sql } = require("drizzle-orm");
const { db, schema, runBatch } = require("../db/client");
const { toIstWallDate } = require("./homeworkDateUtils");

const DEFAULT_CACHE_MAX_AGE_MINUTES = parseInt(process.env.CACHE_MAX_AGE_MINUTES || "15", 10);

/**
 * Detects subject from homework text or type string.
 * @param {string} text 
 * @param {string} explicitSubject 
 * @param {string} classworkType 
 * @returns {string}
 */
function detectSubjectFromText(text = "", explicitSubject = "", classworkType = "") {
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

  // Priority 4: Default fallback
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
    const resolvedSubject = detectSubjectFromText(row.content, row.subject, row.type);
    if (
      !unique.has(key) ||
      (resolvedSubject !== "School Diary" && unique.get(key).subject === "School Diary") ||
      (resolvedSubject === "Social Science" && unique.get(key).subject !== "Social Science")
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

class HomeworkCacheService {
  /**
   * Upserts fresh homework entries fetched from EduSecure into SQLite.
   * Preserves existing user completion states and notes in homework_user_state.
   * @param {string} userId 
   * @param {Array<{type: string, date: string, homework: string, attachment: string|null}>} parsedHomework 
   * @returns {Array} List of saved homework items with user state
   */
  async upsertHomework(userId, parsedHomework) {
    if (!userId || !Array.isArray(parsedHomework)) return [];

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

    const writes = [];
    const resultRows = new Map(existingRows.map((row) => [row.id, row]));

    for (const item of parsedHomework) {
      const type = item.type || "Homework";
      const date = (item.date || "").trim();
      const content = (item.homework || "").trim();
      if (!content) continue;

      const attachmentUrl = item.attachment || null;
      const subject = detectSubjectFromText(content, item.subject || "", type);
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

      if (existing) {
        writes.push(
          db.update(schema.homework)
            .set({
              date,
              subject,
              content,
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
              content,
              attachmentUrl,
              type,
              createdAt: now,
              updatedAt: now,
            })
        );
      }

      const merged = {
        ...existing,
        id: homeworkId,
        userId,
        type,
        date,
        content,
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
}

const homeworkCacheService = new HomeworkCacheService();

module.exports = homeworkCacheService;
module.exports.detectSubjectFromText = detectSubjectFromText;
