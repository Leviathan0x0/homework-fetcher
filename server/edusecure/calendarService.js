const cheerio = require("cheerio");
const { SchoolSessionExpiredError } = require("./homeworkService");

const CALENDAR_URL =
  "https://edusecure.in/ManavMangalMohali/ParentApp/CurrentSchoolCalendar.aspx";
const DASHBOARD_URL =
  "https://edusecure.in/ManavMangalMohali/ParentApp/Dashboard.aspx";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const MONTHS = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

/**
 * Parses EduSecure date strings into YYYY-MM-DD.
 * Supports "Friday , 31 Jul 2026", "31/07/2026", "31 Jul 2026".
 */
function parseEventDateToYmd(raw) {
  if (!raw || typeof raw !== "string") return null;
  const str = raw.replace(/^Date\s*:?\s*/i, "").trim();
  if (!str) return null;

  const dmy = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const named = str.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (named) {
    const day = Number(named[1]);
    const month = MONTHS[named[2].toLowerCase()];
    const year = Number(named[3]);
    if (month != null && day >= 1 && day <= 31) {
      return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  return null;
}

function eventIdFromHref(href) {
  if (!href) return null;
  const match = String(href).match(/EventDetails\.aspx\?id=(\d+)/i);
  return match ? match[1] : null;
}

function resolveEventUrl(href) {
  if (!href) return null;
  try {
    return new URL(href, CALENDAR_URL).href;
  } catch {
    return href;
  }
}

/**
 * Parses CurrentSchoolCalendar.aspx HTML into structured events.
 */
function parseSchoolCalendarHtml(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const events = [];
  const seen = new Set();

  $("#ctl00_ContentPlaceHolder1_grdviewMonths > tbody > tr, #ctl00_ContentPlaceHolder1_grdviewMonths > tr").each((_, monthRow) => {
    const monthNode = $(monthRow).find("[id$='_DivMonth']").first().clone();
    monthNode.find("table, a").remove();
    const monthLabel = monthNode.text().replace(/\s+/g, " ").trim() || null;

    $(monthRow)
      .find("a[href*='EventDetails']")
      .each((__, node) => {
        const link = $(node);
        if (!link.length) return;

        const href = link.attr("href") || "";
        const sourceId = eventIdFromHref(href);
        const type =
          link.find("small.status, .status, [id$='_lblType']").first().text().trim() ||
          "Event";
        const dateRaw =
          link.find("span").first().text().replace(/\s+/g, " ").trim() ||
          "";
        const title =
          link.find("b, h2").first().text().replace(/\s+/g, " ").trim() ||
          link.text().replace(/\s+/g, " ").trim();

        const ymd = parseEventDateToYmd(dateRaw);
        if (!title || !ymd) return;

        const key = `${ymd}:${title.toLowerCase()}`;
        if (seen.has(key)) return;
        seen.add(key);

        events.push({
          sourceId,
          title,
          type,
          date: ymd,
          dateRaw: dateRaw || ymd,
          monthLabel: monthLabel || null,
          url: resolveEventUrl(href),
        });
      });
  });

  return events;
}

/**
 * Parses upcoming events carousel on Dashboard.aspx (fallback / supplement).
 */
function parseDashboardEventsHtml(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const events = [];
  const seen = new Set();

  $("a[href*='EventDetails']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const sourceId = eventIdFromHref(href);
    const title = $(el).find("b").first().text().replace(/\s+/g, " ").trim();
    const dateRaw = $(el)
      .find("p")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .replace(/^Date\s*:?\s*/i, "")
      .trim();
    const ymd = parseEventDateToYmd(dateRaw);
    if (!title || !ymd) return;

    const key = `${ymd}:${title.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);

    events.push({
      sourceId,
      title,
      type: "Event",
      date: ymd,
      dateRaw: dateRaw || ymd,
      monthLabel: null,
      url: resolveEventUrl(href),
    });
  });

  return events;
}

async function portalGet(url, sessionCookies) {
  const response = await fetch(url, {
    headers: {
      Cookie: sessionCookies,
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "manual",
  });

  if (response.status === 302 || response.status === 301) {
    const location = response.headers.get("location") || "";
    if (location.toLowerCase().includes("login")) {
      throw new SchoolSessionExpiredError();
    }
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
}

/**
 * Fetches school calendar holidays/events from EduSecure for the signed-in session.
 * @param {string} sessionCookies
 * @returns {Promise<{count: number, events: Array}>}
 */
async function fetchSchoolCalendarForSession(sessionCookies) {
  if (!sessionCookies) {
    throw new SchoolSessionExpiredError();
  }

  try {
    const [calendarHtml, dashboardHtml] = await Promise.all([
      portalGet(CALENDAR_URL, sessionCookies),
      portalGet(DASHBOARD_URL, sessionCookies).catch(() => ""),
    ]);

    const fromCalendar = parseSchoolCalendarHtml(calendarHtml);
    const fromDashboard = parseDashboardEventsHtml(dashboardHtml);

    const byKey = new Map();
    for (const event of [...fromCalendar, ...fromDashboard]) {
      const key = `${event.date}:${event.title.toLowerCase()}`;
      const existing = byKey.get(key);
      // Prefer School Calendar rows (they carry Holiday vs Event type).
      if (!existing || (existing.type === "Event" && event.type !== "Event")) {
        byKey.set(key, event);
      }
    }

    const events = Array.from(byKey.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    return { count: events.length, events };
  } catch (err) {
    if (err instanceof SchoolSessionExpiredError) throw err;
    console.error("EduSecure School Calendar Fetch Error:", err);
    throw err;
  }
}

module.exports = {
  fetchSchoolCalendarForSession,
  parseSchoolCalendarHtml,
  parseDashboardEventsHtml,
  parseEventDateToYmd,
  CALENDAR_URL,
};
