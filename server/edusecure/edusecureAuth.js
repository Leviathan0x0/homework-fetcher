const cheerio = require("cheerio");

const LOGIN_URL = "https://edusecure.in/ManavMangalMohali/ParentApp/Login.aspx";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Authentication error carrying a machine-readable cause so callers can tell
 * rejected credentials apart from an unreachable/broken school portal.
 */
class EduSecureAuthError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "EduSecureAuthError";
    this.code = code;
  }
}

const invalidCredentialsError = () =>
  new EduSecureAuthError("Invalid student ID or password", "invalid_credentials");

/**
 * Performs a request against the school portal, converting transport failures
 * (DNS, TLS, blocked egress, timeouts) into a portal_unreachable error instead
 * of letting them surface as an authentication failure.
 */
async function portalFetch(url, options, step) {
  try {
    return await fetch(url, options);
  } catch (err) {
    throw new EduSecureAuthError(
      `Could not reach the school portal while ${step} (${err.message}). The server hosting this app may not be allowed to make outbound requests to edusecure.in.`,
      "portal_unreachable"
    );
  }
}

/**
 * Extracts and merges Cookie values into a single Map or Cookie string.
 * @param {Array<string>} setCookieHeaders 
 * @param {Map<string, string>} existingCookieMap 
 */
function extractCookies(setCookieHeaders, existingCookieMap = new Map()) {
  if (!setCookieHeaders || !Array.isArray(setCookieHeaders)) return existingCookieMap;

  for (const header of setCookieHeaders) {
    if (!header) continue;
    const firstPart = header.split(";")[0];
    const equalIdx = firstPart.indexOf("=");
    if (equalIdx !== -1) {
      const key = firstPart.slice(0, equalIdx).trim();
      const val = firstPart.slice(equalIdx + 1).trim();
      if (val) {
        existingCookieMap.set(key, val);
      } else {
        if (existingCookieMap.has(key) && val === "") {
          existingCookieMap.set(key, val);
        }
      }
    }
  }
  return existingCookieMap;
}

/**
 * Converts Cookie map to header string
 * @param {Map<string, string>} cookieMap 
 * @returns {string}
 */
function mapToCookieString(cookieMap) {
  const parts = [];
  for (const [k, v] of cookieMap.entries()) {
    if (v) {
      parts.push(`${k}=${v}`);
    }
  }
  return parts.join("; ");
}

/**
 * Authenticates user credentials against EduSecure ASP.NET portal.
 * Returns the authenticated EduSecure session cookie string.
 * 
 * SECURITY: Password parameter is NEVER stored, logged, or retained.
 * 
 * @param {string} studentId 
 * @param {string} password 
 * @returns {Promise<string>} eduSecureCookieString
 */
async function loginToEduSecure(studentId, password) {
  if (!studentId || !password) {
    throw invalidCredentialsError();
  }

  const cookieMap = new Map();

  // Step 1: Initial GET to fetch ASP.NET viewstate and session tokens
  const getRes = await portalFetch(LOGIN_URL, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  }, "loading the login page");

  const getSetCookies = getRes.headers.getSetCookie ? getRes.headers.getSetCookie() : [];
  extractCookies(getSetCookies, cookieMap);

  const html = await getRes.text();
  const $ = cheerio.load(html);

  const viewState = $("#__VIEWSTATE").val() || "";
  const viewStateGen = $("#__VIEWSTATEGENERATOR").val() || "";
  const eventVal = $("#__EVENTVALIDATION").val() || "";

  if (!viewState) {
    throw new EduSecureAuthError(
      `Unable to load the EduSecure login form (portal responded with HTTP ${getRes.status}). Please try again later.`,
      "portal_unreachable"
    );
  }

  // Extract all session options (e.g. ['2025-2026', '2026-2027'])
  const sessionOptions = [];
  $("#drpSession option").each((_, el) => {
    const val = $(el).val();
    if (val && !sessionOptions.includes(val)) sessionOptions.push(val);
  });

  // Prioritize active academic session "2025-2026" first, then remaining options
  if (sessionOptions.includes("2025-2026")) {
    sessionOptions.sort((a, b) => (a === "2025-2026" ? -1 : b === "2025-2026" ? 1 : 0));
  }
  if (sessionOptions.length === 0) sessionOptions.push("2025-2026");

  let portalUnreachableError = null;

  for (const sessionYear of sessionOptions) {
    try {
      const trialCookieMap = new Map(cookieMap);

      const params = new URLSearchParams();
      params.append("__EVENTTARGET", "");
      params.append("__EVENTARGUMENT", "");
      params.append("__VIEWSTATE", viewState);
      if (viewStateGen) params.append("__VIEWSTATEGENERATOR", viewStateGen);
      if (eventVal) params.append("__EVENTVALIDATION", eventVal);
      params.append("drpSession", sessionYear);
      params.append("txtusername", studentId.trim());
      params.append("txtpassword", password);
      params.append("btnLogin", "Login");

      const postCookieHeader = mapToCookieString(trialCookieMap);

      const postRes = await portalFetch(LOGIN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Cookie": postCookieHeader,
          "User-Agent": USER_AGENT,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Referer": LOGIN_URL
        },
        body: params.toString(),
        redirect: "manual"
      }, "submitting your credentials");

      const postSetCookies = postRes.headers.getSetCookie ? postRes.headers.getSetCookie() : [];
      extractCookies(postSetCookies, trialCookieMap);

      const postHtml = await postRes.text();

      const isInvalid = postHtml.includes("Invalid username and password") || 
                        postHtml.includes("Invalid username") || 
                        postHtml.includes("Invalid password");

      if (isInvalid) {
        continue;
      }

      const finalCookieString = mapToCookieString(trialCookieMap);

      // Verify authentication by fetching Announcement.aspx
      const verifyRes = await portalFetch("https://edusecure.in/ManavMangalMohali/ParentApp/Announcement.aspx?Type=Homework", {
        headers: {
          "Cookie": finalCookieString,
          "User-Agent": USER_AGENT
        },
        redirect: "manual"
      }, "verifying the school session");

      const verifySetCookies = verifyRes.headers.getSetCookie ? verifyRes.headers.getSetCookie() : [];
      extractCookies(verifySetCookies, trialCookieMap);

      const verifyHtml = await verifyRes.text();

      if (verifyRes.status === 302 || verifyHtml.includes("Login.aspx") || verifyHtml.includes("txtusername")) {
        continue;
      }

      const sessionCookies = mapToCookieString(trialCookieMap);
      if (sessionCookies) {
        return sessionCookies;
      }
    } catch (err) {
      if (err instanceof EduSecureAuthError && err.code === "portal_unreachable") {
        portalUnreachableError = err;
      }
    }
  }

  if (portalUnreachableError) {
    throw portalUnreachableError;
  }

  throw invalidCredentialsError();
}

module.exports = {
  loginToEduSecure,
  EduSecureAuthError
};
