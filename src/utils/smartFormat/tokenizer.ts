/**
 * Stage 2 — Tokenizer.
 *
 * Scans a piece of normalized text and returns the entities it recognises:
 * subjects, homework/classwork markers, action verbs, chapters, pages,
 * exercises, questions, dates, exams, assignments, worksheets, notebooks and
 * attachments.
 *
 * The tokenizer never rewrites the input. It only reports *where* something was
 * found (`start`/`end`) and what its expanded form would be (`normalized`), so
 * later stages can rebuild text without losing information.
 */
import { Token, TokenType } from './types';
import { ACTION_RULES, buildActionAlternation } from './rules/actions';
import { ENTITY_PATTERNS } from './rules/patterns';
import { SUBJECT_ALTERNATION } from './rules/subjects';
import { CLASSWORK_MARKER, HOMEWORK_MARKER } from './normalizer';

interface CompiledMatcher {
  type: TokenType;
  regex: RegExp;
  build: (match: RegExpMatchArray) => { normalized: string; meta?: Record<string, string> };
}

function escapeLiteral(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Canonical markers produced by the normalizer. */
const MARKER_MATCHERS: CompiledMatcher[] = [
  {
    type: 'homeworkMarker',
    regex: new RegExp(escapeLiteral(HOMEWORK_MARKER), 'g'),
    build: () => ({ normalized: 'Homework' }),
  },
  {
    type: 'classworkMarker',
    regex: new RegExp(escapeLiteral(CLASSWORK_MARKER), 'g'),
    build: () => ({ normalized: 'Classwork' }),
  },
];

/** Subject headers such as "MATHEMATICS:" at the start of a line. */
const SUBJECT_MATCHER: CompiledMatcher = {
  type: 'subject',
  regex: new RegExp(`(?<![A-Za-z])(?:${SUBJECT_ALTERNATION})(?=\\s*[:\\-–]|\\s*$)`, 'gi'),
  build: (match) => ({ normalized: match[0].trim() }),
};

/** One matcher per action rule, built from the shared synonym lists. */
const ACTION_MATCHERS: CompiledMatcher[] = ACTION_RULES.map((rule) => ({
  type: 'action' as TokenType,
  regex: new RegExp(`(?<![A-Za-z])(?:${buildActionAlternation(rule)})(?![A-Za-z])`, 'gi'),
  build: () => ({ normalized: rule.label, meta: { kind: rule.kind, label: rule.label } }),
}));

/**
 * Matcher priority. Markers and subjects first (they frame the text), then the
 * entity patterns (most specific first), then action verbs.
 */
const MATCHERS: CompiledMatcher[] = [
  ...MARKER_MATCHERS,
  SUBJECT_MATCHER,
  ...ENTITY_PATTERNS.map((pattern) => ({
    type: pattern.type,
    regex: pattern.regex,
    build: pattern.build,
  })),
  ...ACTION_MATCHERS,
];

function overlaps(token: { start: number; end: number }, accepted: Token[]): boolean {
  return accepted.some((existing) => token.start < existing.end && existing.start < token.end);
}

/**
 * Stage 2 entry point. Returns tokens ordered by position; overlapping matches
 * are resolved by matcher priority (first matcher wins).
 */
export function tokenize(text: string): Token[] {
  if (!text) return [];

  const accepted: Token[] = [];

  for (const matcher of MATCHERS) {
    // Each matcher owns a fresh regex instance so lastIndex never leaks.
    const regex = new RegExp(matcher.regex.source, matcher.regex.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex += 1;
        continue;
      }

      const candidate = {
        start: match.index,
        end: match.index + match[0].length,
      };

      if (overlaps(candidate, accepted)) continue;

      const { normalized, meta } = matcher.build(match);
      accepted.push({
        type: matcher.type,
        value: match[0],
        normalized,
        start: candidate.start,
        end: candidate.end,
        ...(meta ? { meta } : {}),
      });
    }
  }

  return accepted.sort((a, b) => a.start - b.start);
}

/** Convenience helper: tokens that describe *what* a task applies to. */
export const ENTITY_TOKEN_TYPES: TokenType[] = [
  'chapter',
  'page',
  'exercise',
  'question',
  'assignment',
  'worksheet',
  'notebook',
  'attachment',
  'exam',
];

export function entityTokens(tokens: Token[]): Token[] {
  return tokens.filter((token) => ENTITY_TOKEN_TYPES.includes(token.type));
}
