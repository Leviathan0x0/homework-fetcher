const crypto = require("crypto");
const { eq, and, desc } = require("drizzle-orm");
const { db, schema } = require("../db/client");

const DEFAULT_CACHE_MAX_AGE_MINUTES = parseInt(process.env.CACHE_MAX_AGE_MINUTES || "15", 10);

/**
 * Detects subject from homework text or type string.
 * @param {string} text 
 * @param {string} type 
 * @returns {string}
 */
function detectSubjectFromText(text = "", type = "") {
  const combined = `${type} ${text}`.toUpperCase();

  if (/MATH|ALGEBRA|GEOMETRY|गणित/.test(combined)) return "Mathematics";
  if (/SCIENCE|PHYSICS|CHEMISTRY|BIOLOGY|EVS|SCI|विज्ञान/.test(combined)) return "Science";
  if (/ENGLISH|ENG|LITERATURE|GRAMMAR|अंग्रेजी/.test(combined)) return "English";
  if (/HINDI|हिंदी/.test(combined)) return "Hindi";
  if (/COMPUTER|COMPUTERS|CODING|IT|कंप्यूटर/.test(combined)) return "Computers";
  if (/S\.ST|SOCIAL|HISTORY|CIVICS|GEOGRAPHY|SST|सामाजिक/.test(combined)) return "Social Studies";
  if (/PUNJABI|पंजाबी/.test(combined)) return "Punjabi";
  if (/G\.K|GK|GENERAL KNOWLEDGE/.test(combined)) return "General Knowledge";
  if (/ART|DRAWING|CRAFT/.test(combined)) return "Art";

  return type || "School Diary";
}

/**
 * Generates a stable deterministic SHA-256 ID for a homework entry.
 * Prevents duplicate insertions upon refreshing EduSecure.
 * @param {string} userId 
 * @param {string} date 
 * @param {string} subject 
 * @param {string} content 
 * @param {string|null} attachmentUrl 
 * @returns {string} SHA-256 hash string
 */
function generateHomeworkId(userId, date, subject, content, attachmentUrl) {
  const rawKey = `${userId}:${(date || "").trim()}:${(subject || "").trim()}:${(content || "").trim()}:${(attachmentUrl || "").trim()}`;
  return crypto.createHash("sha256").update(rawKey).digest("hex");
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

    for (const item of parsedHomework) {
      const type = item.type || "Homework";
      const date = item.date || "";
      const content = item.homework || "";
      const attachmentUrl = item.attachment || null;
      const subject = detectSubjectFromText(content, type);

      const homeworkId = generateHomeworkId(userId, date, subject, content, attachmentUrl);

      const existing = await db
        .select()
        .from(schema.homework)
        .where(and(eq(schema.homework.id, homeworkId), eq(schema.homework.userId, userId)))
        .get();

      if (existing) {
        await db.update(schema.homework)
          .set({
            date,
            subject,
            content,
            attachmentUrl,
            type,
            updatedAt: now,
          })
          .where(eq(schema.homework.id, homeworkId))
          .run();
      } else {
        await db.insert(schema.homework)
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
          .run();
      }
    }

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

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      date: row.date,
      subject: row.subject,
      homework: row.homework,
      attachment: row.attachment,
      completed: row.completed === 1,
      note: row.note || null,
      updatedAt: row.updatedAt,
    }));
  }

  /**
   * Determines if the user's cached homework is stale or empty.
   * @param {string} userId 
   * @param {number} maxAgeMinutes 
   * @returns {boolean}
   */
  async isCacheStale(userId, maxAgeMinutes = DEFAULT_CACHE_MAX_AGE_MINUTES) {
    if (!userId) return true;

    const items = await this.getCachedHomework(userId);
    if (!items || items.length === 0) return true;

    // Find the latest updatedAt timestamp among cached homework items
    let latestMs = 0;
    for (const item of items) {
      if (item.updatedAt) {
        const ms = new Date(item.updatedAt).getTime();
        if (ms > latestMs) latestMs = ms;
      }
    }

    if (latestMs === 0) return true;

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
