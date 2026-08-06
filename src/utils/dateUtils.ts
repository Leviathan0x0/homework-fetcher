import { HomeworkEntry } from '../types/homework';

export function parseHomeworkDate(dateStr?: string | null): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const str = String(dateStr).trim();
  if (!str) return null;

  const makeLocalDate = (year: number, month: number, day: number): Date | null => {
    const parsed = new Date(year, month - 1, day);
    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      return null;
    }
    return parsed;
  }

  // EduSecure uses Indian day-first dates. Parse these before native Date,
  // whose "06/08/2026" interpretation is month-first in many browsers.
  const dmyMatch = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10);
    const year = parseInt(dmyMatch[3], 10);
    return makeLocalDate(year, month, day);
  }

  // Parse ISO dates as local calendar dates so timezone conversion cannot move
  // an entry across midnight before the Today view compares it.
  const ymdMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymdMatch) {
    return makeLocalDate(
      parseInt(ymdMatch[1], 10),
      parseInt(ymdMatch[2], 10),
      parseInt(ymdMatch[3], 10)
    );
  }

  // Match DD-MMM-YYYY or DD MMM YYYY (e.g. "24-Feb-2026", "24 Feb 2026")
  const dMmmYMatch = str.match(/^(\d{1,2})[\s\-]+([A-Za-z]+)[\s\-]+(\d{4})$/);
  if (dMmmYMatch) {
    const parsed = new Date(`${dMmmYMatch[2]} ${dMmmYMatch[1]}, ${dMmmYMatch[3]}`);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  // Finally support longer natural-language dates such as "Feb 24, 2026".
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) return parsed;

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
  const homeworkDate = parseHomeworkDate(dateStr);
  if (!homeworkDate) {
    const todayStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return dateStr.toLowerCase().trim() === todayStr.toLowerCase().trim();
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
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - homeworkDate.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays <= 7;
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
  let startingDayOfWeek = (firstDayOfMonth.getDay() + 6) % 7;

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

