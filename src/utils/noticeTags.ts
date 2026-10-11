import type { SchoolNotice } from '../types/homework';

export type NoticeTag =
  | 'leave'
  | 'fee-payment'
  | 'other'
  | 'circular'
  | 'event'
  | 'exam'
  | 'holiday';
/** Tags the Important feed can produce. */
export type ImportantNoticeTag = 'leave' | 'fee-payment' | 'other';
export type ImportantNoticeFilter = 'all' | ImportantNoticeTag;
/**
 * Tags the Circulars feed can produce. `circular` is the generic fallback for a
 * circular whose subject the rules did not recognise.
 */
export type CircularNoticeTag = 'event' | 'exam' | 'fee-payment' | 'holiday' | 'circular';
export type CircularNoticeFilter = 'all' | CircularNoticeTag;

export interface NoticeTagMeta {
  label: string;
  badgeClass: string;
  iconColorClassName: string;
  iconPrimaryColor: string;
  iconSecondaryColor: string;
}

export const NOTICE_TAG_META: Record<NoticeTag, NoticeTagMeta> = {
  leave: {
    label: 'Leave',
    badgeClass: 'border-emerald-200/60 bg-emerald-100 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/60 dark:text-emerald-300',
    iconColorClassName: 'text-emerald-700 dark:text-emerald-300',
    iconPrimaryColor: '#10b981',
    iconSecondaryColor: '#2dc992',
  },
  'fee-payment': {
    label: 'Fee Payment',
    badgeClass: 'border-amber-200/60 bg-amber-100 text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/60 dark:text-amber-300',
    iconColorClassName: 'text-amber-700 dark:text-amber-300',
    iconPrimaryColor: '#f59e0b',
    iconSecondaryColor: '#eaa718',
  },
  event: {
    label: 'Event',
    badgeClass: 'border-fuchsia-200/60 bg-fuchsia-100 text-fuchsia-700 dark:border-fuchsia-800/40 dark:bg-fuchsia-950/60 dark:text-fuchsia-300',
    iconColorClassName: 'text-fuchsia-700 dark:text-fuchsia-300',
    iconPrimaryColor: '#d946ef',
    iconSecondaryColor: '#c026d3',
  },
  exam: {
    label: 'Exam',
    badgeClass: 'border-indigo-200/60 bg-indigo-100 text-indigo-700 dark:border-indigo-800/40 dark:bg-indigo-950/60 dark:text-indigo-300',
    iconColorClassName: 'text-indigo-700 dark:text-indigo-300',
    iconPrimaryColor: '#6366f1',
    iconSecondaryColor: '#4f46e5',
  },
  holiday: {
    label: 'Holiday',
    badgeClass: 'border-rose-200/60 bg-rose-100 text-rose-700 dark:border-rose-800/40 dark:bg-rose-950/60 dark:text-rose-300',
    iconColorClassName: 'text-rose-700 dark:text-rose-300',
    iconPrimaryColor: '#f43f5e',
    iconSecondaryColor: '#e11d48',
  },
  other: {
    label: 'Other',
    badgeClass: 'border-violet-200/60 bg-violet-100 text-violet-700 dark:border-violet-800/40 dark:bg-violet-950/60 dark:text-violet-300',
    iconColorClassName: 'text-violet-700 dark:text-violet-300',
    iconPrimaryColor: '#a78bfa',
    iconSecondaryColor: '#8b5cf6',
  },
  circular: {
    label: 'Circular',
    badgeClass: 'border-sky-200/60 bg-sky-100 text-sky-700 dark:border-sky-800/40 dark:bg-sky-950/60 dark:text-sky-300',
    iconColorClassName: 'text-sky-700 dark:text-sky-300',
    iconPrimaryColor: '#0284c7',
    iconSecondaryColor: '#0369a1',
  },
};

const IMPORTANT_NOTICE_RULES: Array<{ tag: ImportantNoticeTag; pattern: RegExp }> = [
  {
    tag: 'leave',
    pattern: /\b(?:leave|leaves|absence|absent|medical\s+leave)\b/i,
  },
  {
    tag: 'fee-payment',
    pattern: /\b(?:fee(?:\s+payment)?|fees|payment)\b/i,
  },
];

// Exam is checked first so an "annual exam schedule" is not filed as an event,
// and fee before event so a "fee payment camp" is not filed as an event either.
const CIRCULAR_NOTICE_RULES: Array<{ tag: CircularNoticeTag; pattern: RegExp }> = [
  {
    tag: 'exam',
    pattern:
      /\b(?:exam|examination|exams|test|tests|timetable|time\s+table|schedule|result|report\s+card|syllabus)\b/i,
  },
  {
    tag: 'holiday',
    pattern: /\b(?:holiday|holiday?s|vacation|vacational|summer\s+break|winter\s+break|recess|remains?\s+closed)\b/i,
  },
  {
    tag: 'fee-payment',
    pattern: /\b(?:fee(?:\s+payment)?|fees|payment|dues?)\b/i,
  },
  {
    tag: 'event',
    pattern:
      /\b(?:event|events|function|celebration|annual\s+day|sports?\s+day|children'?s\s+day|teachers'?s?\s+day|independence\s+day|trip|picnic|competition|workshop|assembly|inauguration)\b/i,
  },
];

function searchableTextOf(
  notice: Pick<SchoolNotice, 'kind' | 'type' | 'title' | 'content'>
) {
  return [notice.type, notice.title, notice.content]
    .filter(Boolean)
    .join(' ')
    .normalize('NFKC');
}

export function getNoticeTag(
  notice: Pick<SchoolNotice, 'kind' | 'type' | 'title' | 'content'>
): NoticeTag {
  const searchableText = searchableTextOf(notice);

  if (notice.kind === 'circulars') {
    return (
      CIRCULAR_NOTICE_RULES.find(({ pattern }) => pattern.test(searchableText))?.tag ||
      'circular'
    );
  }

  return IMPORTANT_NOTICE_RULES.find(({ pattern }) => pattern.test(searchableText))?.tag || 'other';
}

export const IMPORTANT_NOTICE_FILTERS: Array<{ key: ImportantNoticeFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'leave', label: 'Leave' },
  { key: 'fee-payment', label: 'Fee Payment' },
  { key: 'other', label: 'Other' },
];

export const CIRCULAR_NOTICE_FILTERS: Array<{ key: CircularNoticeFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'event', label: 'Event' },
  { key: 'exam', label: 'Exam' },
  { key: 'fee-payment', label: 'Fee Payment' },
  { key: 'holiday', label: 'Holiday' },
  { key: 'circular', label: 'Other' },
];
