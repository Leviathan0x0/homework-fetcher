/**
 * Smart Homework Formatter — pipeline entry point.
 *
 *   Raw Homework                (EduSecure text, never modified)
 *        |
 *        v
 *   parseHomeworkContent()      existing CW/HW split, reused as-is
 *        |
 *        v
 *   Stage 1  Normalizer         ./normalizer.ts     whitespace, markers, punctuation
 *        |
 *        v
 *   Stage 2  Tokenizer          ./tokenizer.ts      subjects, verbs, chapters, pages, dates...
 *        |
 *        v
 *   Stage 3  Rule Engine        ./ruleEngine.ts     clauses -> { action, target, metadata }
 *        |
 *        v
 *   Stage 4  Semantic Structure ./types.ts          SmartHomework (no formatted strings)
 *        |
 *        v
 *   Stage 5  Formatter          ./formatter.ts      render model for the UI
 *        |
 *        v
 *   UI                          ../../components/SmartHomeworkContent.tsx
 *
 * Guarantees:
 *   - the original text is always returned in `raw` so the UI can toggle back
 *   - no information is removed; unrecognised text is copied through verbatim
 *   - when confidence is below SMART_FORMAT_CONFIDENCE_THRESHOLD the UI must
 *     render the raw text instead (see `isConfident`)
 *
 * Extending the parser: add a rule file under ./rules and reference it from the
 * tokenizer. No stage needs to change, and a future AI pass can be attached to
 * the low-confidence branch without touching Stages 1-5.
 */
import { parseHomeworkContent } from '../contentParser';
import { normalizeHomeworkText, stripSubjectHeaders } from './normalizer';
import { splitSections } from './segmenter';
import { extractTasks } from './ruleEngine';
import { SMART_FORMAT_CONFIDENCE_THRESHOLD, scoreSmartHomework, wordingCoverage } from './confidence';
import { formatSmartHomework } from './formatter';
import { SmartFormatResult, SmartHomework } from './types';

function joinBlocks(...blocks: string[]): string {
  return blocks.filter((block) => block.trim().length > 0).join('\n');
}

/** Stages 1-4: raw text becomes a semantic structure. */
export function buildSmartHomework(rawText: string, subjectName: string): SmartHomework {
  const raw = rawText ?? '';

  // Stage 1 — normalize the original text and drop the subject header, which the
  // card already shows. Nothing else is removed.
  const normalized = stripSubjectHeaders(normalizeHomeworkText(raw), subjectName);

  // Preferred path: the entry carries explicit CW:/HW: markers.
  const marked = splitSections(normalized, 'homework');

  let classworkText = marked.classwork;
  let homeworkText = marked.homework;
  let hasExplicitMarkers = marked.hasExplicitMarkers;

  if (!hasExplicitMarkers) {
    // Fallback: reuse the existing keyword heuristics so classwork detection
    // stays consistent with the rest of the app. The parser itself is untouched.
    const parsed = parseHomeworkContent(raw, subjectName);
    const parsedClasswork = stripSubjectHeaders(normalizeHomeworkText(parsed.classWork ?? ''), subjectName);
    const parsedHomework = stripSubjectHeaders(normalizeHomeworkText(parsed.homeWork ?? ''), subjectName);

    const fromClasswork = splitSections(parsedClasswork, 'classwork');
    const fromHomework = splitSections(parsedHomework, 'homework');

    const candidateClasswork = joinBlocks(fromClasswork.classwork, fromHomework.classwork);
    const candidateHomework = joinBlocks(fromClasswork.homework, fromHomework.homework);

    // Only adopt the heuristic split when it kept the original wording intact;
    // otherwise keep everything as homework rather than lose a sentence.
    if (wordingCoverage([candidateClasswork, candidateHomework], normalized) >= 0.98) {
      classworkText = candidateClasswork;
      homeworkText = candidateHomework;
      hasExplicitMarkers = fromClasswork.hasExplicitMarkers || fromHomework.hasExplicitMarkers;
    }
  }

  // Stages 2-3 — tokenize and apply the rules, per section.
  const classwork = extractTasks(classworkText);
  const homework = extractTasks(homeworkText);

  const confidence = scoreSmartHomework({
    classwork,
    homework,
    hasExplicitMarkers,
    // Coverage is measured against the normalized original: if any wording went
    // missing on the way to the tasks, confidence drops and the UI shows raw text.
    sourceText: normalized,
  });

  // Stage 4 — semantic structure.
  return {
    subject: subjectName,
    classwork,
    homework,
    confidence,
    raw,
    normalized,
  };
}

/** Full pipeline (Stages 1-5) plus the confidence verdict used by the UI. */
export function smartFormatHomework(rawText: string, subjectName: string): SmartFormatResult {
  const structure = buildSmartHomework(rawText, subjectName);
  const formatted = formatSmartHomework(structure);

  return {
    structure,
    formatted,
    confidence: structure.confidence,
    isConfident:
      structure.confidence >= SMART_FORMAT_CONFIDENCE_THRESHOLD && formatted.sections.length > 0,
    raw: structure.raw,
  };
}

export { SMART_FORMAT_CONFIDENCE_THRESHOLD } from './confidence';
export { normalizeHomeworkText } from './normalizer';
export { tokenize } from './tokenizer';
export { extractTasks } from './ruleEngine';
export { formatSmartHomework, renderSmartHomeworkText } from './formatter';
export * from './types';
