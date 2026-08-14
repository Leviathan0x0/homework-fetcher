import { SchoolNotice } from '../types/homework';
import { parseHomeworkDate } from './dateUtils';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export const RECENT_SCHOOL_NOTICE_MAX_AGE_DAYS = 3;

function calendarDayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MILLISECONDS_PER_DAY;
}

export function isRecentSchoolNotice(
  dateValue: string | null | undefined,
  today = new Date(),
  maxAgeDays = RECENT_SCHOOL_NOTICE_MAX_AGE_DAYS
): boolean {
  const publishedAt = parseHomeworkDate(dateValue);
  if (!publishedAt) return false;

  const ageInDays = calendarDayNumber(today) - calendarDayNumber(publishedAt);
  return ageInDays >= 0 && ageInDays <= maxAgeDays;
}

export function countRecentSchoolNotices(
  notices: SchoolNotice[],
  today = new Date(),
  maxAgeDays = RECENT_SCHOOL_NOTICE_MAX_AGE_DAYS
): number {
  return notices.filter((notice) => isRecentSchoolNotice(notice.date, today, maxAgeDays)).length;
}
