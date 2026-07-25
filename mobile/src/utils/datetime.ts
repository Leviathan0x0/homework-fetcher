/**
 * Date and time formatting.
 *
 * The API sends two shapes: `YYYY-MM-DD` calendar dates (homework, classwork) and
 * full ISO timestamps (messages, notifications). Calendar dates are parsed as
 * *local* dates on purpose — `new Date("2026-07-25")` is parsed as UTC midnight,
 * which renders as the previous day for anyone west of Greenwich.
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Parses `YYYY-MM-DD` into a local-midnight Date. Returns null if unparseable. */
export function parseCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole days between a calendar date and today. Negative = past. */
export function dayOffsetFromToday(value: string): number | null {
  const parsed = parseCalendarDate(value);
  if (!parsed) return null;
  return Math.round((startOfLocalDay(parsed) - startOfLocalDay(new Date())) / MS_PER_DAY);
}

/** "Today", "Tomorrow", "Yesterday", otherwise "Mon 4 Aug" (year added when it differs). */
export function formatDateHeading(value: string): string {
  const parsed = parseCalendarDate(value);
  if (!parsed) return value;

  const offset = dayOffsetFromToday(value);
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  if (offset === -1) return "Yesterday";

  const sameYear = parsed.getFullYear() === new Date().getFullYear();
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Short relative age for list rows: "now", "4m", "3h", "Yesterday", "4 Aug". */
export function formatRelativeTime(isoTimestamp: string): string {
  const timestamp = Date.parse(isoTimestamp);
  if (Number.isNaN(timestamp)) return "";

  const elapsed = Date.now() - timestamp;
  if (elapsed < MS_PER_MINUTE) return "now";
  if (elapsed < MS_PER_HOUR) return `${Math.floor(elapsed / MS_PER_MINUTE)}m`;
  if (elapsed < MS_PER_DAY) return `${Math.floor(elapsed / MS_PER_HOUR)}h`;

  const days = Math.floor(elapsed / MS_PER_DAY);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d`;

  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Wall-clock time for message bubbles, e.g. "14:32". */
export function formatClockTime(isoTimestamp: string): string {
  const timestamp = Date.parse(isoTimestamp);
  if (Number.isNaN(timestamp)) return "";
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Today as `YYYY-MM-DD` in local time, for upload defaults. */
export function todayCalendarDate(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
