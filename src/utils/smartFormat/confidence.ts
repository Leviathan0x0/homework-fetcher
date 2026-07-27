/**
 * Confidence scoring.
 *
 * The formatter is only allowed to replace the original homework text when it is
 * confident the structure it produced is faithful. Scoring is intentionally
 * pessimistic: anything unusual (long blobs, negations, lost digits, missing
 * coverage of the source text) pushes the score below the threshold and the UI
 * falls back to the raw wording.
 *
 * A future AI integration should plug in *below* this threshold — it can enrich
 * the low-confidence path without touching the deterministic stages.
 */
import { SmartTask } from './types';

/** Minimum score required to render the smart format by default. */
export const SMART_FORMAT_CONFIDENCE_THRESHOLD = 60;

export interface ConfidenceInput {
  classwork: SmartTask[];
  homework: SmartTask[];
  /** True when explicit CW:/HW: markers were present in the source. */
  hasExplicitMarkers: boolean;
  /** Normalized source text the tasks are expected to cover. */
  sourceText: string;
}

function alphanumericLength(text: string): number {
  return (text.match(/[A-Za-z0-9\u0900-\u097F]/g) ?? []).length;
}

/**
 * Fraction of the source wording that survived into `parts`. Used both for
 * scoring and, in ./index.ts, to reject a lossy section split.
 */
export function wordingCoverage(parts: string[], sourceText: string): number {
  const source = alphanumericLength(sourceText);
  if (source === 0) return 1;
  const captured = parts.reduce((total, part) => total + alphanumericLength(part), 0);
  return captured / source;
}

function digits(text: string): string {
  return (text.match(/\d/g) ?? []).sort().join('');
}

function hasEntities(task: SmartTask): boolean {
  const { metadata } = task;
  return Boolean(
    metadata.chapters?.length ||
      metadata.pages?.length ||
      metadata.exercises?.length ||
      metadata.questions?.length ||
      metadata.assignments?.length ||
      metadata.worksheet ||
      metadata.notebook ||
      metadata.attachment ||
      metadata.exam
  );
}

/** Every digit of the clause must survive into the rendered task. */
function digitsPreserved(task: SmartTask): boolean {
  return digits(task.raw) === digits(`${task.actionLabel ?? ''} ${task.target}`);
}

/**
 * How much of the source text ended up inside tasks. Markers and punctuation are
 * expected to disappear; whole sentences are not.
 */
function coverage(tasks: SmartTask[], sourceText: string): number {
  return wordingCoverage(
    tasks.map((task) => task.raw),
    sourceText
  );
}

/** Document-level confidence, 0-100. */
export function scoreSmartHomework({
  classwork,
  homework,
  hasExplicitMarkers,
  sourceText,
}: ConfidenceInput): number {
  const tasks = [...classwork, ...homework];
  if (tasks.length === 0) return 0;

  // Weight each task by its length so one long unparsed blob cannot be masked
  // by a handful of short, well understood clauses.
  const totalWeight = tasks.reduce((total, task) => total + Math.max(task.raw.length, 1), 0);
  const weighted = tasks.reduce(
    (total, task) => total + task.confidence * Math.max(task.raw.length, 1),
    0
  );

  let score = weighted / totalWeight;

  if (hasExplicitMarkers) score += 8;

  const understood = tasks.filter((task) => task.actionLabel || hasEntities(task)).length / tasks.length;
  score += (understood - 0.5) * 10;

  if (tasks.length === 1 && tasks[0].raw.length > 120) score -= 15;
  if (tasks.some((task) => !digitsPreserved(task))) score -= 30;
  if (coverage(tasks, sourceText) < 0.98) score -= 25;

  return Math.max(0, Math.min(100, Math.round(score)));
}
