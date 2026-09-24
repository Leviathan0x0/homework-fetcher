import type { SchoolNotice } from '../types/homework';

export type NoticeTag = 'leave' | 'fee-payment' | 'other' | 'circular';
export type ImportantNoticeTag = Exclude<NoticeTag, 'circular'>;
export type ImportantNoticeFilter = 'all' | ImportantNoticeTag;

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
    badgeClass: 'border-emerald-200/60 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-300',
    iconColorClassName: 'text-emerald-700 dark:text-emerald-300',
    iconPrimaryColor: '#10b981',
    iconSecondaryColor: '#2dc992',
  },
  'fee-payment': {
    label: 'Fee Payment',
    badgeClass: 'border-amber-200/60 bg-amber-50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/40 dark:text-amber-300',
    iconColorClassName: 'text-amber-700 dark:text-amber-300',
    iconPrimaryColor: '#f59e0b',
    iconSecondaryColor: '#eaa718',
  },
  other: {
    label: 'Other',
    badgeClass: 'border-sky-200/60 bg-sky-50 text-sky-700 dark:border-sky-800/40 dark:bg-sky-950/40 dark:text-sky-300',
    iconColorClassName: 'text-sky-700 dark:text-sky-300',
    iconPrimaryColor: '#4fb6e5',
    iconSecondaryColor: '#3ea1d4',
  },
  circular: {
    label: 'Circular',
    badgeClass: 'border-sky-200/60 bg-sky-50 text-sky-700 dark:border-sky-800/40 dark:bg-sky-950/40 dark:text-sky-300',
    iconColorClassName: 'text-sky-700 dark:text-sky-300',
    iconPrimaryColor: '#4fb6e5',
    iconSecondaryColor: '#3ea1d4',
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

export function getNoticeTag(
  notice: Pick<SchoolNotice, 'kind' | 'type' | 'title' | 'content'>
): NoticeTag {
  if (notice.kind === 'circulars') return 'circular';

  const searchableText = [notice.type, notice.title, notice.content]
    .filter(Boolean)
    .join(' ')
    .normalize('NFKC');

  return IMPORTANT_NOTICE_RULES.find(({ pattern }) => pattern.test(searchableText))?.tag || 'other';
}

export const IMPORTANT_NOTICE_FILTERS: Array<{ key: ImportantNoticeFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'leave', label: 'Leave' },
  { key: 'fee-payment', label: 'Fee Payment' },
  { key: 'other', label: 'Other' },
];
