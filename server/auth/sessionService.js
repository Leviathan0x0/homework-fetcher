const crypto = require("crypto");
const { eq, and, gt } = require("drizzle-orm");
const { db, schema } = require("../db/client");
const { encrypt, decrypt } = require("./encryption");

const ROMAN_MAP = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };

/**
 * Converts a class-section string from EduSecure (e.g. "IX - F") to a normalized form (e.g. "9-F").
 */
function normalizeClassSection(raw) {
  if (!raw) return null;
  const cleaned = raw.trim();
  const match = cleaned.match(/^([IVXivx]+|\d{1,2})\s*[-–]\s*([A-Za-z])$/);
  if (!match) return null;
  const classPart = match[1].toUpperCase();
  const sectionLetter = match[2].toUpperCase();
  const classNum = ROMAN_MAP[classPart] || parseInt(classPart, 10);
  if (!classNum || isNaN(classNum)) return null;
  return `${classNum}-${sectionLetter}`;
}

/**
 * Fetches the student's profile (display name and class/section) from the
 * EduSecure StudentProfile page.
 * @param {string} sessionCookies - EduSecure session cookies
 * @returns {Promise<{section: string|null, displayName: string|null}>}
 */
async function fetchProfileFromEduSecure(sessionCookies) {
  const empty = { section: null, displayName: null };
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
      console.error("Profile fetch redirected (session likely expired)");
      return empty;
    }
    const html = await res.text();
    if (html.includes("txtusername") || html.includes("Login.aspx")) {
      console.error("Profile page returned login form (session expired)");
      return empty;
    }
    const $ = cheerio.load(html);

    const rawSection = $("#ctl00_ContentPlaceHolder1_sClassSection").first().text().trim();
    let section = null;
    if (rawSection) {
      section = normalizeClassSection(rawSection);
      if (!section) {
        console.error("Could not normalize raw section string:", JSON.stringify(rawSection));
      }
    } else {
      const bodyText = $("body").text().trim().substring(0, 200);
      console.error("Section selector returned empty. Body preview:", bodyText);
    }

    const nameSelectors = [
      "#ctl00_ContentPlaceHolder1_sStudentName",
      "#ctl00_ContentPlaceHolder1_sName",
      "#ctl00_ContentPlaceHolder1_lblStudentName",
      "#ctl00_ContentPlaceHolder1_lblName",
    ];
    let displayName = null;
    for (const selector of nameSelectors) {
      const value = $(selector).first().text().trim();
      if (value) {
        displayName = value.replace(/\s+/g, " ");
        break;
      }
    }

    return { section, displayName };
  } catch (err) {
    console.error("Failed to fetch profile from EduSecure:", err.message);
    return empty;
  }
}

// In-memory fail-safe stores when disk database is non-writable or unavailable
const memUsers = new Map();
const memEduSessions = new Map();
const memAppSessions = new Map();

/**
 * Fetches only the normalized section string from EduSecure.
 * @param {string} sessionCookies - EduSecure session cookies
 * @returns {Promise<string|null>} Normalized section string like "9-F" or null
 */
async function fetchSectionFromEduSecure(sessionCookies) {
  const profile = await fetchProfileFromEduSecure(sessionCookies);
  return profile.section;
}

class SessionService {
  async findOrCreateUser(studentId) {
    const rawId = studentId.trim();
    const normalizedId = rawId.toLowerCase();

    try {
      const existing = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.studentId, rawId))
        .get();

      if (existing) {
        const u = {
          id: existing.id,
          studentId: existing.studentId,
          displayName: existing.displayName || null,
          section: existing.section,
          createdAt: existing.createdAt,
        };
        memUsers.set(u.id, u);
        return u;
      }

      const allUsers = await db.select().from(schema.users).all();
      const caseMatch = allUsers.find(
        (u) => u.studentId.trim().toLowerCase() === normalizedId
      );
      if (caseMatch) {
        const u = {
          id: caseMatch.id,
          studentId: caseMatch.studentId,
          displayName: caseMatch.displayName || null,
          section: caseMatch.section,
          createdAt: caseMatch.createdAt,
        };
        memUsers.set(u.id, u);
        return u;
      }

      const now = new Date().toISOString();
      const newUser = {
        id: crypto.randomUUID(),
        studentId: rawId,
        displayName: null,
        section: "Section 10-A",
        createdAt: now,
        updatedAt: now,
      };

      await db.insert(schema.users).values(newUser).run();
      memUsers.set(newUser.id, newUser);

      return {
        id: newUser.id,
        studentId: newUser.studentId,
        displayName: newUser.displayName,
        section: newUser.section,
        createdAt: newUser.createdAt,
      };
    } catch (err) {
      console.error("SQLite user query/insert failed, using memory store:", err.message);
      for (const u of memUsers.values()) {
        if (u.studentId.trim().toLowerCase() === normalizedId) return u;
      }
      const now = new Date().toISOString();
      const newUser = {
        id: crypto.randomUUID(),
        studentId: rawId,
        displayName: null,
        section: "Section 10-A",
        createdAt: now,
      };
      memUsers.set(newUser.id, newUser);
      return newUser;
    }
  }

  async getUserById(userId) {
    if (!userId) return null;

    try {
      const user = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .get();

      if (user) {
        return {
          id: user.id,
          studentId: user.studentId,
          displayName: user.displayName || null,
          section: user.section,
          createdAt: user.createdAt,
        };
      }
    } catch (err) {
      console.error("SQLite getUserById failed, checking memory store:", err.message);
    }

    const memUser = memUsers.get(userId);
    if (memUser) {
      return {
        id: memUser.id,
        studentId: memUser.studentId,
        displayName: memUser.displayName || null,
        section: memUser.section,
        createdAt: memUser.createdAt,
      };
    }

    return null;
  }

  async saveEduSecureSession(userId, sessionCookies) {
    if (!userId || !sessionCookies) return;

    const encryptedData = encrypt(sessionCookies);
    const now = new Date().toISOString();
    memEduSessions.set(userId, { userId, sessionCookies, updatedAt: now });

    try {
      const existing = await db
        .select()
        .from(schema.edusecureSessions)
        .where(eq(schema.edusecureSessions.userId, userId))
        .get();

      if (existing) {
        await db.update(schema.edusecureSessions)
          .set({
            encryptedSessionData: encryptedData,
            updatedAt: now,
          })
          .where(eq(schema.edusecureSessions.userId, userId))
          .run();
      } else {
        await db.insert(schema.edusecureSessions)
          .values({
            id: crypto.randomUUID(),
            userId,
            encryptedSessionData: encryptedData,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
    } catch (err) {
      console.error("SQLite saveEduSecureSession failed, saved to memory store:", err.message);
    }
  }

  async getEduSecureSession(userId) {
    if (!userId) return null;

    try {
      const record = await db
        .select()
        .from(schema.edusecureSessions)
        .where(eq(schema.edusecureSessions.userId, userId))
        .get();

      if (record && record.encryptedSessionData) {
        const decryptedCookies = decrypt(record.encryptedSessionData);
        if (decryptedCookies) {
          return {
            userId: record.userId,
            sessionCookies: decryptedCookies,
            updatedAt: record.updatedAt,
          };
        }
      }
    } catch (err) {
      console.error("SQLite getEduSecureSession failed, checking memory store:", err.message);
    }

    return memEduSessions.get(userId) || null;
  }

  async removeEduSecureSession(userId) {
    if (!userId) return;
    memEduSessions.delete(userId);
    try {
      await db.delete(schema.edusecureSessions)
        .where(eq(schema.edusecureSessions.userId, userId))
        .run();
    } catch {}
  }

  async createAppSession(userId) {
    const token = crypto.randomBytes(32).toString("hex");
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const expiresAt = Date.now() + THIRTY_DAYS_MS;
    const createdAt = new Date().toISOString();

    memAppSessions.set(token, { token, userId, expiresAt });

    try {
      await db.insert(schema.appSessions)
        .values({
          token,
          userId,
          expiresAt,
          createdAt,
        })
        .run();
    } catch (err) {
      console.error("SQLite createAppSession failed, saved to memory store:", err.message);
    }

    return token;
  }

  async getAppSession(token) {
    if (!token) return null;

    try {
      const session = await db
        .select()
        .from(schema.appSessions)
        .where(eq(schema.appSessions.token, token))
        .get();

      if (session) {
        if (Date.now() > session.expiresAt) {
          try {
            await db.delete(schema.appSessions)
              .where(eq(schema.appSessions.token, token))
              .run();
          } catch {}
          return null;
        }

        const user = await this.getUserById(session.userId);
        if (user) {
          return { token: session.token, user };
        }
      }
    } catch (err) {
      console.error("SQLite getAppSession failed, checking memory store:", err.message);
    }

    const memSession = memAppSessions.get(token);
    if (!memSession) return null;
    if (Date.now() > memSession.expiresAt) {
      memAppSessions.delete(token);
      return null;
    }

    const user = await this.getUserById(memSession.userId);
    if (!user) return null;

    return {
      token: memSession.token,
      user,
    };
  }

  async destroyAppSession(token) {
    if (!token) return;
    memAppSessions.delete(token);
    try {
      await db.delete(schema.appSessions)
        .where(eq(schema.appSessions.token, token))
        .run();
    } catch {}
  }

  async updateSection(userId, section) {
    if (!userId) return;
    const u = memUsers.get(userId);
    if (u) u.section = section;

    try {
      await db.update(schema.users)
        .set({ section, updatedAt: new Date().toISOString() })
        .where(eq(schema.users.id, userId))
        .run();
    } catch (err) {
      console.error("SQLite updateSection failed, updated memory store:", err.message);
    }
  }

  /**
   * Updates the display name (real student name) for a user.
   * @param {string} userId
   * @param {string|null} displayName
   */
  async updateDisplayName(userId, displayName) {
    if (!userId || !displayName) return;
    await db.update(schema.users)
      .set({ displayName, updatedAt: new Date().toISOString() })
      .where(eq(schema.users.id, userId))
      .run();
  }
}

const sessionService = new SessionService();

module.exports = sessionService;
module.exports.fetchSectionFromEduSecure = fetchSectionFromEduSecure;
module.exports.fetchProfileFromEduSecure = fetchProfileFromEduSecure;
