const crypto = require("crypto");
const cheerio = require("cheerio");
const {
  EduSecurePortalError,
  SchoolSessionExpiredError,
} = require("./homeworkService");

const ANNOUNCEMENT_BASE_URL =
  "https://edusecure.in/ManavMangalMohali/ParentApp/Announcement.aspx";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PORTAL_TIMEOUT_MS = 20_000;
const PORTAL_ATTEMPTS = 2;

const NOTICE_SOURCES = Object.freeze({
  circulars: Object.freeze({
    kind: "circulars",
    portalType: "Announcement",
    url: `${ANNOUNCEMENT_BASE_URL}?Type=Announcement`,
  }),
  important: Object.freeze({
    kind: "important",
    portalType: "Message",
    url: `${ANNOUNCEMENT_BASE_URL}?Type=Message`,
  }),
});

function getNoticeSource(kind) {
  return NOTICE_SOURCES[String(kind || "").trim().toLowerCase()] || null;
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function textWithLineBreaks($, node) {
  if (!node?.length) return "";
  const copy = node.clone();
  copy.find("script, style, button").remove();
  copy.find("br").replaceWith("\n");
  return copy
    .text()
    .replace(/\r/g, "")
    .split("\n")
    .map(compactText)
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isFieldLabel(value) {
  return /^(?:subject|description|details?|message|announcement|circular|notice|homework)\s*:?$/i.test(
    compactText(value)
  );
}

function withoutLeadingText(value, prefix) {
  const text = String(value || "").trim();
  const leading = compactText(prefix);
  if (!leading || !text.toLowerCase().startsWith(leading.toLowerCase())) return text;
  return text.slice(leading.length).replace(/^\s*[:\-–—]\s*/, "").trim();
}

function resolveUrl(href, baseUrl) {
  if (!href) return null;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

function attachmentName(link, resolvedUrl) {
  const fromElement = compactText(
    link.attr("download") || link.attr("title") || link.text()
  );
  if (fromElement && !/^(?:view|download|attachment)$/i.test(fromElement)) {
    return fromElement;
  }
  try {
    const pathname = new URL(resolvedUrl).pathname;
    const filename = pathname.slice(pathname.lastIndexOf("/") + 1);
    return filename ? decodeURIComponent(filename) : null;
  } catch {
    return null;
  }
}

function noticeId(kind, notice) {
  return crypto
    .createHash("sha256")
    .update(
      [kind, notice.date, notice.title, notice.content, notice.attachment]
        .map((value) => String(value || "").trim().toLowerCase())
        .join(":")
    )
    .digest("hex")
    .slice(0, 24);
}

/**
 * Parses either EduSecure Announcement.aspx table into plain, safe notice data.
 * The two supplied pages share this markup; only their Type query differs.
 */
function parseSchoolNoticesHtml(html, kind) {
  const source = getNoticeSource(kind);
  if (!html || !source) return [];

  const $ = cheerio.load(html);
  const notices = [];
  const seen = new Set();

  $("#ctl00_ContentPlaceHolder1_grdDashContents tr").each((_, row) => {
    const entry = $(row);
    const paragraph = entry.find("p").first();
    const attachmentLink = entry.find('a[id$="_HyperLink1"]').first();

    let title = compactText(
      entry
        .find(
          '[id$="_lblsubject"], [id$="_lblSubject"], [id$="_lbltitle"], [id$="_lblTitle"], [id$="_lblheading"], [id$="_lblHeading"]'
        )
        .first()
        .text()
    );
    let content = textWithLineBreaks($, paragraph);

    const leadingBold = compactText(paragraph.find("b, strong").first().text());
    if (leadingBold && content.toLowerCase().startsWith(leadingBold.toLowerCase())) {
      if (isFieldLabel(leadingBold)) {
        content = withoutLeadingText(content, leadingBold);
      } else if (!title && leadingBold.length <= 120) {
        title = leadingBold.replace(/\s*[:\-–—]\s*$/, "").trim();
        content = withoutLeadingText(content, leadingBold);
      }
    }

    if (title && content.toLowerCase() === title.toLowerCase()) {
      content = "";
    }
    if (!content && title) {
      content = title;
      title = "";
    }
    if (!content) return;

    const href = attachmentLink.attr("href") || "";
    const attachment = resolveUrl(href, source.url);
    const notice = {
      kind: source.kind,
      type:
        compactText(entry.find('[id$="_lbltype"], [id$="_lblType"]').first().text()) ||
        source.portalType,
      date: compactText(entry.find("small").first().text()),
      title: title || null,
      content,
      attachment,
      attachmentName: attachment ? attachmentName(attachmentLink, attachment) : null,
    };
    const id = noticeId(source.kind, notice);
    if (seen.has(id)) return;
    seen.add(id);
    notices.push({ id, ...notice });
  });

  return notices;
}

async function fetchNoticePage(source, sessionCookies) {
  let lastError = null;

  for (let attempt = 1; attempt <= PORTAL_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PORTAL_TIMEOUT_MS);

    try {
      const response = await fetch(source.url, {
        headers: {
          Cookie: sessionCookies,
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "manual",
        signal: controller.signal,
      });

      if (response.status === 301 || response.status === 302) {
        const location = response.headers.get("location") || "";
        if (location.toLowerCase().includes("login")) {
          throw new SchoolSessionExpiredError();
        }
      }
      if (response.status === 429 || response.status >= 500) {
        await response.text().catch(() => {});
        throw new EduSecurePortalError(
          `EduSecure returned HTTP ${response.status} while loading school updates.`
        );
      }
      if (!response.ok && response.status !== 301 && response.status !== 302) {
        await response.text().catch(() => {});
        throw new EduSecurePortalError(
          `EduSecure returned HTTP ${response.status} while loading school updates.`
        );
      }

      const html = await response.text();
      if (
        html.includes("txtusername") ||
        html.includes("Login.aspx") ||
        html.includes("loginWrapper")
      ) {
        throw new SchoolSessionExpiredError();
      }
      return html;
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
  const detail =
    lastError?.name === "AbortError"
      ? `EduSecure did not respond within ${PORTAL_TIMEOUT_MS / 1000} seconds.`
      : "EduSecure could not be reached.";
  throw new EduSecurePortalError(detail);
}

async function fetchSchoolNoticesForSession(sessionCookies, kind) {
  const source = getNoticeSource(kind);
  if (!source) {
    const error = new Error("Unknown school update type.");
    error.code = "INVALID_NOTICE_KIND";
    error.statusCode = 400;
    throw error;
  }
  if (!sessionCookies) throw new SchoolSessionExpiredError();

  const html = await fetchNoticePage(source, sessionCookies);
  const notices = parseSchoolNoticesHtml(html, source.kind);
  return { count: notices.length, notices };
}

module.exports = {
  NOTICE_SOURCES,
  fetchSchoolNoticesForSession,
  getNoticeSource,
  parseSchoolNoticesHtml,
};
