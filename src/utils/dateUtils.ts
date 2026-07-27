import { HomeworkEntry } from '../types/homework';

export function parseHomeworkDate(dateStr?: string | null): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const str = String(dateStr).trim();
  if (!str) return null;

  // 1. Try standard JS Date parse (e.g. "Feb 24, 2026", "2026-02-24", "Jul 22 2026")
  let parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  // 2. Match DD/MM/YYYY, DD-MM-YYYY, or DD.MM.YYYY (e.g. "24/02/2026", "24-02-2026")
  const dmyMatch = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1; // 0-indexed month
    const year = parseInt(dmyMatch[3], 10);
    parsed = new Date(year, month, day);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  // 3. Match DD-MMM-YYYY or DD MMM YYYY (e.g. "24-Feb-2026", "24 Feb 2026")
  const dMmmYMatch = str.match(/^(\d{1,2})[\s\-]+([A-Za-z]+)[\s\-]+(\d{4})$/);
  if (dMmmYMatch) {
    parsed = new Date(`${dMmmYMatch[2]} ${dMmmYMatch[1]}, ${dMmmYMatch[3]}`);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
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
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
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

