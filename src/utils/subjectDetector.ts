import { SubjectInfo } from '../types/homework';

interface SubjectRule {
  keys: string[];
  name: string;
  badgeClass: string;
  bgStyle: string;
  textStyle: string;
}

const SUBJECT_RULES: SubjectRule[] = [
  {
    keys: ['MATH', 'MATHEMATICS', 'MATHS', 'ALGEBRA', 'GEOMETRY', 'गणित'],
    name: 'Mathematics',
    badgeClass: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200/60 dark:border-indigo-800/40',
    bgStyle: 'bg-indigo-50 dark:bg-indigo-950/40',
    textStyle: 'text-indigo-700 dark:text-indigo-300'
  },
  {
    keys: ['SCIENCE', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY', 'EVS', 'SCI', 'विज्ञान'],
    name: 'Science',
    badgeClass: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-800/40',
    bgStyle: 'bg-emerald-50 dark:bg-emerald-950/40',
    textStyle: 'text-emerald-700 dark:text-emerald-300'
  },
  {
    keys: ['ENGLISH', 'ENG', 'LITERATURE', 'GRAMMAR', 'अंग्रेजी'],
    name: 'English',
    badgeClass: 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200/60 dark:border-purple-800/40',
    bgStyle: 'bg-purple-50 dark:bg-purple-950/40',
    textStyle: 'text-purple-700 dark:text-purple-300'
  },
  {
    keys: ['HINDI', 'कक्षा कार्य', 'गृह कार्य', 'हिंदी'],
    name: 'Hindi',
    badgeClass: 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200/60 dark:border-amber-800/40',
    bgStyle: 'bg-amber-50 dark:bg-amber-950/40',
    textStyle: 'text-amber-800 dark:text-amber-300'
  },
  {
    keys: ['COMPUTERS', 'COMPUTER', 'IT', 'CODING', 'COMP', 'कंप्यूटर'],
    name: 'Computers',
    badgeClass: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200/60 dark:border-sky-800/40',
    bgStyle: 'bg-sky-50 dark:bg-sky-950/40',
    textStyle: 'text-sky-700 dark:text-sky-300'
  },
  {
    keys: ['S.ST', 'SOCIAL', 'HISTORY', 'CIVICS', 'GEOGRAPHY', 'SST', 'सामाजिक'],
    name: 'Social Studies',
    badgeClass: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200/60 dark:border-rose-800/40',
    bgStyle: 'bg-rose-50 dark:bg-rose-950/40',
    textStyle: 'text-rose-700 dark:text-rose-300'
  },
  {
    keys: ['PUNJABI', 'पंजाबी'],
    name: 'Punjabi',
    badgeClass: 'bg-orange-50 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300 border-orange-200/60 dark:border-orange-800/40',
    bgStyle: 'bg-orange-50 dark:bg-orange-950/40',
    textStyle: 'text-orange-800 dark:text-orange-300'
  },
  {
    keys: ['G.K', 'GK', 'GENERAL KNOWLEDGE'],
    name: 'General Knowledge',
    badgeClass: 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border-stone-200 dark:border-stone-700',
    bgStyle: 'bg-stone-100 dark:bg-stone-800',
    textStyle: 'text-stone-700 dark:text-stone-300'
  },
  {
    keys: ['ART', 'DRAWING', 'CRAFT'],
    name: 'Art',
    badgeClass: 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border-teal-200/60 dark:border-teal-800/40',
    bgStyle: 'bg-teal-50 dark:bg-teal-950/40',
    textStyle: 'text-teal-700 dark:text-teal-300'
  }
];

const DEFAULT_SUBJECT: SubjectInfo = {
  name: 'School Diary',
  badgeClass: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700',
  bgStyle: 'bg-neutral-100 dark:bg-neutral-800',
  textStyle: 'text-neutral-700 dark:text-neutral-300'
};

export function detectSubject(text: string): SubjectInfo {
  if (!text) return DEFAULT_SUBJECT;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const firstLine = lines[0] || text;

  // 1. Check for colon separation: "MATHEMATICS: CLASS WORK: Assignment 8..."
  if (firstLine.includes(':')) {
    const candidate = firstLine.split(':')[0].trim().toUpperCase();
    for (const rule of SUBJECT_RULES) {
      if (rule.keys.some(k => candidate.includes(k))) {
        return {
          name: rule.name,
          badgeClass: rule.badgeClass,
          bgStyle: rule.bgStyle,
          textStyle: rule.textStyle
        };
      }
    }
    if (candidate.length > 2 && candidate.length < 30) {
      return {
        name: formatSubjectName(candidate),
        badgeClass: DEFAULT_SUBJECT.badgeClass,
        bgStyle: DEFAULT_SUBJECT.bgStyle,
        textStyle: DEFAULT_SUBJECT.textStyle
      };
    }
  }

  // 2. Check for dash separation: "Computers-Learn and Complete..."
  if (firstLine.includes('-')) {
    const candidate = firstLine.split('-')[0].trim().toUpperCase();
    for (const rule of SUBJECT_RULES) {
      if (rule.keys.some(k => candidate.includes(k))) {
        return {
          name: rule.name,
          badgeClass: rule.badgeClass,
          bgStyle: rule.bgStyle,
          textStyle: rule.textStyle
        };
      }
    }
    if (candidate.length > 2 && candidate.length < 30) {
      return {
        name: formatSubjectName(candidate),
        badgeClass: DEFAULT_SUBJECT.badgeClass,
        bgStyle: DEFAULT_SUBJECT.bgStyle,
        textStyle: DEFAULT_SUBJECT.textStyle
      };
    }
  }

  // 3. Full text scanning for subject keywords
  const upperText = text.toUpperCase();
  for (const rule of SUBJECT_RULES) {
    if (rule.keys.some(k => upperText.includes(k))) {
      return {
        name: rule.name,
        badgeClass: rule.badgeClass,
        bgStyle: rule.bgStyle,
        textStyle: rule.textStyle
      };
    }
  }

  return DEFAULT_SUBJECT;
}

function formatSubjectName(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
