const crypto = require("crypto");
const { eq, and, gt } = require("drizzle-orm");
const { db, schema } = require("../db/client");
const { encrypt, decrypt } = require("./encryption");

/**
 * SQLite-backed SessionService using Drizzle ORM.
 * Replaces in-memory storage with persistent local SQLite data.
 */
const ROMAN_MAP = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };

/**
 * Converts a class-section string from EduSecure (e.g. "IX - F") to a normalized form (e.g. "9-F").
 */
function normalizeClassSection(raw) {
  if (!raw) return null;
  const cleaned = raw.trim();
  // Match patterns like "IX - F", "X-A", "10 - B", "XII-C"
  const match = cleaned.match(/^([IVXivx]+|\d{1,2})\s*[-–]\s*([A-Za-z])$/);
  if (!match) return null;
  const classPart = match[1].toUpperCase();
  const sectionLetter = match[2].toUpperCase();
  const classNum = ROMAN_MAP[classPart] || parseInt(classPart, 10);
  if (!classNum || isNaN(classNum)) return null;
  return `${classNum}-${sectionLetter}`;
}

/**
 * Fetches the student's class/section from EduSecure StudentProfile page.
 * @param {string} sessionCookies - EduSecure session cookies
 * @returns {Promise<string|null>} Normalized section string like "9-F" or null
 */
async function fetchSectionFromEduSecure(sessionCookies) {
  try {
    const cheerio = require("cheerio");
    const url = "https://edusecure.in/ManavMangalMohali/ParentApp/StudentProfile.aspx";
    const res = await fetch(url, {
      headers: {
        Cookie: sessionCookies,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "manual",
    });
    if (res.status === 302) {
      console.error("Section fetch redirected (session likely expired)");
      return null;
    }
    const html = await res.text();
    if (html.includes("txtusername") || html.includes("Login.aspx")) {
      console.error("Section page returned login form (session expired)");
      return null;
    }
    const $ = cheerio.load(html);
    const rawSection = $("#ctl00_ContentPlaceHolder1_sClassSection").first().text().trim();
    if (!rawSection) {
      const bodyText = $("body").text().trim().substring(0, 200);
      console.error("Section selector returned empty. Body preview:", bodyText);
      return null;
    }
    const normalized = normalizeClassSection(rawSection);
    if (!normalized) {
      console.error("Could not normalize raw section string:", JSON.stringify(rawSection));
      return null;
    }
    return normalized;
  } catch (err) {
    console.error("Failed to fetch section from EduSecure:", err.message);
    return null;
  }
}


class SessionService {
  /**
   * Finds existing user by Student ID or creates a new User entity.
   * @param {string} studentId 
   * @returns {{id: string, studentId: string, section: string, createdAt: string}}
   */
  findOrCreateUser(studentId) {
    const rawId = studentId.trim();
    const normalizedId = rawId.toLowerCase();

    const existing = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.studentId, rawId))
      .get();

    if (existing) {
      return {
        id: existing.id,
        studentId: existing.studentId,
        section: existing.section,
        createdAt: existing.createdAt,
      };
    }

    const allUsers = db.select().from(schema.users).all();
    const caseMatch = allUsers.find(
      (u) => u.studentId.trim().toLowerCase() === normalizedId
    );
    if (caseMatch) {
      return {
        id: caseMatch.id,
        studentId: caseMatch.studentId,
        section: caseMatch.section,
        createdAt: caseMatch.createdAt,
      };
    }

    const now = new Date().toISOString();
    const newUser = {
      id: crypto.randomUUID(),
      studentId: rawId,
      section: null,
      createdAt: now,
      updatedAt: now,
    };

    db.insert(schema.users).values(newUser).run();

    return {
      id: newUser.id,
      studentId: newUser.studentId,
      section: newUser.section,
      createdAt: newUser.createdAt,
    };
  }

  /**
   * Gets user by ID.
   * @param {string} userId 
   * @returns {{id: string, studentId: string, section: string, createdAt: string} | null}
   */
  getUserById(userId) {
    if (!userId) return null;
    const user = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();

    if (!user) return null;

    return {
      id: user.id,
      studentId: user.studentId,
      section: user.section,
      createdAt: user.createdAt,
    };
  }

  /**
   * Saves or updates the EduSecure session cookies for a given user.
   * SECURITY: Session cookies are encrypted at rest using AES-256-GCM. Plaintext passwords are NEVER saved.
   * @param {string} userId 
   * @param {string} sessionCookies 
   */
  saveEduSecureSession(userId, sessionCookies) {
    if (!userId || !sessionCookies) return;

    const encryptedData = encrypt(sessionCookies);
    const now = new Date().toISOString();

    const existing = db
      .select()
      .from(schema.edusecureSessions)
      .where(eq(schema.edusecureSessions.userId, userId))
      .get();

    if (existing) {
      db.update(schema.edusecureSessions)
        .set({
          encryptedSessionData: encryptedData,
          updatedAt: now,
        })
        .where(eq(schema.edusecureSessions.userId, userId))
        .run();
    } else {
      db.insert(schema.edusecureSessions)
        .values({
          id: crypto.randomUUID(),
          userId,
          encryptedSessionData: encryptedData,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }

  /**
   * Gets EduSecure session for a user and decrypts cookies.
   * @param {string} userId 
   * @returns {{userId: string, sessionCookies: string, updatedAt: string} | null}
   */
  getEduSecureSession(userId) {
    if (!userId) return null;

    const record = db
      .select()
      .from(schema.edusecureSessions)
      .where(eq(schema.edusecureSessions.userId, userId))
      .get();

    if (!record || !record.encryptedSessionData) return null;

    const decryptedCookies = decrypt(record.encryptedSessionData);
    if (!decryptedCookies) {
      return null;
    }

    return {
      userId: record.userId,
      sessionCookies: decryptedCookies,
      updatedAt: record.updatedAt,
    };
  }

  /**
   * Removes EduSecure session for a user (e.g. on session expiration).
   * @param {string} userId 
   */
  removeEduSecureSession(userId) {
    if (!userId) return;
    db.delete(schema.edusecureSessions)
      .where(eq(schema.edusecureSessions.userId, userId))
      .run();
  }

  /**
   * Creates a new authenticated app session token for the user (30 days validity).
   * @param {string} userId 
   * @returns {string} token
   */
  createAppSession(userId) {
    const token = crypto.randomBytes(32).toString("hex");
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const expiresAt = Date.now() + THIRTY_DAYS_MS;
    const now = new Date().toISOString();

    db.insert(schema.appSessions)
      .values({
        token,
        userId,
        expiresAt,
        createdAt: now,
      })
      .run();

    return token;
  }

  /**
   * Validates app session token and returns the user object if valid.
   * @param {string} token 
   * @returns {{token: string, user: {id: string, studentId: string}} | null}
   */
  getAppSession(token) {
    if (!token) return null;

    const session = db
      .select()
      .from(schema.appSessions)
      .where(eq(schema.appSessions.token, token))
      .get();

    if (!session) return null;

    if (Date.now() > session.expiresAt) {
      db.delete(schema.appSessions)
        .where(eq(schema.appSessions.token, token))
        .run();
      return null;
    }

    const user = this.getUserById(session.userId);
    if (!user) {
      db.delete(schema.appSessions)
        .where(eq(schema.appSessions.token, token))
        .run();
      return null;
    }

    return {
      token: session.token,
      user,
    };
  }

  /**
   * Destroys an app session by token.
   * @param {string} token 
   */
  destroyAppSession(token) {
    if (!token) return;
    db.delete(schema.appSessions)
      .where(eq(schema.appSessions.token, token))
      .run();
  }

  /**
   * Updates the section for a user.
   * @param {string} userId
   * @param {string|null} section
   */
  updateSection(userId, section) {
    if (!userId) return;
    db.update(schema.users)
      .set({ section, updatedAt: new Date().toISOString() })
      .where(eq(schema.users.id, userId))
      .run();
  }
}

const sessionService = new SessionService();

module.exports = sessionService;
module.exports.fetchSectionFromEduSecure = fetchSectionFromEduSecure;
