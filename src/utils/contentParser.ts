export interface ParsedHomeworkContent {
  classWork?: string;
  homeWork?: string;
}

export function parseHomeworkContent(rawText: string, subjectName: string): ParsedHomeworkContent {
  if (!rawText) return { homeWork: '' };

  let cleaned = rawText.trim();

  // 1. Separate sub-subject headers embedded without whitespace (e.g. "symbolsChemistry ch-9:")
  const subjectsPattern = '(?:MATHEMATICS|MATHS|MATH|SCIENCE|PHYSICS|CHEMISTRY|BIOLOGY|ENGLISH|HINDI|COMPUTERS|COMPUTER|IT|S\\.ST|SOCIAL STUDIES|HISTORY|CIVICS|GEOGRAPHY|PUNJABI|ART)';

  const embeddedSubjectRegex = new RegExp(
    `(?<=[a-zA-Z0-9.,!\\)])(?=${subjectsPattern}(?:\\s*(?:ch|chapter|unit|ex|exercise|\\d+))?[:\\-\\s])`,
    'gi'
  );
  cleaned = cleaned.replace(embeddedSubjectRegex, '\n').trim();

  // 2. Remove subject name prefixes at the very start
  const escapedSubject = subjectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const leadingSubjectRegex = new RegExp(
    `^(?:${escapedSubject}|${subjectsPattern})[:\\-\\s]*`,
    'i'
  );
  cleaned = cleaned.replace(leadingSubjectRegex, '').trim();

  // 3. Inline subject headers: replace with newline
  const inlineSubjectRegex = new RegExp(
    `(?<=[.\\n\\s])${subjectsPattern}[:\\-\\s]+`,
    'gi'
  );
  cleaned = cleaned.replace(inlineSubjectRegex, '\n').trim();

  // 4. Explicit Marker Detection (CLASS WORK / HOME WORK / C.W. / H.W. / CW / HW)
  const cwMarkerPattern = /(?:CLASS\s*WORK|CLASSWORK|C\.W\.|C\.W|CW|कक्षा\s*कार्य)[:\-\s]*/i;
  const hwMarkerPattern = /(?:HOME\s*WORK|HOMEWORK|H\.W\.|H\.W|HW|गृह\s*कार्य)[:\-\s]*/i;

  const hasExplicitCW = cwMarkerPattern.test(cleaned);
  const hasExplicitHW = hwMarkerPattern.test(cleaned);

  if (hasExplicitCW || hasExplicitHW) {
    let cwText = '';
    let hwText = '';

    const parts = cleaned.split(/(CLASS\s*WORK|CLASSWORK|C\.W\.|C\.W|CW|कक्षा\s*कार्य|HOME\s*WORK|HOMEWORK|H\.W\.|H\.W|HW|गृह\s*कार्य)[:\-\s]*/i);
    let currentSection: 'cw' | 'hw' | 'none' = 'none';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (!part) continue;

      if (cwMarkerPattern.test(part)) {
        currentSection = 'cw';
      } else if (hwMarkerPattern.test(part)) {
        currentSection = 'hw';
      } else {
        // Strip any remaining internal "CLASSWORK:" or "CLASS WORK:" header strings
        const cleanedPart = part.replace(/(?:CLASS\s*WORK|CLASSWORK|C\.W\.|C\.W|CW|HOME\s*WORK|HOMEWORK|H\.W\.|H\.W|HW)[:\-\s]*/gi, '').trim();
        if (!cleanedPart) continue;

        if (currentSection === 'cw') {
          cwText += (cwText ? '\n' : '') + cleanedPart;
        } else if (currentSection === 'hw') {
          hwText += (hwText ? '\n' : '') + cleanedPart;
        } else {
          // Default section before any marker is encountered
          if (hasExplicitCW && !hasExplicitHW) {
            cwText += (cwText ? '\n' : '') + cleanedPart;
          } else {
            hwText += (hwText ? '\n' : '') + cleanedPart;
          }
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

  // 5. Smart Sentence & Line Keyword Detection (When explicit CW/HW tags are missing)
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

  // 6. Default: Entire text as Home Work
  return {
    homeWork: cleaned,
  };
}
