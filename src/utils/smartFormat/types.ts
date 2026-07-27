/**
 * Smart Homework Formatter — shared types.
 *
 * Pipeline overview (see ./index.ts for the orchestration):
 *
 *   Raw Homework -> Normalizer -> Tokenizer -> Rule Engine
 *                -> Semantic Structure -> Formatter -> UI
 *
 * Nothing in here depends on React, so the whole pipeline stays testable and
 * reusable from the server or a future AI fallback path.
 */

/** Canonical action verbs the rule engine understands. */
export type ActionKind =
  | 'read'
  | 'learn'
  | 'complete'
  | 'write'
  | 'revise'
  | 'prepare'
  | 'bring'
  | 'draw'
  | 'colour'
  | 'paste'
  | 'solve'
  | 'memorize';

/** Section a task belongs to. */
export type SectionKind = 'classwork' | 'homework';

/** Entities the tokenizer recognises inside a clause. */
export type TokenType =
  | 'subject'
  | 'homeworkMarker'
  | 'classworkMarker'
  | 'action'
  | 'chapter'
  | 'page'
  | 'exercise'
  | 'question'
  | 'assignment'
  | 'worksheet'
  | 'notebook'
  | 'attachment'
  | 'exam'
  | 'date';

export interface Token {
  type: TokenType;
  /** Exact substring that produced this token (never discarded). */
  value: string;
  /** Human readable, expanded form: "Ch-8" -> "Chapter 8". */
  normalized: string;
  start: number;
  end: number;
  /** Extra structured details, e.g. { number: '8' } or { kind: 'read' }. */
  meta?: Record<string, string>;
}

/** Structured details collected for a single task. */
export interface TaskMetadata {
  chapters?: string[];
  pages?: string[];
  exercises?: string[];
  questions?: string[];
  assignments?: string[];
  dates?: string[];
  worksheet?: boolean;
  notebook?: boolean;
  attachment?: boolean;
  exam?: boolean;
}

/** Stage 4 output: one actionable item. */
export interface SmartTask {
  /** Canonical action, or null when no known verb was found. */
  action: ActionKind | null;
  /** Display label for the action group ("Read", "Complete", ...). */
  actionLabel: string | null;
  /** What the action applies to, with abbreviations expanded. */
  target: string;
  /** Original clause, kept verbatim so information is never lost. */
  raw: string;
  metadata: TaskMetadata;
  /** Per-task confidence, 0-100. */
  confidence: number;
}

/** Stage 4 output: the semantic structure of one homework entry. */
export interface SmartHomework {
  subject: string;
  classwork: SmartTask[];
  homework: SmartTask[];
  /** Overall confidence, 0-100. */
  confidence: number;
  /** Untouched original text. */
  raw: string;
  /** Normalizer output (Stage 1), useful for debugging. */
  normalized: string;
}

/** Stage 5 output: a single rendered line. */
export interface FormattedItem {
  text: string;
  /** Homework items render as checkboxes, classwork items as bullets. */
  checkable: boolean;
  /** Original clause, exposed for tooltips / accessibility. */
  raw: string;
}

/** Stage 5 output: repeated actions merged under one heading. */
export interface FormattedGroup {
  /** Action label, or null for items without a recognised verb. */
  label: string | null;
  /**
   * `inline` renders one line ("Read Chapter 8"); `grouped` renders the label as
   * a heading with the targets listed beneath it.
   */
  layout: 'inline' | 'grouped';
  items: FormattedItem[];
}

export interface FormattedSection {
  kind: SectionKind;
  title: string;
  groups: FormattedGroup[];
}

/** Stage 5 output consumed by the UI. */
export interface FormattedHomework {
  subject: string;
  icon: string;
  sections: FormattedSection[];
  confidence: number;
}

/** Public result of the whole pipeline. */
export interface SmartFormatResult {
  /** Semantic structure (Stage 4). */
  structure: SmartHomework;
  /** Renderable model (Stage 5). */
  formatted: FormattedHomework;
  confidence: number;
  /**
   * True when confidence clears the threshold. When false the UI must fall
   * back to the raw text — never to a guessed format.
   */
  isConfident: boolean;
  /** Untouched original text, always available for the "Original" toggle. */
  raw: string;
}
