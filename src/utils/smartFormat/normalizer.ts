/**
 * Stage 1 — Normalizer.
 *
 * Cleans up messy EduSecure text without changing its meaning: line endings,
 * stray whitespace, punctuation spacing and the many spellings of the
 * homework / classwork markers.
 *
 * Rules of this stage:
 *   - never drop words
 *   - never reorder content
 *   - only rewrite tokens whose meaning is unambiguous (HW, C.W., ...)
 */
import { SUBJECT_ALTERNATION } from './rules/subjects';

/** Canonical markers emitted by this stage and consumed by the segmenter. */
export const HOMEWORK_MARKER = 'HW:';
export const CLASSWORK_MARKER = 'CW:';

/**
 * All spellings of the homework marker we have seen in real diary entries.
 * "No homework" is excluded on purpose: there the word is content, not a marker.
 */
const HOMEWORK_MARKER_PATTERN =
  /(?<![A-Za-z0-9])(?<!\bno\s{1,4})(?:HOME\s*WORK|HOMEWORK|H\s*\.\s*W\s*\.?|HW|गृह\s*कार्य)(?![A-Za-z])\s*[:\-–]?\s*/gi;

/** All spellings of the classwork marker. */
const CLASSWORK_MARKER_PATTERN =
  /(?<![A-Za-z0-9])(?<!\bno\s{1,4})(?:CLASS\s*WORK|CLASSWORK|C\s*\.\s*W\s*\.?|CW|कक्षा\s*कार्य)(?![A-Za-z])\s*[:\-–]?\s*/gi;

/** Converts CRLF / CR to LF and normalises exotic unicode whitespace. */
function normalizeLineEndings(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, ' ')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"');
}

/** Collapses runs of spaces/tabs and removes duplicate blank lines. */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Fixes obvious punctuation spacing: no space before `,` `.` `:` `;`, exactly
 * one space after them when a word follows. Decimal numbers, page ranges and
 * initialisms such as "S.ST" or "G.K." are left untouched.
 */
function normalizePunctuation(text: string): string {
  return text
    .replace(/\s+([,;:.!?])/g, '$1')
    .replace(/([,;])(?=[^\s])/g, '$1 ')
    .replace(/(?<=[A-Za-z]{3})([.!?])(?=[A-Za-z]{2,})/g, '$1 ')
    .replace(/:(?=[^\s\d])/g, ': ')
    .replace(/\s*-\s*(?=\d)/g, '-')
    .replace(/([,;.])\1+/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/^[\s•*\-–]+/gm, '')
    .trim();
}

/**
 * Rewrites every homework/classwork abbreviation to a single canonical marker
 * so later stages only have to match one shape. A marker that appears after
 * other content also starts a new line, which keeps sections separable.
 */
function standardizeMarkers(text: string): string {
  return text
    .replace(HOMEWORK_MARKER_PATTERN, (_match, offset: number) =>
      `${offset > 0 ? '\n' : ''}${HOMEWORK_MARKER} `
    )
    .replace(CLASSWORK_MARKER_PATTERN, (_match, offset: number) =>
      `${offset > 0 ? '\n' : ''}${CLASSWORK_MARKER} `
    )
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Stage 1 entry point. Returns cleaned text with canonical `CW:` / `HW:`
 * markers. Safe to call on already-normalized text (idempotent).
 */
export function normalizeHomeworkText(rawText: string): string {
  if (!rawText) return '';

  const withLineEndings = normalizeLineEndings(rawText);
  const withMarkers = standardizeMarkers(withLineEndings);
  const withPunctuation = normalizePunctuation(withMarkers);

  return normalizeWhitespace(withPunctuation);
}

/**
 * Drops subject headers such as "MATHEMATICS:" or "Science -" from the start of
 * a line, because the subject is already shown in the card header.
 *
 * Deliberately conservative: a keyword is only removed when it is followed by a
 * `:`/`-` separator or is the whole line, so words that merely contain a subject
 * name (for example "heart" containing "art") are never touched.
 */
export function stripSubjectHeaders(text: string, subjectName: string): string {
  if (!text) return '';

  const escapedSubject = subjectName ? subjectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') : null;
  const alternation = [escapedSubject, SUBJECT_ALTERNATION].filter(Boolean).join('|');
  const headerPattern = new RegExp(`^(?:${alternation})\\s*(?:[:\\-–]\\s*|$)`, 'i');

  return text
    .split('\n')
    .map((line) => {
      const stripped = line.replace(headerPattern, '').trim();
      return stripped;
    })
    .filter(Boolean)
    .join('\n');
}
