import { HomeworkEntry } from '../types/homework';
import { detectDeadline } from './deadlineDetector';
import { isTodayDate, isWithinLast7Days, parseHomeworkDate } from './dateUtils';

export type HomeworkPriority = 'urgent' | 'tomorrow' | 'this_week';

export interface PriorityInfo {
  level: HomeworkPriority;
  label: string;
  /** Tailwind classes for the badge chip. */
  badgeClass: string;
  /** Solid dot color. */
  dotClass: string;
}

/**
 * School-diary homework is usually assigned one day and due the next.
 * Tests / submission wording push a task to Urgent.
 */
export function detectHomeworkPriority(
  item: HomeworkEntry,
  options?: { text?: string }
): PriorityInfo {
  const text = options?.text ?? item.homework ?? '';
  const deadline = detectDeadline(text);
  const assignedToday = isTodayDate(item.date);

  if (deadline.type === 'test' || /\b(urgent|due\s+today|submit\s+today)\b/i.test(text)) {
    return {
      level: 'urgent',
      label: 'Urgent',
      badgeClass:
        'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200/70 dark:border-rose-800/50',
      dotClass: 'bg-rose-500',
    };
  }

  if (deadline.type === 'submission' && assignedToday) {
    return {
      level: 'urgent',
      label: 'Urgent',
      badgeClass:
        'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200/70 dark:border-rose-800/50',
      dotClass: 'bg-rose-500',
    };
  }

  if (assignedToday) {
    return {
      level: 'tomorrow',
      label: 'Tomorrow',
      badgeClass:
        'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200/70 dark:border-amber-800/50',
      dotClass: 'bg-amber-400',
    };
  }

  const parsed = parseHomeworkDate(item.date);
  if (parsed) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (
      parsed.getDate() === yesterday.getDate() &&
      parsed.getMonth() === yesterday.getMonth() &&
      parsed.getFullYear() === yesterday.getFullYear()
    ) {
      return {
        level: 'urgent',
        label: 'Urgent',
        badgeClass:
          'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200/70 dark:border-rose-800/50',
        dotClass: 'bg-rose-500',
      };
    }
  }

  if (isWithinLast7Days(item.date)) {
    return {
      level: 'this_week',
      label: 'This Week',
      badgeClass:
        'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200/70 dark:border-emerald-800/50',
      dotClass: 'bg-emerald-500',
    };
  }

  return {
    level: 'this_week',
    label: 'This Week',
    badgeClass:
      'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200/70 dark:border-emerald-800/50',
    dotClass: 'bg-emerald-500',
  };
}

export function getAssignmentMeta(item: HomeworkEntry): { assigned: string; due?: string } {
  if (isTodayDate(item.date)) {
    return { assigned: 'Assigned Today', due: 'Due Tomorrow' };
  }
  return { assigned: item.date ? `Assigned ${item.date}` : 'Assigned' };
}
