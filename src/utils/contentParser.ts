export interface ParsedHomeworkContent {
  classWork?: string;
  homeWork?: string;
}

export function parseHomeworkContent(rawText: string, subjectName: string): ParsedHomeworkContent {
  if (!rawText) return { homeWork: '' };

  let cleaned = rawText.trim();

  // 1. Separate sub-subject headers embedded without whitespace (e.g. "symbolsChemistry ch-9:")
  // \b ensures subjects like IT don't match inside words like "UNIT"
  const subjectsPattern = '\\b(?:MATHEMATICS|MATHS|MATH|SOCIAL SCIENCE|SOCIAL STUDIES|SOCAL SCIENCE|SOCAL STUDIES|SOCAL|SOCIAL|S\\.ST|SST|COMPUTER SCIENCE|COMPUTER SCI|COMPUTERS|COMPUTER|SCIENCE|PHYSICS|CHEMISTRY|BIOLOGY|ENGLISH|HINDI|IT|HISTORY|CIVICS|GEOGRAPHY|PUNJABI|ART)\\b';

  const embeddedSubjectRegex = new RegExp(
    `(?<=[.,!\\?\\)\\n]|^|\\s)(?=${subjectsPattern}(?:\\s*(?:ch|chapter|unit|ex|exercise|\\d+))?[:\\-])`,
    'gi'
  );
  cleaned = cleaned.replace(embeddedSubjectRegex, '\n').trim();

  // 2. Remove matching subject name prefix at the very start if followed by separator
  const escapedSubject = subjectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const leadingSubjectRegex = new RegExp(
    `^(?:${escapedSubject})[:\\-\\s]+`,
    'i'
  );
  cleaned = cleaned.replace(leadingSubjectRegex, '').trim();

  // 3. Explicit Header Marker Detection (CLASS WORK / HOME WORK / C.W. / H.W. / CW / HW)
  // Headers must either start at beginning of line or be followed by : / -
  const cwHeaderPattern = /(?:(?:^|\n)\s*(?:CLASS\s*WORK|CLASSWORK|C\.W\.|C\.W|CW|कक्षा\s*कार्य)\s*[:\-\s\n]|(?:CLASS\s*WORK|CLASSWORK|C\.W\.|C\.W|CW|कक्षा\s*कार्य)\s*[:\-]+)/i;
  const hwHeaderPattern = /(?:(?:^|\n)\s*(?:HOME\s*WORK|HOMEWORK|H\.W\.|H\.W|HW|गृह\s*कार्य)\s*[:\-\s\n]|(?:HOME\s*WORK|HOMEWORK|H\.W\.|H\.W|HW|गृह\s*कार्य)\s*[:\-]+)/i;

  const hasExplicitCW = cwHeaderPattern.test(cleaned);
  const hasExplicitHW = hwHeaderPattern.test(cleaned);

  if (hasExplicitCW || hasExplicitHW) {
    let cwText = '';
    let hwText = '';

    // Split on valid section headers
    const sectionSplitRegex = /(?:(?:^|\n)\s*(?:CLASS\s*WORK|CLASSWORK|C\.W\.|C\.W|CW|कक्षा\s*कार्य|HOME\s*WORK|HOMEWORK|H\.W\.|H\.W|HW|गृह\s*कार्य)\s*[:\-]*|(?:CLASS\s*WORK|CLASSWORK|C\.W\.|C\.W|CW|कक्षा\s*कार्य|HOME\s*WORK|HOMEWORK|H\.W\.|H\.W|HW|गृह\s*कार्य)\s*[:\-]+)/gi;

    const parts = cleaned.split(sectionSplitRegex);
    const matches = Array.from(cleaned.matchAll(sectionSplitRegex));

    // Initial section before the first header (if any)
    let currentSection: 'cw' | 'hw' | 'none' = 'none';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();

      if (i > 0 && matches[i - 1]) {
        const headerMatched = matches[i - 1][0];
        if (cwHeaderPattern.test(headerMatched)) {
          currentSection = 'cw';
        } else if (hwHeaderPattern.test(headerMatched)) {
          currentSection = 'hw';
        }
      }

      if (!part) continue;

      // Clean redundant headers (like ENGLISH:\nHOMEWORK:) from section text
      const cleanedPart = part
        .replace(/^(?:ENGLISH|MATHEMATICS|MATHS|MATH|SCIENCE|PHYSICS|CHEMISTRY|BIOLOGY|HINDI|PUNJABI|SST|SOCIAL SCIENCE|COMPUTER|IT)[:\-\s]*/gi, '')
        .replace(/^(?:CLASS\s*WORK|CLASSWORK|C\.W\.|C\.W|CW|HOME\s*WORK|HOMEWORK|H\.W\.|H\.W|HW)[:\-\s]*/gi, '')
        .trim();

      if (!cleanedPart) continue;

      if (currentSection === 'cw') {
        cwText += (cwText ? '\n' : '') + cleanedPart;
      } else if (currentSection === 'hw') {
        hwText += (hwText ? '\n' : '') + cleanedPart;
      } else {
        if (hasExplicitCW && !hasExplicitHW) {
          cwText += (cwText ? '\n' : '') + cleanedPart;
        } else {
          hwText += (hwText ? '\n' : '') + cleanedPart;
        }
      }
    }

    const finalCW = cwText.trim();
    const finalHW = hwText.trim();

    return {
      classWork: finalCW || undefined,
      homeWork: finalHW || (finalCW ? undefined : cleaned),
    };
  }

  // 4. Smart Sentence & Line Keyword Detection (When explicit CW/HW tags are missing)
  const statements = cleaned
    .split(/(?<=[.\n])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const cwKeywords = /(?:\b(?:topics?\s*(?:covered|discussed)|covered|discussed|completed|explained|taught|introduced|started|continued|read in class|done in class)\b|\b(?:exercise|ex|q|q\.|questions?|page|pg|pg\.)\s*[\d\s,\-and&]+\s*done\b|\bdone\b|\bcompleted\b|\bfinished\b|\btopics?\s*covered[:\-\s])/i;
  const hwKeywords = /(?:\b(?:test|exam|unit\s*test|eval|evaluation)\b|\b(?:bring|carry)\b|\b(?:learn|memorize|revise)\b|\b(?:do|complete|solve|write|make|frame|prepare)\b.*\b(?:notebook|register|fair notebook|assignment|project|file)\b|\b(?:practice\s+writing|practice\s+doing)\b|\b(?:do|complete|solve|write)\s+(?:q\/ans|questions?|ex|exercise|page|pg)\b)/i;

  const foundCWStatements: string[] = [];
  const foundHWStatements: string[] = [];

  for (const stmt of statements) {
    const isCW = cwKeywords.test(stmt);
    const isHW = hwKeywords.test(stmt);

    if (isCW && !isHW) {
      foundCWStatements.push(stmt);
    } else if (isHW) {
      foundHWStatements.push(stmt);
    } else if (statements.length > 1) {
      if (isCW) {
        foundCWStatements.push(stmt);
      } else {
        foundHWStatements.push(stmt);
      }
    }
  }

  if (foundCWStatements.length > 0 && foundHWStatements.length > 0) {
    return {
      classWork: foundCWStatements.join('\n'),
      homeWork: foundHWStatements.join('\n'),
    };
  }

  if (foundCWStatements.length > 0 && foundHWStatements.length === 0) {
    return {
      classWork: foundCWStatements.join('\n'),
      homeWork: undefined,
    };
  }

  // 5. Default: Entire text as Home Work
  return {
    homeWork: cleaned,
  };
}
