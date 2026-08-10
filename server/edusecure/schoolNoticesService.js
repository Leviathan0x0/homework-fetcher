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
const ATTACHMENT_TIMEOUT_MS = 30_000;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

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
  if (fromElement && !/^(?:view|download|attachment)(?:\s+(?:file|attachment))?$/i.test(fromElement)) {
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

function isLikelyAttachmentLink(link) {
  const href = String(link.attr("href") || "").trim();
  if (!href || /^(?:#|javascript:|mailto:|tel:)/i.test(href)) return false;

  const descriptor = compactText(
    [link.attr("id"), link.attr("class"), link.attr("title"), link.attr("download"), link.text()].join(" ")
  );
  return (
    /(?:hyperlink\d*|attachment|download|view\s+file)/i.test(descriptor) ||
    /\/(?:files?|uploads?|documents?)\//i.test(href) ||
    /\.(?:pdf|docx?|xlsx?|pptx?|txt|csv|zip|rar|7z|png|jpe?g|webp|gif)(?:$|[?#])/i.test(href)
  );
}

function parseAttachments($, entry, baseUrl) {
  const attachments = [];
  const seen = new Set();

  entry.find("a[href]").each((_, element) => {
    const link = $(element);
    if (!isLikelyAttachmentLink(link)) return;
    const url = resolveUrl(link.attr("href"), baseUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    attachments.push({
      url,
      name: attachmentName(link, url),
    });
  });

  return attachments;
}
function noticeId(kind, notice) {
  return crypto
    .createHash("sha256")
    .update(
      [
        kind,
        notice.date,
        notice.title,
        notice.content,
        ...(notice.attachments || []).map((attachment) => attachment.url),
      ]
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

    const attachments = parseAttachments($, entry, source.url);
    const firstAttachment = attachments[0] || null;
    const notice = {
      kind: source.kind,
      type:
        compactText(entry.find('[id$="_lbltype"], [id$="_lblType"]').first().text()) ||
        source.portalType,
      date: compactText(entry.find("small").first().text()),
      title: title || null,
      content,
      attachments,
      // Kept for compatibility with a cached response from the first release.
      attachment: firstAttachment?.url || null,
      attachmentName: firstAttachment?.name || null,
    };
    const id = noticeId(source.kind, notice);
    if (seen.has(id)) return;
    seen.add(id);
    notices.push({ id, ...notice });
  });

  return notices;
}

function allowedAttachmentUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return (
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === "edusecure.in" &&
      url.pathname.toLowerCase().startsWith("/manavmangalmohali/")
    );
  } catch {
    return false;
  }
}

function filenameFromDisposition(value) {
  const encoded = String(value || "").match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.replace(/^"|"$/g, ""));
    } catch {}
  }
  return String(value || "").match(/filename="?([^";]+)"?/i)?.[1]?.trim() || null;
}

function filenameFromUrl(value) {
  try {
    const url = new URL(value);
    const name = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
    return name ? decodeURIComponent(name) : null;
  } catch {
    return null;
  }
}

function attachmentTooLargeError() {
  const error = new Error("This school attachment is too large to preview.");
  error.statusCode = 413;
  error.code = "ATTACHMENT_TOO_LARGE";
  return error;
}

async function readAttachmentBody(response) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > MAX_ATTACHMENT_BYTES) {
        await reader.cancel().catch(() => {});
        throw attachmentTooLargeError();
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, total);
}

/** Fetches a school attachment with the student's server-side EduSecure session. */
async function fetchSchoolNoticeAttachment(sessionCookies, targetUrl) {
  if (!sessionCookies) throw new SchoolSessionExpiredError();
  if (!allowedAttachmentUrl(targetUrl)) {
    const error = new Error("Invalid school attachment URL.");
    error.statusCode = 400;
    error.code = "INVALID_ATTACHMENT_URL";
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATTACHMENT_TIMEOUT_MS);
  let currentUrl = new URL(targetUrl).href;

  try {
    for (let redirects = 0; redirects <= 2; redirects += 1) {
      const response = await fetch(currentUrl, {
        headers: {
          Cookie: sessionCookies,
          "User-Agent": USER_AGENT,
          Accept: "*/*",
          Referer: ANNOUNCEMENT_BASE_URL,
        },
        redirect: "manual",
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location") || "";
        if (/login/i.test(location)) throw new SchoolSessionExpiredError();
        const redirected = resolveUrl(location, currentUrl);
        if (!redirected || !allowedAttachmentUrl(redirected) || redirects === 2) {
          throw new EduSecurePortalError("EduSecure returned an invalid attachment redirect.");
        }
        currentUrl = redirected;
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new EduSecurePortalError(
          `EduSecure returned HTTP ${response.status} while loading an attachment.`
        );
      }

      const declaredLength = Number(response.headers.get("content-length") || 0);
      if (declaredLength > MAX_ATTACHMENT_BYTES) {
        await response.body?.cancel().catch(() => {});
        throw attachmentTooLargeError();
      }

      const buffer = await readAttachmentBody(response);

      const contentType = (response.headers.get("content-type") || "application/octet-stream")
        .split(";")[0]
        .trim()
        .toLowerCase();
      if (contentType === "text/html") {
        const html = buffer.subarray(0, 32 * 1024).toString("utf8");
        if (/txtusername|login\.aspx|loginwrapper/i.test(html)) {
          throw new SchoolSessionExpiredError();
        }
      }

      return {
        buffer,
        contentType,
        filename:
          filenameFromDisposition(response.headers.get("content-disposition")) ||
          filenameFromUrl(currentUrl) ||
          "school-attachment",
      };
    }
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new EduSecurePortalError("EduSecure took too long to load this attachment.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  throw new EduSecurePortalError("EduSecure could not load this attachment.");
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
  allowedAttachmentUrl,
  fetchSchoolNoticeAttachment,
  fetchSchoolNoticesForSession,
  getNoticeSource,
  parseSchoolNoticesHtml,
};
