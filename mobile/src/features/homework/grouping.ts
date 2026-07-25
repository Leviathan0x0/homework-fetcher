import type { HomeworkItem } from "../../api/types";
import { formatDateHeading } from "../../utils/datetime";

export interface HomeworkSection {
  /** Raw `YYYY-MM-DD`, used as the section key. */
  date: string;
  title: string;
  /** Count of incomplete items, shown next to the heading. */
  outstanding: number;
  data: HomeworkItem[];
}

/**
 * Groups homework by date, newest first.
 *
 * Within a day, incomplete items sort above completed ones so a day that is
 * mostly done collapses visually towards "finished" without hiding anything.
 */
export function groupHomeworkByDate(items: HomeworkItem[]): HomeworkSection[] {
  const byDate = new Map<string, HomeworkItem[]>();

  for (const item of items) {
    const bucket = byDate.get(item.date);
    if (bucket) {
      bucket.push(item);
    } else {
      byDate.set(item.date, [item]);
    }
  }

  return [...byDate.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, group]) => ({
      date,
      title: formatDateHeading(date),
      outstanding: group.filter((item) => !item.completed).length,
      data: [...group].sort((left, right) => {
        if (left.completed !== right.completed) return left.completed ? 1 : -1;
        return (left.subject ?? "").localeCompare(right.subject ?? "");
      }),
    }));
}

/** Distinct subjects present in the list, for the filter row. */
export function collectSubjects(items: HomeworkItem[]): string[] {
  const subjects = new Set<string>();
  for (const item of items) {
    if (item.subject) subjects.add(item.subject);
  }
  return [...subjects].sort((left, right) => left.localeCompare(right));
}

export interface HomeworkFilter {
  subject: string | null;
  hideCompleted: boolean;
}

export function applyHomeworkFilter(items: HomeworkItem[], filter: HomeworkFilter): HomeworkItem[] {
  return items.filter((item) => {
    if (filter.subject && item.subject !== filter.subject) return false;
    if (filter.hideCompleted && item.completed) return false;
    return true;
  });
}

/**
 * Stable pastel tint per subject so a subject keeps the same chip colour across
 * the app. Hash-based rather than a fixed map, because subjects come from the
 * school portal and cannot be enumerated ahead of time.
 */
const SUBJECT_HUES = [212, 152, 32, 268, 340, 190] as const;

export function subjectTint(subject: string | null, isDark: boolean): string {
  if (!subject) return isDark ? "rgba(118,118,128,0.24)" : "rgba(118,118,128,0.12)";
  let hash = 0;
  for (let index = 0; index < subject.length; index += 1) {
    hash = (hash * 31 + subject.charCodeAt(index)) | 0;
  }
  const hue = SUBJECT_HUES[Math.abs(hash) % SUBJECT_HUES.length] ?? 212;
  return isDark ? `hsl(${hue}, 34%, 24%)` : `hsl(${hue}, 62%, 92%)`;
}
