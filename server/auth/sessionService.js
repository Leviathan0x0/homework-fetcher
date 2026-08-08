const crypto = require("crypto");
const { eq, and, gt, sql } = require("drizzle-orm");
const { db, schema } = require("../db/client");
const { encrypt, decrypt } = require("./encryption");
const { deriveKey } = require("./secrets");

const ROMAN_MAP = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };

/** Legacy placeholder written before section was known from EduSecure. */
const UNKNOWN_SECTION_SENTINEL = "Section 10-A";

/**
 * True when section was never resolved from EduSecure.
 * Real Class X-A normalizes to "10-A", which is NOT unknown.
 */
function isUnknownSection(section) {
  if (section == null) return true;
  const cleaned = String(section).trim();
  if (!cleaned) return true;
  return cleaned.toLowerCase() === UNKNOWN_SECTION_SENTINEL.toLowerCase();
}

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
 * @returns {Promise<{section: string|null, displayName: string|null, role: string|null, subjects: string[], assignedSections: string[], classTeacherSections: string[]}>}
 */
const PROFILE_TIMEOUT_MS = 12_000;
const PROFILE_ATTEMPTS = 2;

async function fetchProfilePage(url, sessionCookies) {
  let lastError = null;

  for (let attempt = 1; attempt <= PROFILE_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROFILE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: {
          Cookie: sessionCookies,
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "manual",
        signal: controller.signal,
      });

      if (response.status === 429 || response.status >= 500) {
        await response.text().catch(() => {});
        throw new Error(`EduSecure returned HTTP ${response.status}.`);
      }
      if (!response.ok && response.status !== 301 && response.status !== 302) {
        await response.text().catch(() => {});
        throw new Error(`EduSecure returned HTTP ${response.status}.`);
      }
      return response;
    } catch (err) {
      lastError = err;
      if (attempt < PROFILE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  const reason = lastError?.name === "AbortError"
    ? `EduSecure did not respond within ${PROFILE_TIMEOUT_MS / 1000} seconds.`
    : lastError?.message || "EduSecure profile request failed.";
  throw new Error(reason);
}

function cleanProfileName(raw) {
  const value = String(raw || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[|:–—-]+|[|:–—-]+$/g, "")
    .trim();
  if (!value || value.length < 2 || value.length > 80) return null;
  if (/^(student\s+)?name$|^(profile|student)$/i.test(value)) return null;
  return value;
}

function extractProfileName($, bodyText) {
  const selectors = [
    "#ctl00_ContentPlaceHolder1_sStudentName",
    "#ctl00_ContentPlaceHolder1_sName",
    "#ctl00_ContentPlaceHolder1_lblStudentName",
    "#ctl00_ContentPlaceHolder1_lblName",
    "[id*='StudentName']",
    "[id*='studentname']",
    "[id*='FullName']",
    "[id*='fullName']",
    "input[name*='Name']",
  ];

  for (const selector of selectors) {
    const node = $(selector).first();
    const value = cleanProfileName(node.attr("value") || node.attr("data-name") || node.text());
    if (value) return value;
  }

  let tableName = null;
  $("tr").each((_, row) => {
    const cells = $(row).find("th,td");
    cells.each((index, cell) => {
      if (tableName || index >= cells.length - 1) return;
      const label = $(cell).text().replace(/\s+/g, " ").trim();
      if (/^(student\s+)?name$/i.test(label)) {
        tableName = cleanProfileName($(cells[index + 1]).text());
      }
    });
  });
  if (tableName) return tableName;

  const labelledName = bodyText.match(
    /(?:student\s+name|full\s+name)\s*[:–—-]\s*([A-Za-z][A-Za-z.' -]{1,79}?)(?=\s+(?:class|section|roll|father|mother|gender|date)\b|$)/i
  );
  return cleanProfileName(labelledName?.[1]);
}

async function fetchProfileFromEduSecure(sessionCookies) {
  const empty = {
    section: null,
    displayName: null,
    role: null,
    subjects: [],
    assignedSections: [],
    classTeacherSections: [],
  };
  try {
    const cheerio = require("cheerio");
    const url = "https://edusecure.in/ManavMangalMohali/ParentApp/StudentProfile.aspx";
    const res = await fetchProfilePage(url, sessionCookies);
    if (res.status === 301 || res.status === 302) {
      console.error("Profile fetch redirected (session likely expired)");
      return empty;
    }
    const html = await res.text();
    const lowerHtml = html.toLowerCase();
    if (lowerHtml.includes("txtusername") || lowerHtml.includes("login.aspx")) {
      console.error("Profile page returned login form (session expired)");
      return empty;
    }
    const $ = cheerio.load(html);
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();

    const rawSection = $("#ctl00_ContentPlaceHolder1_sClassSection").first().text().trim();
    let section = null;
    if (rawSection) {
      section = normalizeClassSection(rawSection);
      if (!section) {
        console.error("Could not normalize raw section string:", JSON.stringify(rawSection));
      }
    } else {
      console.error("Section selector returned empty. Body preview:", bodyText.substring(0, 200));
    }

    const displayName = extractProfileName($, bodyText);

    const roleSelectors = [
      "#ctl00_ContentPlaceHolder1_sRole",
      "#ctl00_ContentPlaceHolder1_lblRole",
      "#ctl00_ContentPlaceHolder1_sUserType",
      "[id*='Role']",
      "[id*='Designation']",
    ];
    const roleText = roleSelectors
      .map((selector) => $(selector).first().text().trim())
      .find(Boolean) || "";
    const role = /teacher|faculty|staff|principal|coordinator/i.test(roleText)
      ? "teacher"
      : /teacher|faculty|staff|principal|coordinator/i.test(bodyText) &&
        /designation|role|employee|staff/i.test(bodyText)
        ? "teacher"
        : null;

    const sections = Array.from(new Set(
      [...bodyText.matchAll(/\b(?:I{1,3}|IV|V|VI{0,3}|IX|X|XI|XII|\d{1,2})\s*[-–]\s*[A-Za-z]\b/gi)]
        .map((match) => normalizeClassSection(match[0]))
        .filter(Boolean)
    ));
    const classTeacherSections = /class teacher|class-teacher|homeroom/i.test(bodyText)
      ? sections
      : [];

    return {
      section,
      displayName,
      role,
      subjects: [],
      assignedSections: sections,
      classTeacherSections,
    };
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
 * Resolved sessions, cached for a few seconds.
 *
 * Every authenticated endpoint resolves the same session before it can do any
 * work, which on a hosted database costs a network round trip per request (and
 * the UI fires several requests per screen). A short time-to-live keeps logout,
 * revocation and role changes effectively immediate while collapsing bursts of
 * requests onto a single lookup.
 */
const SESSION_CACHE_TTL_MS = 10 * 1000;
const sessionCache = new Map();

function readCachedSession(token) {
  const entry = sessionCache.get(token);
  if (!entry) return null;
  if (Date.now() > entry.cachedUntil) {
    sessionCache.delete(token);
    return null;
  }
  return entry.session;
}

function writeCachedSession(token, session, jti) {
  // Bounded so a flood of invalid tokens cannot grow the map without limit.
  if (sessionCache.size > 5000) sessionCache.clear();
  sessionCache.set(token, { session, jti, cachedUntil: Date.now() + SESSION_CACHE_TTL_MS });
}

/** Drops the cache entry for a revoked session id. */
function invalidateCachedSessionId(jti) {
  if (!jti) return;
  for (const [token, entry] of sessionCache) {
    if (entry.jti === jti || token === jti) sessionCache.delete(token);
  }
}

/** Drops cached sessions for a user so profile or status changes apply at once. */
function invalidateCachedSessionsForUser(userId) {
  if (!userId) return;
  for (const [token, entry] of sessionCache) {
    if (entry.session?.user?.id === userId) sessionCache.delete(token);
  }
}

/**
 * Fetches only the normalized section string from EduSecure.
 * @param {string} sessionCookies - EduSecure session cookies
 * @returns {Promise<string|null>} Normalized section string like "9-F" or null
 */
async function fetchSectionFromEduSecure(sessionCookies) {
  const profile = await fetchProfileFromEduSecure(sessionCookies);
  return profile.section;
}

// Keep the app session across normal browser returns and server restarts.
// Logging out explicitly still revokes the session immediately.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Key used to sign session cookies. Derived from ENCRYPTION_KEY so every
 * instance of the API agrees on it; without that, a session created by one
 * serverless instance could not be verified by the next one.
 */
function getSigningKey() {
  return deriveKey("app-session-signing-key");
}

const base64url = (buffer) => Buffer.from(buffer).toString("base64url");

/**
 * Builds a signed session token: payload.signature.
 *
 * The signature proves the token was issued by this API, but it is not proof
 * on its own that the session is still live: the payload carries a `jti` that
 * must still have a matching row in app_sessions, which is what makes logout
 * and revocation actually take effect.
 */
function signSessionToken(payload) {
  const body = base64url(JSON.stringify(payload));
  const signature = base64url(crypto.createHmac("sha256", getSigningKey()).update(body).digest());
  return `${body}.${signature}`;
}

/**
 * Verifies a session token and returns its payload, or null when the token is
 * malformed, tampered with or expired.
 */
function verifySessionToken(token) {
  if (!token || !token.includes(".")) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = base64url(crypto.createHmac("sha256", getSigningKey()).update(body).digest());
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload || !payload.uid || !payload.sid || !payload.jti) return null;
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
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
          role: existing.role || "student",
          isMuted: existing.isMuted || 0,
          createdAt: existing.createdAt,
        };
        memUsers.set(u.id, u);
        return u;
      }

      // Case-insensitive match in SQL: reading the whole user table to compare
      // in JavaScript got slower with every account that signed up.
      const caseMatch = await db
        .select()
        .from(schema.users)
        .where(sql`lower(trim(${schema.users.studentId})) = ${normalizedId}`)
        .get();
      if (caseMatch) {
        const u = {
          id: caseMatch.id,
          studentId: caseMatch.studentId,
          displayName: caseMatch.displayName || null,
          section: caseMatch.section,
          role: caseMatch.role || "student",
          isMuted: caseMatch.isMuted || 0,
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
        section: "",
        role: "student",
        isMuted: 0,
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
        role: newUser.role,
        isMuted: newUser.isMuted,
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
        section: "",
        role: "student",
        isMuted: 0,
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
          role: user.role || "student",
          isMuted: user.isMuted || 0,
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
        role: memUser.role || "student",
        isMuted: memUser.isMuted || 0,
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

  async createAppSession(userId, knownUser) {
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const createdAt = new Date().toISOString();
    const jti = crypto.randomUUID();

    // Callers that just loaded the account pass it in: re-reading it here cost
    // an extra database round trip on the login path.
    const user = knownUser || (await this.getUserById(userId));
    const token = signSessionToken({
      jti,
      uid: userId,
      sid: user ? user.studentId : userId,
      exp: expiresAt,
    });

    // The stored row is what keeps the session alive: deleting it (logout,
    // revocation) immediately stops the signed cookie from being accepted.
    // `token` holds the jti, never the cookie value.
    try {
      await db.insert(schema.appSessions)
        .values({
          token: jti,
          userId,
          expiresAt,
          createdAt,
        })
        .run();
    } catch (err) {
      console.error("createAppSession could not store the session:", err.message);
    }

    memAppSessions.set(jti, { jti, userId, expiresAt });

    return token;
  }

  async deleteSessionRecord(jti) {
    memAppSessions.delete(jti);
    invalidateCachedSessionId(jti);
    try {
      await db.delete(schema.appSessions)
        .where(eq(schema.appSessions.token, jti))
        .run();
    } catch {}
  }

  async getAppSession(token) {
    if (!token) return null;

    const cached = readCachedSession(token);
    if (cached) return cached;

    const payload = verifySessionToken(token);
    if (payload) {
      // Session row and account are read together: a signature check that costs
      // two sequential round trips would double the latency of every request.
      const row = await this.loadSessionWithUser(payload.jti);
      if (!row) return null;

      if (Date.now() > row.expiresAt) {
        await this.deleteSessionRecord(payload.jti);
        return null;
      }

      const session = { token, user: row.user };
      writeCachedSession(token, session, payload.jti);
      return session;
    }

    // Legacy opaque tokens issued before signed cookies existed.
    try {
      const row = await this.loadSessionWithUser(token);
      if (row) {
        if (Date.now() > row.expiresAt) {
          await this.deleteSessionRecord(token);
          return null;
        }
        const session = { token, user: row.user };
        writeCachedSession(token, session, token);
        return session;
      }
    } catch (err) {
      console.error("getAppSession database lookup failed:", err.message);
    }

    return null;
  }

  /**
   * Reads a session row together with its account in a single query.
   * @param {string} sessionKey the stored app_sessions.token value (jti)
   * @returns {Promise<{expiresAt: number, user: object}|null>}
   */
  async loadSessionWithUser(sessionKey) {
    try {
      const row = await db
        .select({
          expiresAt: schema.appSessions.expiresAt,
          id: schema.users.id,
          studentId: schema.users.studentId,
          displayName: schema.users.displayName,
          section: schema.users.section,
          role: schema.users.role,
          isMuted: schema.users.isMuted,
          createdAt: schema.users.createdAt,
        })
        .from(schema.appSessions)
        .innerJoin(schema.users, eq(schema.users.id, schema.appSessions.userId))
        .where(eq(schema.appSessions.token, sessionKey))
        .get();

      if (row) {
        return {
          expiresAt: row.expiresAt,
          user: {
            id: row.id,
            studentId: row.studentId,
            displayName: row.displayName || null,
            section: row.section,
            role: row.role || "student",
            isMuted: row.isMuted || 0,
            createdAt: row.createdAt,
          },
        };
      }
    } catch (err) {
      // A database hiccup must not hand out access on its own, so fall back to
      // this instance's own record of the session rather than to "allow".
      console.error("Session lookup failed, checking memory store:", err.message);
    }

    const record = memAppSessions.get(sessionKey);
    if (!record) return null;
    const memUser = memUsers.get(record.userId);
    if (!memUser) return null;
    return {
      expiresAt: record.expiresAt,
      user: {
        id: memUser.id,
        studentId: memUser.studentId,
        displayName: memUser.displayName || null,
        section: memUser.section,
        role: memUser.role || "student",
        isMuted: memUser.isMuted || 0,
        createdAt: memUser.createdAt,
      },
    };
  }

  async destroyAppSession(token) {
    if (!token) return;

    sessionCache.delete(token);

    const payload = verifySessionToken(token);
    if (payload) {
      await this.deleteSessionRecord(payload.jti);
      return;
    }

    // Legacy opaque token: the cookie value is the stored key.
    await this.deleteSessionRecord(token);
  }

  /**
   * Revokes every session belonging to a user, on every device.
   * @param {string} userId
   */
  async destroyAllUserSessions(userId) {
    if (!userId) return;
    invalidateCachedSessionsForUser(userId);
    for (const [jti, session] of memAppSessions) {
      if (session.userId === userId) memAppSessions.delete(jti);
    }
    try {
      await db.delete(schema.appSessions)
        .where(eq(schema.appSessions.userId, userId))
        .run();
    } catch (err) {
      console.error("destroyAllUserSessions failed:", err.message);
    }
  }

  async updateSection(userId, section) {
    if (!userId) return;
    const u = memUsers.get(userId);
    if (u) u.section = section;
    invalidateCachedSessionsForUser(userId);

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
    const cached = memUsers.get(userId);
    if (cached) cached.displayName = displayName;
    invalidateCachedSessionsForUser(userId);
    await db.update(schema.users)
      .set({ displayName, updatedAt: new Date().toISOString() })
      .where(eq(schema.users.id, userId))
      .run();
  }

  /**
   * Writes the fields resolved from the EduSecure profile page in one statement.
   *
   * Section and display name arrive together, so updating them separately spent
   * two round trips on the login path for a single row.
   *
   * @param {string} userId
   * @param {{section?: string|null, displayName?: string|null}} fields
   */
  async updateProfileFields(userId, fields = {}) {
    if (!userId) return;

    const changes = {};
    if (fields.section) changes.section = fields.section;
    if (fields.displayName) changes.displayName = fields.displayName;
    if (Object.keys(changes).length === 0) return;

    const cached = memUsers.get(userId);
    if (cached) Object.assign(cached, changes);
    invalidateCachedSessionsForUser(userId);

    try {
      await db.update(schema.users)
        .set({ ...changes, updatedAt: new Date().toISOString() })
        .where(eq(schema.users.id, userId))
        .run();
    } catch (err) {
      console.error("updateProfileFields failed, updated memory store:", err.message);
    }
  }
}

const sessionService = new SessionService();

/**
 * True for the administrator account.
 *
 * Administrators sign in against local credentials, never EduSecure, so they
 * have no school session and no diary to scrape. Code that talks to the school
 * portal has to skip them rather than reporting their (permanently absent)
 * school session as expired.
 */
function isAdminAccount(user) {
  if (!user) return false;
  return (
    user.role === "admin" ||
    user.studentId === "admin_mmss" ||
    user.section === "Admin"
  );
}

module.exports = sessionService;
module.exports.SESSION_TTL_MS = SESSION_TTL_MS;
module.exports.invalidateCachedSessionsForUser = invalidateCachedSessionsForUser;
module.exports.fetchSectionFromEduSecure = fetchSectionFromEduSecure;
module.exports.fetchProfileFromEduSecure = fetchProfileFromEduSecure;
module.exports.isUnknownSection = isUnknownSection;
module.exports.UNKNOWN_SECTION_SENTINEL = UNKNOWN_SECTION_SENTINEL;
module.exports.normalizeClassSection = normalizeClassSection;
module.exports.isAdminAccount = isAdminAccount;
