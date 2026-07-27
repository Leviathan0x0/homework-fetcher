/**
 * Rule module — subjects.
 *
 * Subject detection for badges already lives in ../../subjectDetector.ts; this
 * module only holds what the formatter pipeline needs: the keywords used to
 * recognise a subject header inside a clause, and the icon shown next to the
 * subject title.
 */

export const SUBJECT_KEYWORDS = [
  'MATHEMATICS',
  'MATHS',
  'MATH',
  'SCIENCE',
  'PHYSICS',
  'CHEMISTRY',
  'BIOLOGY',
  'EVS',
  'ENGLISH',
  'HINDI',
  'PUNJABI',
  'SANSKRIT',
  'COMPUTERS',
  'COMPUTER',
  'SOCIAL STUDIES',
  'S.ST',
  'SST',
  'HISTORY',
  'CIVICS',
  'GEOGRAPHY',
  'GENERAL KNOWLEDGE',
  'G.K',
  'GK',
  'ART',
  'DRAWING',
  'MORAL SCIENCE',
  'गणित',
  'विज्ञान',
  'अंग्रेजी',
  'हिंदी',
  'पंजाबी',
  'कंप्यूटर',
  'सामाजिक',
];

/** Regex alternation for the subject keywords above. */
export const SUBJECT_ALTERNATION = SUBJECT_KEYWORDS.map((keyword) =>
  keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
).join('|');

export const DEFAULT_SUBJECT_ICON = '📘';

/** Icon shown beside the subject heading, keyed by detectSubject() names. */
export const SUBJECT_ICONS: Record<string, string> = {
  Mathematics: '📘',
  Science: '🔬',
  English: '📖',
  Hindi: '📕',
  Punjabi: '📗',
  Computers: '💻',
  'Social Studies': '🌍',
  'General Knowledge': '🧠',
  Art: '🎨',
};

export function subjectIcon(subject: string): string {
  return SUBJECT_ICONS[subject] ?? DEFAULT_SUBJECT_ICON;
}
