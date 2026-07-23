import { HomeworkEntry } from '../types/homework';

export type ExamCategory = 'Exam-related' | 'Possibly exam-related';

export interface ExamDetectionResult {
  isExam: boolean;
  category?: ExamCategory;
  matchedKeyword?: string;
}

const HIGH_CONFIDENCE_KEYWORDS = [
  'final examination',
  'annual examination',
  'term examination',
  'final exam',
  'examination',
  'exam',
  'midterm',
  'unit test',
  'test paper',
];

const MEDIUM_CONFIDENCE_KEYWORDS = [
  'syllabus',
  'revision',
  'prepare well',
  'chapters',
  'revise',
];

/**
  * Utility to detect exam-related homework using simple, deterministic case-insensitive keyword matching.
  * NO AI used.
  */
export function isExamRelatedHomework(homeworkText: string): ExamDetectionResult {
  if (!homeworkText) {
    return { isExam: false };
  }

  const text = homeworkText.toLowerCase();

  // Check high confidence keywords first
  for (const kw of HIGH_CONFIDENCE_KEYWORDS) {
    if (text.includes(kw)) {
      return {
        isExam: true,
        category: 'Exam-related',
        matchedKeyword: kw,
      };
    }
  }

  // Check medium confidence keywords
  for (const kw of MEDIUM_CONFIDENCE_KEYWORDS) {
    if (text.includes(kw)) {
      return {
        isExam: true,
        category: 'Possibly exam-related',
        matchedKeyword: kw,
      };
    }
  }

  return { isExam: false };
}

/**
  * Helper to filter homework list for exam-related items
  */
export function filterExamHomework(homeworkList: HomeworkEntry[]): {
  entry: HomeworkEntry;
  detection: ExamDetectionResult;
}[] {
  if (!homeworkList || !Array.isArray(homeworkList)) return [];

  return homeworkList
    .map((entry) => ({
      entry,
      detection: isExamRelatedHomework(entry.homework),
    }))
    .filter((item) => item.detection.isExam);
}
