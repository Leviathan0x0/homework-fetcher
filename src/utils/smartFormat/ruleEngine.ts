/**
 * Stage 3 — Rule Engine, and Stage 4 — Semantic Structure (per task).
 *
 * Turns clauses into `SmartTask` objects:
 *
 *   "Read Ch-8"  ->  { action: 'read', target: 'Chapter 8', ... }
 *
 * Deterministic only — no AI, no guessing. When a clause cannot be understood
 * the task keeps the original wording and reports a low confidence, which lets
 * the UI fall back to the raw homework text.
 */
import { SmartTask, TaskMetadata, Token } from './types';
import { ENTITY_TOKEN_TYPES, entityTokens, tokenize } from './tokenizer';
import { splitClauses } from './segmenter';
import { ACTION_RULES, LEADING_FILLER_WORDS } from './rules/actions';

/** Only filler/punctuation may precede the verb for it to count as the action. */
const ACTION_PREFIX = /^[\s,;:.\-–]*(?:please|kindly|now|to|also|and|then|you\s+(?:have\s+to|must|should)|we\s+(?:have\s+to|must))?[\s,;:.\-–]*$/i;

/** Two verbs share a target only when joined by an explicit connector. */
const ACTION_JOINER = /^\s*(?:,\s*)?(?:and|or|then|also|\+|&|\/)\s*$/i;

/** Negations make a clause risky to reformat, so confidence drops. */
const NEGATION = /\b(?:not|don'?t|do\s+not|no\s+need|except|without)\b/i;

/** "Do not ...", "Don't ..." — the verb is negated, so it is not an action. */
const NEGATED_VERB = /^\s*(?:not|n'?t)\b/i;

const DEVANAGARI = /[\u0900-\u097F]/g;

const FILLER_PREFIX = new RegExp(
  `^(?:${LEADING_FILLER_WORDS.map((word) => word.replace(/\s+/g, '\\s+')).join('|')})(?![A-Za-z])\\s*`,
  'i'
);

const ACTION_KIND_BY_LABEL = new Map(ACTION_RULES.map((rule) => [rule.label, rule.kind]));

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Removes leftover punctuation and determiners, then capitalises. */
function tidyTarget(text: string): string {
  let cleaned = text.replace(/\s+/g, ' ').trim();
  cleaned = cleaned.replace(/^[\s,;:.\-–]+/, '').trim();

  let previous = '';
  while (cleaned && cleaned !== previous) {
    previous = cleaned;
    cleaned = cleaned.replace(FILLER_PREFIX, '').trim();
  }

  cleaned = cleaned.replace(/[\s,;:.]+$/, '').trim();
  return capitalize(cleaned);
}

/**
 * Collects the verb(s) that open a clause. Verbs found mid-clause are left in
 * place: rewriting around them is where naive formatters lose meaning.
 */
function collectLeadingActions(clause: string, tokens: Token[]): Token[] {
  const actions = tokens.filter((token) => token.type === 'action');
  if (actions.length === 0) return [];

  const first = actions[0];
  if (!ACTION_PREFIX.test(clause.slice(0, first.start))) return [];
  // "Do not bring ..." must never become a "Complete" task.
  if (NEGATED_VERB.test(clause.slice(first.end))) return [];

  const leading: Token[] = [first];

  for (let i = 1; i < actions.length; i += 1) {
    const previous = leading[leading.length - 1];
    const candidate = actions[i];
    if (!ACTION_JOINER.test(clause.slice(previous.end, candidate.start))) break;
    leading.push(candidate);
  }

  return leading;
}

/**
 * Rebuilds the clause without its leading verb(s) and with every recognised
 * entity expanded ("Ch-8" -> "Chapter 8"). Text the tokenizer did not
 * understand is copied through untouched so nothing is ever dropped.
 */
function renderTarget(clause: string, tokens: Token[], leadingActions: Token[]): string {
  const skipped = new Set(leadingActions);
  let out = '';
  let cursor = 0;

  for (const token of tokens) {
    if (token.start < cursor) continue;

    if (skipped.has(token) || token.type === 'homeworkMarker' || token.type === 'classworkMarker') {
      out += clause.slice(cursor, token.start);
      cursor = token.end;
      continue;
    }

    if (ENTITY_TOKEN_TYPES.includes(token.type)) {
      out += clause.slice(cursor, token.start) + token.normalized;
      cursor = token.end;
    }
  }

  out += clause.slice(cursor);
  return tidyTarget(out);
}

function pushUnique(list: string[] | undefined, value: string): string[] {
  const next = list ?? [];
  if (!next.includes(value)) next.push(value);
  return next;
}

/** Stage 4 metadata: the structured facts behind a task. */
function collectMetadata(tokens: Token[]): TaskMetadata {
  const metadata: TaskMetadata = {};

  for (const token of tokens) {
    switch (token.type) {
      case 'chapter':
        metadata.chapters = pushUnique(metadata.chapters, token.normalized);
        break;
      case 'page':
        metadata.pages = pushUnique(metadata.pages, token.normalized);
        break;
      case 'exercise':
        metadata.exercises = pushUnique(metadata.exercises, token.normalized);
        break;
      case 'question':
        metadata.questions = pushUnique(metadata.questions, token.normalized);
        break;
      case 'assignment':
        metadata.assignments = pushUnique(metadata.assignments, token.normalized);
        break;
      case 'date':
        metadata.dates = pushUnique(metadata.dates, token.normalized);
        break;
      case 'worksheet':
        metadata.worksheet = true;
        break;
      case 'notebook':
        metadata.notebook = true;
        break;
      case 'attachment':
        metadata.attachment = true;
        break;
      case 'exam':
        metadata.exam = true;
        break;
      default:
        break;
    }
  }

  return metadata;
}

/**
 * Per-task confidence. Recognised verbs and entities raise it; long, negated or
 * non-Latin clauses lower it. Anything below the threshold in ./confidence.ts
 * makes the UI show the original text instead.
 */
function scoreTask(clause: string, tokens: Token[], leadingActions: Token[], target: string): number {
  const entities = entityTokens(tokens);
  const words = clause.split(/\s+/).filter(Boolean).length;
  let score = 45;

  if (leadingActions.length > 0) score += 30;
  if (entities.length > 0) score += 20;
  if (words <= 12) score += 5;
  else if (words > 22) score -= 20;
  if (leadingActions.length === 0 && entities.length === 0) score -= 30;
  if (NEGATION.test(clause)) score -= 25;
  if (leadingActions.length > 0 && !target) score -= 10;

  const devanagari = clause.match(DEVANAGARI)?.length ?? 0;
  if (devanagari / Math.max(clause.length, 1) > 0.2) score -= 25;

  return Math.max(0, Math.min(100, score));
}

/** Builds one task from one clause. */
export function buildTask(clause: string): SmartTask {
  const tokens = tokenize(clause);
  const leadingActions = collectLeadingActions(clause, tokens);
  const target = renderTarget(clause, tokens, leadingActions);

  const actionLabel =
    leadingActions.length > 0
      ? [...new Set(leadingActions.map((token) => token.normalized))].join(' & ')
      : null;
  const primaryKind = leadingActions.length > 0 ? ACTION_KIND_BY_LABEL.get(leadingActions[0].normalized) ?? null : null;

  return {
    action: primaryKind,
    actionLabel,
    target,
    raw: clause,
    metadata: collectMetadata(tokens),
    confidence: scoreTask(clause, tokens, leadingActions, target),
  };
}

/** Stage 3 entry point: a block of section text becomes a list of tasks. */
export function extractTasks(sectionText: string): SmartTask[] {
  return splitClauses(sectionText).map(buildTask);
}
