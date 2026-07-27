import { SubjectInfo } from '../types/homework';

interface SubjectRule {
  /** Canonical subject name shown in badges and used by the subject filters. */
  name: string;
  /**
   * Whole-label spellings, compared after normalisation, so "S.ST", "SST",
   * "social.studies" and "Social Studies" all resolve to the same subject.
   */
  aliases: string[];
  /** Words looked up inside free-form homework text. */
  keywords: string[];
  badgeClass: string;
  bgStyle: string;
  textStyle: string;
}

const SUBJECT_RULES: SubjectRule[] = [
  {
    name: 'Mathematics',
    aliases: ['math', 'maths', 'mathematic', 'mathematics', 'mth', 'mts'],
    keywords: ['MATHEMATICS', 'MATHS', 'MATH', 'ALGEBRA', 'GEOMETRY', 'TRIGONOMETRY', 'गणित', 'ਗਣਿਤ'],
    badgeClass: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200/60 dark:border-indigo-800/40',
    bgStyle: 'bg-indigo-50 dark:bg-indigo-950/40',
    textStyle: 'text-indigo-700 dark:text-indigo-300'
  },
  {
    name: 'History',
    aliases: ['history', 'hist', 'historyandcivics', 'histcivics'],
    keywords: ['HISTORY', 'HIST'],
    badgeClass: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200/60 dark:border-amber-800/40',
    bgStyle: 'bg-amber-50 dark:bg-amber-950/40',
    textStyle: 'text-amber-700 dark:text-amber-300'
  },
  {
    // Checked after History so "History" is distinct from "Social Science".
    name: 'Social Science',
    aliases: [
      'socialscience', 'socialsciences', 'socialstudies', 'socialstudy', 'social',
      'sst', 'ssc', 'sostudies', 'sscience', 'civics', 'geography',
      'socalscience', 'socalsciences', 'socalstudies', 'socalstudy', 'socal',
      'ssciences', 'soscience', 's-science', 's.science'
    ],
    keywords: [
      'SOCIAL SCIENCE', 'SOCAL SCIENCE', 'SOCIAL STUDIES', 'SOCAL STUDIES',
      'SOCIAL', 'SOCAL', 'S.ST', 'SST', 'SSC', 'S.SCIENCE', 'S SCIENCE',
      'SO SCIENCE', 'CIVICS', 'GEOGRAPHY', 'POLITICAL SCIENCE', 'सामाजिक'
    ],
    badgeClass: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200/60 dark:border-rose-800/40',
    bgStyle: 'bg-rose-50 dark:bg-rose-950/40',
    textStyle: 'text-rose-700 dark:text-rose-300'
  },
  {
    name: 'Physics',
    aliases: ['physics', 'physic', 'phys', 'phy'],
    keywords: ['PHYSICS', 'भौतिकी'],
    badgeClass: 'bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 border-cyan-200/60 dark:border-cyan-800/40',
    bgStyle: 'bg-cyan-50 dark:bg-cyan-950/40',
    textStyle: 'text-cyan-700 dark:text-cyan-300'
  },
  {
    name: 'Chemistry',
    aliases: ['chemistry', 'chem', 'chm'],
    keywords: ['CHEMISTRY', 'रसायन'],
    badgeClass: 'bg-lime-50 dark:bg-lime-950/40 text-lime-700 dark:text-lime-300 border-lime-200/60 dark:border-lime-800/40',
    bgStyle: 'bg-lime-50 dark:bg-lime-950/40',
    textStyle: 'text-lime-700 dark:text-lime-300'
  },
  {
    name: 'Biology',
    aliases: ['biology', 'bio', 'bioscience'],
    keywords: ['BIOLOGY', 'जीव विज्ञान'],
    badgeClass: 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300 border-green-200/60 dark:border-green-800/40',
    bgStyle: 'bg-green-50 dark:bg-green-950/40',
    textStyle: 'text-green-700 dark:text-green-300'
  },
  {
    name: 'Science',
    aliases: ['science', 'sciences', 'sci', 'generalscience', 'evs', 'environmentalstudies'],
    keywords: ['SCIENCE', 'SCI', 'EVS', 'विज्ञान'],
    badgeClass: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-800/40',
    bgStyle: 'bg-emerald-50 dark:bg-emerald-950/40',
    textStyle: 'text-emerald-700 dark:text-emerald-300'
  },
  {
    name: 'Computers',
    aliases: [
      'computers', 'computer', 'computerscience', 'computersci', 'compsci', 'comp',
      'cs', 'ai', 'artificialintelligence', 'it', 'ict', 'informationtechnology',
      'coding', 'computerapplication', 'computerapplications'
    ],
    keywords: [
      'COMPUTER SCIENCE', 'COMPUTER SCI', 'COMPUTERS', 'COMPUTER',
      'ARTIFICIAL INTELLIGENCE', 'INFORMATION TECHNOLOGY', 'CODING', 'PROGRAMMING',
      'ICT', 'कंप्यूटर'
    ],
    badgeClass: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200/60 dark:border-sky-800/40',
    bgStyle: 'bg-sky-50 dark:bg-sky-950/40',
    textStyle: 'text-sky-700 dark:text-sky-300'
  },
  {
    name: 'English',
    aliases: ['english', 'eng', 'engl', 'literature', 'grammar'],
    keywords: ['ENGLISH', 'LITERATURE', 'GRAMMAR', 'अंग्रेजी'],
    badgeClass: 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200/60 dark:border-purple-800/40',
    bgStyle: 'bg-purple-50 dark:bg-purple-950/40',
    textStyle: 'text-purple-700 dark:text-purple-300'
  },
  {
    name: 'Hindi',
    aliases: ['hindi', 'hin', 'हिंदी', 'हिन्दी'],
    keywords: ['HINDI', 'हिंदी', 'हिन्दी', 'कक्षा कार्य', 'गृह कार्य'],
    badgeClass: 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200/60 dark:border-amber-800/40',
    bgStyle: 'bg-amber-50 dark:bg-amber-950/40',
    textStyle: 'text-amber-800 dark:text-amber-300'
  },
  {
    name: 'Punjabi',
    aliases: ['punjabi', 'panjabi', 'pbi', 'pnb', 'ਪੰਜਾਬੀ', 'पंजाबी'],
    keywords: ['PUNJABI', 'PANJABI', 'ਪੰਜਾਬੀ', 'पंजाबी'],
    badgeClass: 'bg-orange-50 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300 border-orange-200/60 dark:border-orange-800/40',
    bgStyle: 'bg-orange-50 dark:bg-orange-950/40',
    textStyle: 'text-orange-800 dark:text-orange-300'
  },
  {
    name: 'French',
    aliases: ['french', 'fren', 'francais', 'français', 'fle'],
    keywords: ['FRENCH', 'FRANÇAIS', 'FRANCAIS'],
    badgeClass: 'bg-fuchsia-50 dark:bg-fuchsia-950/40 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-200/60 dark:border-fuchsia-800/40',
    bgStyle: 'bg-fuchsia-50 dark:bg-fuchsia-950/40',
    textStyle: 'text-fuchsia-700 dark:text-fuchsia-300'
  },
  {
    name: 'General Knowledge',
    aliases: ['gk', 'generalknowledge'],
    keywords: ['GENERAL KNOWLEDGE', 'G.K'],
    badgeClass: 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border-stone-200 dark:border-stone-700',
    bgStyle: 'bg-stone-100 dark:bg-stone-800',
    textStyle: 'text-stone-700 dark:text-stone-300'
  },
  {
    name: 'Art',
    aliases: ['art', 'arts', 'drawing', 'craft', 'artandcraft', 'artcraft'],
    keywords: ['ART', 'DRAWING', 'CRAFT', 'PAINTING'],
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

/** Separators school diaries use between the subject label and the task. */
const LABEL_SEPARATORS = [':', '-', '–', '—', '|'];

/**
 * Reduces a subject label to a comparable key: casing, spacing and punctuation
 * are dropped so "Comp. Sci.", "computer sci" and "COMPUTERSCI" are equal.
 */
export function normalizeSubjectKey(value: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

const ALIAS_INDEX = new Map<string, SubjectRule>();
for (const rule of SUBJECT_RULES) {
  ALIAS_INDEX.set(normalizeSubjectKey(rule.name), rule);
  for (const alias of rule.aliases) {
    const key = normalizeSubjectKey(alias);
    if (key && !ALIAS_INDEX.has(key)) ALIAS_INDEX.set(key, rule);
  }
}

function toSubjectInfo(rule: SubjectRule): SubjectInfo {
  return {
    name: rule.name,
    badgeClass: rule.badgeClass,
    bgStyle: rule.bgStyle,
    textStyle: rule.textStyle
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Matches a keyword as a standalone word, tolerating the punctuation and
 * spacing schools use ("SCI.", "COMPUTER SCI.", "S.ST").
 */
function containsKeyword(upperText: string, keyword: string): boolean {
  const pattern = escapeRegExp(keyword).replace(/(\\\.)?\s+/g, '[\\s.\\-_/:]*');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${pattern}([^\\p{L}\\p{N}]|$)`, 'u').test(upperText);
}

function matchAlias(candidate: string): SubjectRule | null {
  const key = normalizeSubjectKey(candidate);
  if (!key) return null;
  return ALIAS_INDEX.get(key) || null;
}

function matchKeywords(text: string): SubjectRule | null {
  const upperText = text.toUpperCase();
  for (const rule of SUBJECT_RULES) {
    if (rule.keywords.some((keyword) => containsKeyword(upperText, keyword))) {
      return rule;
    }
  }
  return null;
}

/** Words that reliably indicate French homework, used for the language fallback. */
const FRENCH_MARKERS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'et', 'est', 'sont', 'être', 'avoir',
  'vous', 'nous', 'votre', 'notre', 'dans', 'pour', 'avec', 'sur', 'faire', 'faites',
  'écrire', 'écrivez', 'écris', 'cahier', 'exercice', 'exercices', 'leçon', 'leçons',
  'devoirs', 'apprendre', 'apprenez', 'apprends', 'compléter', 'complétez', 'lire',
  'lisez', 'réponses', 'répondez', 'chapitre', 'texte', 'verbe', 'verbes', 'phrases',
  'conjugaison', 'vocabulaire', 'révision', 'dictée', 'traduire', 'traduisez',
  'élèves', 'professeur', 'livre', 'demain', 'aujourd'
]);

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) || []).length;
}

/**
 * Infers the language a homework entry is written in.
 * A meaningful share of the entry has to be in that language, so a couple of
 * stray words never decide the subject on their own.
 */
function detectLanguageSubject(text: string): SubjectRule | null {
  const gurmukhi = countMatches(text, /[\u0A00-\u0A7F]/g);
  const devanagari = countMatches(text, /[\u0900-\u097F]/g);
  const latin = countMatches(text, /[A-Za-z\u00C0-\u024F]/g);
  const totalLetters = gurmukhi + devanagari + latin;

  if (totalLetters < 20) return null;

  if (gurmukhi >= 10 && gurmukhi / totalLetters >= 0.4) return ALIAS_INDEX.get('punjabi') || null;
  if (devanagari >= 10 && devanagari / totalLetters >= 0.4) return ALIAS_INDEX.get('hindi') || null;

  const words = text
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
  if (words.length < 5) return null;

  const frenchWords = words.filter((word) => FRENCH_MARKERS.has(word));
  if (new Set(frenchWords).size >= 3 && frenchWords.length / words.length >= 0.2) {
    return ALIAS_INDEX.get('french') || null;
  }

  return null;
}

function formatSubjectName(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Resolves any subject spelling to its canonical name.
 * Unknown labels are kept, just tidied up, rather than being discarded.
 */
export function normalizeSubjectName(value: string): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return DEFAULT_SUBJECT.name;
  const rule = matchAlias(trimmed) || matchKeywords(trimmed);
  return rule ? rule.name : formatSubjectName(trimmed.toUpperCase());
}

/**
const NON_SUBJECT_HEADERS = new Set([
  'HOMEWORK', 'HOME WORK', 'CLASSWORK', 'CLASS WORK', 'CW', 'HW',
  'C.W.', 'H.W.', 'C.W', 'H.W', 'ANNOUNCEMENT', 'SCHOOL DIARY', 'GENERAL', 'NOTE', 'NOTES'
]);

/**
 * Subject detection pipeline following strict priority hierarchy:
 * Priority 1: Specific subject detected from actual homework content (e.g. "SOCIAL SCIENCE- GEOGRAPHY")
 * Priority 2: Explicit subject provided by EduSecure
 * Priority 3: Fallback signal from Classwork (CW)
 * Priority 4: Language-based fallback
 */
export function detectSubject(
  text: string,
  explicitSubject?: string | null,
  classworkSignal?: string | null
): SubjectInfo {
  // Priority 1: Detect subject from actual homework content text first
  if (text) {
    // Scan full homework text for subject keywords (e.g. "SOCIAL SCIENCE- GEOGRAPHY")
    const scanned = matchKeywords(text);
    if (scanned) return toSubjectInfo(scanned);

    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const firstLine = lines[0] || text;

    // Explicit label in front of separator ("HISTORY: Chapter 2")
    for (const separator of LABEL_SEPARATORS) {
      const index = firstLine.indexOf(separator);
      if (index <= 0) continue;

      const candidate = firstLine.slice(0, index).trim();
      const normKey = normalizeSubjectKey(candidate).toUpperCase();
      if (NON_SUBJECT_HEADERS.has(candidate.toUpperCase()) || NON_SUBJECT_HEADERS.has(normKey)) {
        continue;
      }

      const rule = matchAlias(candidate) || matchKeywords(candidate);
      if (rule) return toSubjectInfo(rule);

      if (normalizeSubjectKey(candidate).length > 2 && candidate.length < 30) {
        return {
          name: formatSubjectName(candidate.toUpperCase()),
          badgeClass: DEFAULT_SUBJECT.badgeClass,
          bgStyle: DEFAULT_SUBJECT.bgStyle,
          textStyle: DEFAULT_SUBJECT.textStyle
        };
      }
    }
  }

  // Priority 2: Explicit subject provided by EduSecure
  if (explicitSubject && typeof explicitSubject === 'string') {
    const trimmed = explicitSubject.trim();
    if (
      trimmed &&
      !['HOMEWORK', 'SCHOOL DIARY', 'ANNOUNCEMENT', 'GENERAL'].includes(trimmed.toUpperCase())
    ) {
      const rule = matchAlias(trimmed) || matchKeywords(trimmed);
      if (rule) return toSubjectInfo(rule);
      return {
        name: formatSubjectName(trimmed),
        badgeClass: DEFAULT_SUBJECT.badgeClass,
        bgStyle: DEFAULT_SUBJECT.bgStyle,
        textStyle: DEFAULT_SUBJECT.textStyle
      };
    }
  }

  // Priority 3: Classwork (CW) signal fallback
  if (classworkSignal && typeof classworkSignal === 'string') {
    const trimmedCw = classworkSignal.trim();
    if (trimmedCw) {
      const cwRule = matchAlias(trimmedCw) || matchKeywords(trimmedCw);
      if (cwRule) return toSubjectInfo(cwRule);
    }
  }

  // Priority 4: Language-based fallback logic (Punjabi, Hindi, French)
  if (text) {
    const language = detectLanguageSubject(text);
    if (language) return toSubjectInfo(language);
  }

  return DEFAULT_SUBJECT;
}
