/**
 * Server-side homework date parsing, ported from src/utils/dateUtils.ts.
 *
 * homeworkRoutes.hasTodayEntry used substring matching ("11 aug") which:
 * - missed MMM D ("Aug 11, 2026"), ordinals ("11th Aug"), 2-digit years,
 *   and the "today" keyword -> forced a scrape on every load;
 * - matched ANY year ("11 aug 2020" counted as today) -> stale cache
 *   treated as fresh -> original Today-tab bug persisted.
 *
 * Keep this in sync with src/utils/dateUtils.ts. CommonJS because server/
 * is still require()-based.
 */

const MONTH_MAP = {
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

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function toIstWallDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(d.getTime() + d.getTimezoneOffset() * 60 * 1000 + IST_OFFSET_MS);
}

function parseHomeworkDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  let str = String(dateStr).trim();
  if (!str) return null;

  const lower = str.toLowerCase();
  if (lower === "today") {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (lower === "yesterday") {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
    const d = new Date(str);
    if (!Number.isNaN(d.getTime())) {
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
  }

  str = str
    .replace(/^(?:sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)[,\s-]+/i, "")
    .trim();
  str = str.replace(/[,]?\s*(?:at\s+)?\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?$/i, "").trim();
  str = str.replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi, "$1");

  const isoMatch = str.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10) - 1;
    const d = parseInt(isoMatch[3], 10);
    if (m >= 0 && m < 12 && d >= 1 && d <= 31) {
      const cand = new Date(y, m, d);
      if (!Number.isNaN(cand.getTime()) && cand.getMonth() === m && cand.getDate() === d) return cand;
    }
  }

  const dmyMatch = str.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const mIdx = parseInt(dmyMatch[2], 10) - 1;
    let year = parseInt(dmyMatch[3], 10);
    if (year < 100) year += 2000;
    if (mIdx >= 0 && mIdx < 12 && day >= 1 && day <= 31) {
      const cand = new Date(year, mIdx, day);
      if (!Number.isNaN(cand.getTime()) && cand.getMonth() === mIdx && cand.getDate() === day) return cand;
    }
  }

  const dMmmYMatch = str.match(/^(\d{1,2})[\s./-]+([A-Za-z]+)[\s./-]+(\d{2,4})$/);
  if (dMmmYMatch) {
    const day = parseInt(dMmmYMatch[1], 10);
    const monRaw = dMmmYMatch[2].toLowerCase();
    const mIdx = MONTH_MAP[monRaw] ?? MONTH_MAP[monRaw.slice(0, 3)];
    let year = parseInt(dMmmYMatch[3], 10);
    if (year < 100) year += 2000;
    if (mIdx !== undefined && day >= 1 && day <= 31) {
      const cand = new Date(year, mIdx, day);
      if (!Number.isNaN(cand.getTime()) && cand.getMonth() === mIdx && cand.getDate() === day) return cand;
    }
  }

  const mmmDMatch = str.match(/^([A-Za-z]+)[\s./-]+(\d{1,2}),?[\s./-]+(\d{2,4})$/);
  if (mmmDMatch) {
    const monRaw = mmmDMatch[1].toLowerCase();
    const mIdx = MONTH_MAP[monRaw] ?? MONTH_MAP[monRaw.slice(0, 3)];
    const day = parseInt(mmmDMatch[2], 10);
    let year = parseInt(mmmDMatch[3], 10);
    if (year < 100) year += 2000;
    if (mIdx !== undefined && day >= 1 && day <= 31) {
      const cand = new Date(year, mIdx, day);
      if (!Number.isNaN(cand.getTime()) && cand.getMonth() === mIdx && cand.getDate() === day) return cand;
    }
  }

  const fallback = new Date(str);
  if (!Number.isNaN(fallback.getTime())) {
    return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
  }
  return null;
}

/**
 * Whether a homework date string is today in IST (school calendar).
 * Year is always compared — "11 Aug 2020" is NOT today in 2026.
 */
function isTodayDateInIst(dateStr, now = new Date()) {
  if (!dateStr || typeof dateStr !== "string") return false;
  const trimmed = dateStr.trim().toLowerCase();
  if (trimmed === "today") return true;
  if (trimmed === "yesterday") return false;

  const parsed = parseHomeworkDate(dateStr);
  if (!parsed) return false;
  const nowIst = toIstWallDate(now);
  // parsed has no TZ (calendar date); compare its YMD to IST YMD.
  // toIstWallDate(parsed-midnight-local) shifts by server offset, which would
  // corrupt the YMD, so compare parsed fields directly to IST fields.
  return (
    parsed.getFullYear() === nowIst.getFullYear() &&
    parsed.getMonth() === nowIst.getMonth() &&
    parsed.getDate() === nowIst.getDate()
  );
}

function hasTodayEntry(entries, now = new Date()) {
  if (!Array.isArray(entries) || entries.length === 0) return false;
  return entries.some((item) => isTodayDateInIst(item?.date, now));
}

module.exports = {
  MONTH_MAP,
  IST_OFFSET_MS,
  toIstWallDate,
  parseHomeworkDate,
  isTodayDateInIst,
  hasTodayEntry,
};
