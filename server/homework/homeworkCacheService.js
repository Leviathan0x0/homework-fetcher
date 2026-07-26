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
function detectSubjectFromText(text = "", explicitSubject = "", classworkType = "") {
  // Priority 1: Explicit subject provided by EduSecure
  if (explicitSubject && typeof explicitSubject === "string") {
    const trimmed = explicitSubject.trim();
    if (trimmed && !["HOMEWORK", "SCHOOL DIARY", "ANNOUNCEMENT"].includes(trimmed.toUpperCase())) {
      if (/HISTORY|HIST/i.test(trimmed)) return "History";
      if (/MATH|ALGEBRA|GEOMETRY|गणित/i.test(trimmed)) return "Mathematics";
      if (/PHYSICS|PHYS/i.test(trimmed)) return "Physics";
      if (/CHEMISTRY|CHEM/i.test(trimmed)) return "Chemistry";
      if (/BIOLOGY|BIO/i.test(trimmed)) return "Biology";
      if (/SCIENCE|EVS|SCI|विज्ञान/i.test(trimmed)) return "Science";
      if (/ENGLISH|ENG|LITERATURE|GRAMMAR|अंग्रेजी/i.test(trimmed)) return "English";
      if (/HINDI|हिंदी/i.test(trimmed)) return "Hindi";
      if (/COMPUTER|COMPUTERS|CODING|IT|कंप्यूटर/i.test(trimmed)) return "Computers";
      if (/S\.ST|SOCIAL|SST|CIVICS|GEOGRAPHY|सामाजिक/i.test(trimmed)) return "Social Science";
      if (/PUNJABI|पंजाबी/i.test(trimmed)) return "Punjabi";
      if (/FRENCH|FRANÇAIS/i.test(trimmed)) return "French";
      if (/G\.K|GK|GENERAL KNOWLEDGE/i.test(trimmed)) return "General Knowledge";
      if (/ART|DRAWING|CRAFT/i.test(trimmed)) return "Art";
      return trimmed;
    }
  }

  // Priority 2 & 3: Detect subject ONLY from homework content text
  const upperText = (text || "").toUpperCase();
  if (/\b(HISTORY|HIST)\b/.test(upperText)) return "History";
  if (/\b(MATHEMATICS|MATHS|MATH|ALGEBRA|GEOMETRY|TRIGONOMETRY|गणित|ਗਣਿਤ)\b/.test(upperText)) return "Mathematics";
  if (/\b(PHYSICS)\b/.test(upperText)) return "Physics";
  if (/\b(CHEMISTRY)\b/.test(upperText)) return "Chemistry";
  if (/\b(BIOLOGY)\b/.test(upperText)) return "Biology";
  if (/\b(SCIENCE|SCI|EVS|विज्ञान)\b/.test(upperText)) return "Science";
  if (/\b(ENGLISH|LITERATURE|GRAMMAR|अंग्रेजी)\b/.test(upperText)) return "English";
  if (/\b(HINDI|हिंदी|हिन्दी)\b/.test(upperText)) return "Hindi";
  if (/\b(COMPUTER SCIENCE|COMPUTER SCI|COMPUTERS|COMPUTER|CODING|PROGRAMMING|ICT|कंप्यूटर)\b/.test(upperText)) return "Computers";
  if (/\b(SOCIAL SCIENCE|SOCIAL STUDIES|SOCIAL|S\.ST|SST|SSC|CIVICS|GEOGRAPHY|POLITICAL SCIENCE|सामाजिक)\b/.test(upperText)) return "Social Science";
  if (/\b(PUNJABI|PANJABI|ਪੰਜਾਬੀ|पंजाबी)\b/.test(upperText)) return "Punjabi";
  if (/\b(FRENCH|FRANÇAIS|FRANCAIS)\b/.test(upperText)) return "French";
  if (/\b(GENERAL KNOWLEDGE|G\.K)\b/.test(upperText)) return "General Knowledge";
  if (/\b(ART|DRAWING|CRAFT|PAINTING)\b/.test(upperText)) return "Art";

  // Priority 4: Fallback signal from classworkType if no subject from homework content
  if (classworkType && typeof classworkType === "string") {
    const upperCw = classworkType.toUpperCase();
    if (/\b(HISTORY|HIST)\b/.test(upperCw)) return "History";
    if (/\b(MATH|MATHEMATICS)\b/.test(upperCw)) return "Mathematics";
    if (/\b(PHYSICS)\b/.test(upperCw)) return "Physics";
    if (/\b(CHEMISTRY)\b/.test(upperCw)) return "Chemistry";
    if (/\b(BIOLOGY)\b/.test(upperCw)) return "Biology";
    if (/\b(SCIENCE)\b/.test(upperCw)) return "Science";
    if (/\b(ENGLISH)\b/.test(upperCw)) return "English";
    if (/\b(HINDI)\b/.test(upperCw)) return "Hindi";
    if (/\b(COMPUTER)\b/.test(upperCw)) return "Computers";
    if (/\b(S\.ST|SOCIAL|SST)\b/.test(upperCw)) return "Social Science";
    if (/\b(PUNJABI)\b/.test(upperCw)) return "Punjabi";
    if (/\b(FRENCH)\b/.test(upperCw)) return "French";
  }

  // Priority 5: Default fallback
  return "School Diary";
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
      const subject = detectSubjectFromText(content, item.subject || "", type);

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
module.exports.detectSubjectFromText = detectSubjectFromText;
