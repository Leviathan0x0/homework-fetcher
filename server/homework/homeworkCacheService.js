const crypto = require("crypto");
const { eq, and, desc, inArray, sql } = require("drizzle-orm");
const { db, schema, runBatch } = require("../db/client");

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

/**
 * Purges duplicate entries for the same user, date, and content.
 *
 * Only worth running after a fetch from EduSecure has written new rows: reads
 * already collapse duplicates in memory, and doing this on every read turned a
 * cache hit into a full table scan plus one delete round trip per duplicate.
 *
 * @param {string} userId
 * @param {Array} [rows] already-loaded homework rows for this user
 */
async function cleanDuplicateHomework(userId, rows) {
  if (!userId) return;
  try {
    const all = rows || (await db
      .select({
        id: schema.homework.id,
        date: schema.homework.date,
        content: schema.homework.content,
        subject: schema.homework.subject,
      })
      .from(schema.homework)
      .where(eq(schema.homework.userId, userId))
      .all());

    const seen = new Map();
    const toDeleteIds = [];

    for (const r of all) {
      const normContent = normalizeContentForHashing(r.content);
      const key = `${(r.date || "").trim()}:${normContent}`;
      if (seen.has(key)) {
        const existing = seen.get(key);
        if (r.subject === "History" && existing.subject !== "History") {
          toDeleteIds.push(existing.id);
          seen.set(key, r);
        } else {
          toDeleteIds.push(r.id);
        }
      } else {
        seen.set(key, r);
      }
    }

    if (toDeleteIds.length > 0) {
      // One statement instead of one round trip per duplicate row.
      await db.delete(schema.homework).where(inArray(schema.homework.id, toDeleteIds)).run();
    }
  } catch (err) {
    console.error("Cleanup Duplicate Homework Error:", err);
  }
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

    // Everything the loop needs is read once. Querying per entry meant one
    // network round trip per homework item before a single row was written.
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

    const byId = new Map();
    const byDateContent = new Map();
    for (const row of existingRows) {
      byId.set(row.id, row);
      byDateContent.set(`${(row.date || "").trim()}\u0000${row.content || ""}`, row);
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
      const homeworkId = generateHomeworkId(userId, date, content);

      const existing = byId.get(homeworkId) || byDateContent.get(`${date}\u0000${content}`);

      if (existing) {
        writes.push(
          db.update(schema.homework)
            .set({
              id: homeworkId,
              date,
              subject,
              content,
              attachmentUrl,
              type,
              updatedAt: now,
            })
            .where(eq(schema.homework.id, existing.id))
        );

        if (existing.id !== homeworkId) {
          writes.push(
            db.update(schema.homeworkUserState)
              .set({ homeworkId })
              .where(and(
                eq(schema.homeworkUserState.homeworkId, existing.id),
                eq(schema.homeworkUserState.userId, userId)
              ))
          );
          resultRows.delete(existing.id);
        }
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

      const merged = { id: homeworkId, date, content, subject };
      byId.set(homeworkId, merged);
      byDateContent.set(`${date}\u0000${content}`, merged);
      resultRows.set(homeworkId, merged);
    }

    await runBatch(writes);
    await cleanDuplicateHomework(userId, Array.from(resultRows.values()));

    return await this.getCachedHomework(userId);
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
