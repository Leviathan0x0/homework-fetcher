const crypto = require("crypto");
const { eq, and, sql } = require("drizzle-orm");
const { db, schema } = require("../db/client");

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

const inFlightUpdates = new Map();

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

    const previousUpdate = inFlightUpdates.get(userId) || Promise.resolve();
    const update = previousUpdate
      .catch(() => {})
      .then(() => this.persistHomework(userId, parsedHomework));
    inFlightUpdates.set(userId, update);
    return update.finally(() => {
      if (inFlightUpdates.get(userId) === update) {
        inFlightUpdates.delete(userId);
      }
    });
  }

  async persistHomework(userId, parsedHomework) {
    const now = new Date().toISOString();
    const existingRows = await db
      .select({
        id: schema.homework.id,
        date: schema.homework.date,
        content: schema.homework.content,
        subject: schema.homework.subject,
      })
      .from(schema.homework)
      .where(eq(schema.homework.userId, userId))
      .all();
    const existingByContent = new Map();

    for (const row of existingRows) {
      const key = `${(row.date || "").trim()}:${normalizeContentForHashing(row.content)}`;
      const current = existingByContent.get(key);
      if (!current || (row.subject === "History" && current.subject !== "History")) {
        existingByContent.set(key, row);
      }
    }

    const rowsById = new Map();
    for (const item of parsedHomework) {
      const type = item.type || "Homework";
      const date = (item.date || "").trim();
      const content = (item.homework || "").trim();
      if (!content) continue;

      const attachmentUrl = item.attachment || null;
      const subject = detectSubjectFromText(content, item.subject || "", type);
      const contentKey = `${date}:${normalizeContentForHashing(content)}`;
      const homeworkId =
        existingByContent.get(contentKey)?.id ||
        generateHomeworkId(userId, date, content);

      rowsById.set(homeworkId, {
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
      });
    }

    const rows = Array.from(rowsById.values());
    if (rows.length > 0) {
      await db
        .insert(schema.homework)
        .values(rows)
        .onConflictDoUpdate({
          target: schema.homework.id,
          set: {
            sourceIdentifier: sql`excluded.source_identifier`,
            date: sql`excluded.date`,
            subject: sql`excluded.subject`,
            content: sql`excluded.content`,
            attachmentUrl: sql`excluded.attachment_url`,
            type: sql`excluded.type`,
            updatedAt: sql`excluded.updated_at`,
          },
        })
        .run();
    }

    return this.getCachedHomework(userId);
  }

  async waitForPendingUpdate(userId) {
    const update = inFlightUpdates.get(userId);
    return update ? await update : null;
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
        homework: schema.homework.content,
        attachment: schema.homework.attachmentUrl,
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

    const uniqueMap = new Map();
    for (const row of rows) {
      const normContent = normalizeContentForHashing(row.homework);
      const key = `${(row.date || "").trim()}:${normContent}`;
      const resolvedSubject = detectSubjectFromText(row.homework, row.subject, row.type);
      if (
        !uniqueMap.has(key) ||
        (resolvedSubject !== "School Diary" && uniqueMap.get(key).subject === "School Diary") ||
        (resolvedSubject === "Social Science" && uniqueMap.get(key).subject !== "Social Science")
      ) {
        uniqueMap.set(key, {
          id: row.id,
          type: row.type,
          date: row.date,
          subject: resolvedSubject,
          homework: row.homework,
          attachment: row.attachment,
          completed: row.completed === 1,
          note: row.note || null,
          updatedAt: row.updatedAt,
        });
      }
    }

    return Array.from(uniqueMap.values());
  }

  /**
   * Determines if the user's cached homework is stale or empty.
   * @param {string} userId 
   * @param {number} maxAgeMinutes 
   * @returns {boolean}
   */
  async isCacheStale(userId, maxAgeMinutes = DEFAULT_CACHE_MAX_AGE_MINUTES) {
    if (!userId) return true;

    const row = await db.get(sql`
      SELECT MAX(updated_at) AS latest
      FROM homework
      WHERE user_id = ${userId}
    `);
    const latest = row?.latest ?? row?.[0] ?? null;
    if (!latest) return true;

    const latestMs = new Date(latest).getTime();
    if (!Number.isFinite(latestMs)) return true;
    const ageMinutes = (Date.now() - latestMs) / (1000 * 60);
    return ageMinutes >= maxAgeMinutes;
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

    // Verify homework ownership
    const hw = await db
      .select()
      .from(schema.homework)
      .where(and(eq(schema.homework.id, homeworkId), eq(schema.homework.userId, userId)))
      .get();

    if (!hw) {
      const err = new Error("Homework not found or unauthorized.");
      err.statusCode = 404;
      throw err;
    }

    const now = new Date().toISOString();
    const isCompleted = completed ? 1 : 0;

    const existingState = await db
      .select()
      .from(schema.homeworkUserState)
      .where(
        and(
          eq(schema.homeworkUserState.userId, userId),
          eq(schema.homeworkUserState.homeworkId, homeworkId)
        )
      )
      .get();

    if (existingState) {
      await db.update(schema.homeworkUserState)
        .set({
          completed: isCompleted,
          updatedAt: now,
        })
        .where(eq(schema.homeworkUserState.id, existingState.id))
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
   * Updates personal note for a homework item for the authenticated user.
   * SECURITY: Strictly verifies homework belongs to userId.
   * @param {string} userId 
   * @param {string} homeworkId 
   * @param {string} note 
   * @returns {{success: boolean, note: string|null}}
   */
  async updateHomeworkNote(userId, homeworkId, note) {
    if (!userId || !homeworkId) throw new Error("Invalid parameters.");

    // Verify homework ownership
    const hw = await db
      .select()
      .from(schema.homework)
      .where(and(eq(schema.homework.id, homeworkId), eq(schema.homework.userId, userId)))
      .get();

    if (!hw) {
      const err = new Error("Homework not found or unauthorized.");
      err.statusCode = 404;
      throw err;
    }

    const now = new Date().toISOString();
    const cleanNote = typeof note === "string" ? note.trim() : null;

    const existingState = await db
      .select()
      .from(schema.homeworkUserState)
      .where(
        and(
          eq(schema.homeworkUserState.userId, userId),
          eq(schema.homeworkUserState.homeworkId, homeworkId)
        )
      )
      .get();

    if (existingState) {
      await db.update(schema.homeworkUserState)
        .set({
          note: cleanNote,
          updatedAt: now,
        })
        .where(eq(schema.homeworkUserState.id, existingState.id))
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
