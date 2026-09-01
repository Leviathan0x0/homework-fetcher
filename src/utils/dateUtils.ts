import { HomeworkEntry } from '../types/homework';

const MONTH_MAP: Record<string, number> = {
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

export function parseHomeworkDate(dateStr?: string | null): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  let str = String(dateStr).trim();
  if (!str) return null;

  // Relative keywords
  const lower = str.toLowerCase();
  if (lower === 'today') {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (lower === 'yesterday') {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  }

  // ISO timestamp (e.g. 2026-08-11T10:30:00.000Z)
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
    const d = new Date(str);
    if (!Number.isNaN(d.getTime())) {
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
  }

  // Strip leading weekday (e.g. "Monday, ", "Mon ", "Tuesday - ")
  str = str.replace(/^(?:sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)[,\s-]+/i, '').trim();

  // Strip trailing time (e.g. " 10:30 AM", " at 14:00", ", 09:15", " 09:15:00")
  str = str.replace(/[,]?\s*(?:at\s+)?\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?$/i, '').trim();

  // Strip ordinal suffixes on days: "1st", "2nd", "3rd", "4th", "11th", "21st", "22nd", "23rd", "31st"
  str = str.replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/i, '$1');

  // 1. Explicit ISO YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
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

  // 2. DMY with any separator (e.g. "11.08.2026", "11/08/2026", "11-08-2026", "11/08/26")
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

  // 3. D MMM YYYY or D MMMM YYYY (e.g. "11 Aug 2026", "24-Feb-2026", "1 September 2026", "11/Aug/2026", "11.Aug.2026")
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

  // 4. MMM D, YYYY or MMMM D, YYYY (e.g. "Feb 24, 2026", "Aug 11 2026", "August 11, 2026")
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

  // 5. Fallback native
  const fallback = new Date(str);
  if (!Number.isNaN(fallback.getTime())) {
    return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
  }

  return null;
}

export function sortHomeworkNewestFirst(entries: HomeworkEntry[]): HomeworkEntry[] {
  if (!entries || !Array.isArray(entries)) return [];

  return [...entries].filter(Boolean).sort((a, b) => {
    const dateA = parseHomeworkDate(a?.date);
    const dateB = parseHomeworkDate(b?.date);
    if (dateA && dateB) {
      return dateB.getTime() - dateA.getTime();
    }
    if (dateA) return -1;
    if (dateB) return 1;
    return 0;
  });
}

export function isTodayDate(dateStr?: string | null): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const str = dateStr.trim().toLowerCase();
  if (str === 'today') return true;
  if (str === 'yesterday') return false;

  const homeworkDate = parseHomeworkDate(dateStr);
  if (!homeworkDate) {
    const raw = dateStr.toLowerCase().trim().replace(/\s+/g, ' ');
    const todayStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toLowerCase();
    return raw === todayStr;
  }
  const today = new Date();
  return homeworkDate.getDate() === today.getDate() &&
         homeworkDate.getMonth() === today.getMonth() &&
         homeworkDate.getFullYear() === today.getFullYear();
}

export function isWithinLast7Days(dateStr?: string | null): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const homeworkDate = parseHomeworkDate(dateStr);
  if (!homeworkDate) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(homeworkDate.getFullYear(), homeworkDate.getMonth(), homeworkDate.getDate());
  const diffTime = today.getTime() - target.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays <= 7;
}

export function formatToISODate(dateStr?: string | null): string {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const parsed = parseHomeworkDate(dateStr);
  if (!parsed) return '';
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function formatContextualDate(): string {
  const now = new Date();
  return now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

export function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

export function formatRelativeDateHeader(dateStr?: string | null): string {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const parsed = parseHomeworkDate(dateStr);
  if (!parsed) return dateStr;

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (
    parsed.getDate() === today.getDate() &&
    parsed.getMonth() === today.getMonth() &&
    parsed.getFullYear() === today.getFullYear()
  ) {
    return 'Today';
  }

  if (
    parsed.getDate() === yesterday.getDate() &&
    parsed.getMonth() === yesterday.getMonth() &&
    parsed.getFullYear() === yesterday.getFullYear()
  ) {
    return 'Yesterday';
  }

  return parsed.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

/** Compact inbox / bubble timestamps for chat. */
export function formatChatListTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfMsg.getTime()) / 86400000);

  if (dayDiff === 0) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff < 7) {
    return d.toLocaleDateString([], { weekday: 'short' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatChatDayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfMsg.getTime()) / 86400000);
  if (dayDiff === 0) return 'Today';
  if (dayDiff === 1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function sameCalendarDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export function isSameDay(d1: Date, d2: Date): boolean {
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}

export function formatYmd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function getHomeworkDateYmd(dateStr: string): string | null {
  const parsed = parseHomeworkDate(dateStr);
  if (!parsed) return null;
  return formatYmd(parsed);
}

export interface CalendarDayItem {
  date: Date;
  isCurrentMonth: boolean;
  ymd: string;
}

export function getCalendarDaysForMonth(year: number, month: number): CalendarDayItem[] {
  const days: CalendarDayItem[] = [];

  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);

  // Monday = 0, ..., Sunday = 6
  const startingDayOfWeek = (firstDayOfMonth.getDay() + 6) % 7;

  // Previous month padding days
  for (let i = startingDayOfWeek - 1; i >= 0; i--) {
    const prevDate = new Date(year, month, -i);
    days.push({
      date: prevDate,
      isCurrentMonth: false,
      ymd: formatYmd(prevDate),
    });
  }

  // Current month days
  for (let d = 1; d <= lastDayOfMonth.getDate(); d++) {
    const currDate = new Date(year, month, d);
    days.push({
      date: currDate,
      isCurrentMonth: true,
      ymd: formatYmd(currDate),
    });
  }

  // Next month padding days to complete grid (42 cells: 6 rows of 7 days)
  const remainingCells = 42 - days.length;
  for (let d = 1; d <= remainingCells; d++) {
    const nextDate = new Date(year, month + 1, d);
    days.push({
      date: nextDate,
      isCurrentMonth: false,
      ymd: formatYmd(nextDate),
    });
  }

  return days;
}

