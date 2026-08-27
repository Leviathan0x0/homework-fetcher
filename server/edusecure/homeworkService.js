const { parseHomeworkHtml } = require("./htmlParser");
const { measureRequestTiming } = require("../performance/requestTiming");

const HOMEWORK_URL = "https://edusecure.in/ManavMangalMohali/ParentApp/Announcement.aspx?Type=Homework";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

class SchoolSessionExpiredError extends Error {
  constructor(message = "Your school session has expired.") {
    super(message);
    this.name = "SchoolSessionExpiredError";
    this.code = "SCHOOL_SESSION_EXPIRED";
    this.statusCode = 401;
  }
}

class EduSecurePortalError extends Error {
  constructor(message) {
    super(message);
    this.name = "EduSecurePortalError";
    this.code = "PORTAL_UNREACHABLE";
    this.statusCode = 502;
  }
}

const PORTAL_TIMEOUT_MS = 20_000;
const PORTAL_ATTEMPTS = 2;

async function fetchHomeworkPage(sessionCookies) {
  let lastError = null;

  for (let attempt = 1; attempt <= PORTAL_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PORTAL_TIMEOUT_MS);

    try {
      const response = await fetch(HOMEWORK_URL, {
        headers: {
          "Cookie": sessionCookies,
          "User-Agent": USER_AGENT,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "manual",
        signal: controller.signal,
      });

      if (response.status === 429 || response.status >= 500) {
        await response.text().catch(() => {});
        throw new EduSecurePortalError(
          `EduSecure returned HTTP ${response.status} while loading homework.`
        );
      }
      if (!response.ok && response.status !== 301 && response.status !== 302) {
        await response.text().catch(() => {});
        throw new EduSecurePortalError(
          `EduSecure returned HTTP ${response.status} while loading homework.`
        );
      }

      return response;
    } catch (err) {
      lastError = err;
      if (err instanceof SchoolSessionExpiredError) throw err;
      if (attempt < PORTAL_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError instanceof EduSecurePortalError) throw lastError;
  const detail = lastError?.name === "AbortError"
    ? `EduSecure did not respond within ${PORTAL_TIMEOUT_MS / 1000} seconds.`
    : `EduSecure could not be reached${lastError?.message ? ` (${lastError.message})` : ""}.`;
  throw new EduSecurePortalError(`${detail} Cached homework will remain available.`);
}

/**
 * Fetches homework from EduSecure using the provided user session cookies.
 * @param {string} sessionCookies EduSecure session cookies string
 * @returns {Promise<{count: number, homework: Array}>}
 */
async function fetchHomeworkForSessionWithoutTiming(sessionCookies) {
  if (!sessionCookies) {
    throw new SchoolSessionExpiredError();
  }

  try {
    const response = await fetchHomeworkPage(sessionCookies);

    // Handle ASP.NET redirect to Login.aspx
    if (response.status === 302 || response.status === 301) {
      const location = response.headers.get("location") || "";
      if (location.toLowerCase().includes("login")) {
        throw new SchoolSessionExpiredError();
      }
    }

    const html = await response.text();

    // Check if the body returned the login form instead of announcement table
    if (html.includes("txtusername") || html.includes("Login.aspx") || html.includes("loginWrapper")) {
      throw new SchoolSessionExpiredError();
    }

    const homework = parseHomeworkHtml(html, HOMEWORK_URL);

    return {
      count: homework.length,
      homework
    };
  } catch (err) {
    if (err instanceof SchoolSessionExpiredError) {
      throw err;
    }
    console.error("EduSecure Homework Fetch Error:", err);
    throw err;
  }
}

async function fetchHomeworkForSession(sessionCookies) {
  return measureRequestTiming("edusecure_homework", () =>
    fetchHomeworkForSessionWithoutTiming(sessionCookies)
  );
}

module.exports = {
  fetchHomeworkForSession,
  SchoolSessionExpiredError,
  EduSecurePortalError,
};
