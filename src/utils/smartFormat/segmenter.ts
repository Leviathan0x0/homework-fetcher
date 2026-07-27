/**
 * Segmenter — shared helper for Stage 3.
 *
 * Two jobs:
 *   1. `splitSections`  — route normalized text into classwork / homework using
 *      the canonical `CW:` / `HW:` markers produced by the normalizer.
 *   2. `splitClauses`   — break a block of text into the smallest units that
 *      still make sense on their own ("Read Ch-8", "Complete Pg-42", ...).
 *
 * Both helpers are conservative: they only split where a boundary is obvious,
 * because a wrong split is worse than no split at all.
 */
import { SectionKind } from './types';
import { ALL_ACTIONS_ALTERNATION } from './rules/actions';
import { CLASSWORK_MARKER, HOMEWORK_MARKER } from './normalizer';

export interface SectionSplit {
  classwork: string;
  homework: string;
  hasExplicitMarkers: boolean;
}

/** Abbreviations whose trailing dot must not be treated as a sentence end. */
const ABBREVIATIONS = [
  'ch',
  'chap',
  'pg',
  'pgs',
  'p',
  'ex',
  'q',
  'qs',
  'ques',
  'no',
  'fig',
  'vol',
  'sr',
  'sl',
  'mr',
  'mrs',
  'ms',
  'dr',
  'etc',
  'approx',
  'pt',
  'hrs',
];

/** Stand-in for a protected dot while sentence splitting. */
const DOT_PLACEHOLDER = '\u0000';

const ABBREVIATION_DOT = new RegExp(`\\b(${ABBREVIATIONS.join('|')})\\.`, 'gi');

/** `, Complete ...` / ` and bring ...` — a connector followed by a known verb. */
const ACTION_CONTINUATION = new RegExp(
  `\\s*(?:,|;|&|\\+|\\band\\b|\\balso\\b|\\bthen\\b)\\s+(?=(?:${ALL_ACTIONS_ALTERNATION})(?![A-Za-z]))`,
  'gi'
);

const BULLET_BOUNDARY = /\s*(?:[•·*]|\|)\s*/g;
const ENUMERATION_BOUNDARY = /(?:^|\s)\d{1,2}[).]\s+/g;
const SENTENCE_BOUNDARY = /(?<=[.!?;])\s+/g;
const BARE_ACTION = new RegExp(`(?:${ALL_ACTIONS_ALTERNATION})`, 'gi');

/**
 * Routes lines into classwork / homework buckets. Text before the first marker
 * stays in `defaultKind`, which mirrors how the existing content parser behaves.
 */
export function splitSections(text: string, defaultKind: SectionKind): SectionSplit {
  const result: SectionSplit = { classwork: '', homework: '', hasExplicitMarkers: false };
  if (!text) return result;

  let current: SectionKind = defaultKind;

  for (const line of text.split('\n')) {
    let content = line.trim();
    if (!content) continue;

    if (content.startsWith(CLASSWORK_MARKER)) {
      current = 'classwork';
      result.hasExplicitMarkers = true;
      content = content.slice(CLASSWORK_MARKER.length).trim();
    } else if (content.startsWith(HOMEWORK_MARKER)) {
      current = 'homework';
      result.hasExplicitMarkers = true;
      content = content.slice(HOMEWORK_MARKER.length).trim();
    }

    if (!content) continue;
    result[current] = result[current] ? `${result[current]}\n${content}` : content;
  }

  return result;
}

/** Protects dots that belong to abbreviations or decimals before splitting. */
function protectDots(text: string): string {
  return text
    .replace(ABBREVIATION_DOT, (_match, abbr: string) => `${abbr}${DOT_PLACEHOLDER}`)
    .replace(/(\d)\.(?=\d)/g, `$1${DOT_PLACEHOLDER}`);
}

function restoreDots(text: string): string {
  return text.split(DOT_PLACEHOLDER).join('.');
}

function splitByAll(pieces: string[], separator: RegExp): string[] {
  const next: string[] = [];
  for (const piece of pieces) {
    for (const part of piece.split(new RegExp(separator.source, separator.flags))) {
      next.push(part);
    }
  }
  return next;
}

/** True when a piece is nothing but an action verb ("Learn", "and revise"). */
function isBareAction(piece: string): boolean {
  const detector = new RegExp(BARE_ACTION.source, BARE_ACTION.flags);
  if (!detector.test(piece)) return false;

  const withoutActions = piece.replace(new RegExp(BARE_ACTION.source, BARE_ACTION.flags), ' ');
  return !/[A-Za-z0-9\u0900-\u097F]/.test(withoutActions);
}

/**
 * Re-joins pieces such as "Learn" + "revise Ch-8", which mean one task with two
 * verbs rather than two tasks. Prevents targets from being dropped.
 */
function mergeBareActions(pieces: string[]): string[] {
  const merged: string[] = [];

  for (let i = 0; i < pieces.length; i += 1) {
    const piece = pieces[i].trim();
    if (!piece) continue;

    if (isBareAction(piece) && i + 1 < pieces.length) {
      pieces[i + 1] = `${piece} and ${pieces[i + 1].trim()}`;
      continue;
    }

    merged.push(piece);
  }

  return merged;
}

/**
 * Breaks a block of text into clauses. Splits on line breaks, sentence ends,
 * bullets, enumerations and "connector + action verb" boundaries only.
 */
export function splitClauses(text: string): string[] {
  if (!text) return [];

  let pieces = protectDots(text).split('\n');
  pieces = splitByAll(pieces, SENTENCE_BOUNDARY);
  pieces = splitByAll(pieces, BULLET_BOUNDARY);
  pieces = splitByAll(pieces, ENUMERATION_BOUNDARY);
  pieces = splitByAll(pieces, ACTION_CONTINUATION);

  const clauses = mergeBareActions(pieces)
    .map((piece) => restoreDots(piece).trim())
    .map((piece) => piece.replace(/^[\s,;:.\-–]+/, '').replace(/[\s,;:]+$/, '').trim())
    .filter((piece) => /[A-Za-z0-9\u0900-\u097F]/.test(piece));

  return clauses;
}
