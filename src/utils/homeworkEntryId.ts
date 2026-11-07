import { HomeworkEntry } from '../types/homework';
import { detectSubject } from './subjectDetector';

/** Stable id for a homework entry, used as the key into the completion map. */
export const getHomeworkEntryId = (item: HomeworkEntry | null | undefined): string => {
  if (!item) return '';
  const d = item.date || '';
  const hw = item.homework || '';
  return item.id || `${d}_${detectSubject(hw).name}_${hw.slice(0, 30)}`;
};
