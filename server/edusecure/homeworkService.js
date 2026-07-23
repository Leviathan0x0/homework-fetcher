const { parseHomeworkHtml } = require("./htmlParser");

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

/**
 * Fetches homework from EduSecure using the provided user session cookies.
 * @param {string} sessionCookies EduSecure session cookies string
 * @returns {Promise<{count: number, homework: Array}>}
 */
async function fetchHomeworkForSession(sessionCookies) {
  if (!sessionCookies) {
    throw new SchoolSessionExpiredError();
  }

  try {
    const response = await fetch(HOMEWORK_URL, {
      headers: {
        "Cookie": sessionCookies,
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      redirect: "manual"
    });

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

module.exports = {
  fetchHomeworkForSession,
  SchoolSessionExpiredError
};
