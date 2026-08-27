const cheerio = require("cheerio");
const { SchoolSessionExpiredError } = require("./homeworkService");
const { measureRequestTiming } = require("../performance/requestTiming");

const BASE_URL = "https://edusecure.in/ManavMangalMohali/ParentApp/";
const DASHBOARD_URL = `${BASE_URL}Dashboard.aspx`;
const KNOWN_ATTENDANCE_URL =
  "https://edusecure.in/ManavMangalMohali/Parents/studentAttendance.aspx";
const DISCOVERY_URLS = [
  DASHBOARD_URL,
  `${BASE_URL}Announcement.aspx?Type=Homework`,
  `${BASE_URL}CurrentSchoolCalendar.aspx`,
  `${BASE_URL}StudentProfile.aspx`,
];
const DEFAULT_ATTENDANCE_PATHS = [
  "StudentAttendance.aspx",
  "StudentAttendence.aspx",
  "StudentAttendanceReport.aspx",
  "StudentAttendenceReport.aspx",
  "Attendance.aspx",
  "Attendence.aspx",
  "AttendanceDetails.aspx",
  "MonthlyAttendance.aspx",
  "AttendanceReport.aspx",
  "AttendenceReport.aspx",
];
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 12_000;

class AttendanceUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "AttendanceUnavailableError";
    this.code = "ATTENDANCE_UNAVAILABLE";
    this.statusCode = 502;
  }
}

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

function parseDate(raw) {
  const value = String(raw || "").replace(/\s+/g, " ").trim();
  if (!value) return null;

  const dmy = value.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const named = value.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/);
  if (named && MONTHS[named[2].toLowerCase()] != null) {
    const day = Number(named[1]);
    const month = MONTHS[named[2].toLowerCase()] + 1;
    return `${named[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const iso = value.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    return `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}-${String(Number(iso[3])).padStart(2, "0")}`;
  }
  return null;
}

function normalizeStatus(raw) {
  const value = String(raw || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!value) return "unknown";
  if (/absent|^a$|not present/.test(value)) return "absent";
  if (/late|^l$|delay/.test(value)) return "late";
  if (/excused|leave|holiday|medical/.test(value)) return "excused";
  if (/present|^p$|attended/.test(value)) return "present";
  return "unknown";
}

function parseAttendanceHtml(html, sourceUrl) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const records = [];
  const seen = new Set();

  $("table").each((_, table) => {
    const rows = $(table).find("tr");
    if (rows.length < 2) return;
    const firstCells = $(rows[0]).find("th,td").map((__, cell) =>
      $(cell).text().replace(/\s+/g, " ").trim().toLowerCase()
    ).get();
    const dateIndex = firstCells.findIndex((cell) => /date|day/.test(cell));
    const statusIndex = firstCells.findIndex((cell) => /status|attendance|present|remark|p\s*\/\s*a/.test(cell));

    rows.slice(1).each((__, row) => {
      const cells = $(row).find("td,th").map((___, cell) =>
        $(cell).text().replace(/\s+/g, " ").trim()
      ).get();
      if (!cells.length) return;
      const date = parseDate(dateIndex >= 0 ? cells[dateIndex] : cells.join(" "));
      if (!date) return;
      const statusRaw = statusIndex >= 0
        ? cells[statusIndex]
        : cells.find((cell) => /^(present|absent|late|leave|excused|p|a|l|e)$/i.test(cell)) || "";
      const status = normalizeStatus(statusRaw);
      const key = `${date}:${status}`;
      if (seen.has(key)) return;
      seen.add(key);
      records.push({
        date,
        status,
        label: statusRaw || "Not specified",
        source: sourceUrl,
      });
    });
  });

  // Some EduSecure themes render attendance rows as cards/list items instead
  // of a table. Only inspect short blocks containing both a date and a status
  // so navigation text and summary counters do not become fake records.
  $("div, p, li, article, [class*='attendance'], [class*='attendence'], [id*='attendance'], [id*='attendence']").each((_, node) => {
    const text = $(node).text().replace(/\s+/g, " ").trim();
    if (!text || text.length > 180) return;
    const date = parseDate(text);
    if (!date) return;
    const statusRaw = text.match(/\b(present|absent|late|excused|leave|medical|p|a|l|e)\b/i)?.[1] || "";
    const status = normalizeStatus(statusRaw);
    if (!statusRaw || status === "unknown") return;
    const key = `${date}:${status}`;
    if (seen.has(key)) return;
    seen.add(key);
    records.push({ date, status, label: statusRaw, source: sourceUrl });
  });

  // Last-resort support for WebForms pages that flatten rows into text while
  // rendering the visual grid with script/CSS. Read only a short window after
  // each date so unrelated page text cannot be mistaken for attendance.
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const datePattern = /\b(?:\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|\d{4}-\d{1,2}-\d{1,2})\b/g;
  for (const match of bodyText.matchAll(datePattern)) {
    const date = parseDate(match[0]);
    const start = match.index ?? 0;
    const nearby = bodyText.slice(start + match[0].length, start + match[0].length + 100);
    const statusRaw = nearby.match(/\b(present|absent|late|excused|leave|medical|p|a|l|e)\b/i)?.[1] || "";
    const status = normalizeStatus(statusRaw);
    if (!date || !statusRaw || status === "unknown") continue;
    const key = `${date}:${status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    records.push({ date, status, label: statusRaw, source: sourceUrl });
  }

  return records.sort((a, b) => b.date.localeCompare(a.date));
}

async function portalGet(url, sessionCookies) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
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
      if (location.toLowerCase().includes("login")) throw new SchoolSessionExpiredError();
    }
    const html = await response.text();
    const lower = html.toLowerCase();
    if (lower.includes("txtusername") || lower.includes("login.aspx") || lower.includes("loginwrapper")) {
      throw new SchoolSessionExpiredError();
    }
    return { html, status: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

function attendanceUrls() {
  const configured = String(process.env.EDUSECURE_ATTENDANCE_URL || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  return configured.length
    ? configured
    : [
        KNOWN_ATTENDANCE_URL,
        ...DEFAULT_ATTENDANCE_PATHS.map((path) => `${BASE_URL}${path}`),
      ];
}

async function fetchAttendanceForSessionWithoutTiming(sessionCookies) {
  if (!sessionCookies) throw new SchoolSessionExpiredError();

  const discoveryPages = await Promise.allSettled(
    DISCOVERY_URLS.map((url) => portalGet(url, sessionCookies))
  );
  const discoveryHtml = [];
  for (const result of discoveryPages) {
    if (result.status === "rejected") {
      if (result.reason instanceof SchoolSessionExpiredError) throw result.reason;
      continue;
    }
    discoveryHtml.push(result.value.html);
  }

  const linkedUrls = discoveryHtml.flatMap((html) => {
    const $page = cheerio.load(html);
    return $page("a").map((_, link) => {
      const href = $page(link).attr("href") || "";
      try {
        return /attendance|attendence|absen/i.test(href)
          ? new URL(href, DASHBOARD_URL).href
          : null;
      } catch {
        return null;
      }
    }).get().filter(Boolean);
  });
  const urls = [...new Set([...attendanceUrls(), ...linkedUrls])];

  const attempts = await Promise.allSettled(urls.map(async (url) => {
    const { html } = await portalGet(url, sessionCookies);
    const records = parseAttendanceHtml(html, url);
    if (!records.length) return null;
    return { url, records };
  }));

  for (const attempt of attempts) {
    if (attempt.status === "rejected" && attempt.reason instanceof SchoolSessionExpiredError) {
      throw attempt.reason;
    }
    if (attempt.status !== "fulfilled" || !attempt.value) continue;
    const { url, records } = attempt.value;
    const counts = records.reduce((result, record) => {
      result[record.status] = (result[record.status] || 0) + 1;
      return result;
    }, {});
    const considered = (counts.present || 0) + (counts.absent || 0) + (counts.late || 0) + (counts.excused || 0);
    return {
      records,
      counts,
      total: records.length,
      attendanceRate: considered ? Math.round(((counts.present || 0) / considered) * 100) : null,
      source: url,
    };
  }

  throw new AttendanceUnavailableError(
    "EduSecure did not expose a readable attendance page for this account. Set EDUSECURE_ATTENDANCE_URL if your school uses a custom page."
  );
}

async function fetchAttendanceForSession(sessionCookies) {
  return measureRequestTiming("edusecure_attendance", () =>
    fetchAttendanceForSessionWithoutTiming(sessionCookies)
  );
}

module.exports = {
  fetchAttendanceForSession,
  parseAttendanceHtml,
  AttendanceUnavailableError,
};
