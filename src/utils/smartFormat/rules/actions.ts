/**
 * Rule module — action verbs.
 *
 * Each rule maps a family of synonyms onto one canonical action. Adding a new
 * action is a matter of appending a rule here: the tokenizer, rule engine and
 * formatter all read from this list, so nothing else has to change.
 *
 * Order matters: multi-word and more specific synonyms must come first so that
 * "learn by heart" wins over "learn".
 */
import { ActionKind } from '../types';

export interface ActionRule {
  kind: ActionKind;
  /** Heading used by the formatter when items are grouped. */
  label: string;
  /** Regex-safe synonyms, most specific first. */
  synonyms: string[];
}

export const ACTION_RULES: ActionRule[] = [
  {
    kind: 'memorize',
    label: 'Memorize',
    synonyms: ['learn by heart', 'by heart', 'byheart', 'memorize', 'memorise', 'memorized', 'cram'],
  },
  {
    kind: 'revise',
    label: 'Revise',
    synonyms: ['revise', 'revision', 'revised', 'practice', 'practise', 'rehearse'],
  },
  {
    kind: 'prepare',
    label: 'Prepare',
    synonyms: ['prepare for', 'preparation of', 'preparation', 'prepare', 'get ready for'],
  },
  {
    kind: 'read',
    label: 'Read',
    synonyms: ['read out', 'reading', 'read'],
  },
  {
    kind: 'learn',
    label: 'Learn',
    synonyms: ['learning', 'learn', 'study'],
  },
  {
    kind: 'complete',
    label: 'Complete',
    synonyms: [
      'complete',
      'completed',
      'completing',
      'finish',
      'finished',
      'attempt',
      'fill in',
      'fill up',
      'fill',
      'do',
    ],
  },
  {
    kind: 'write',
    label: 'Write',
    synonyms: ['write down', 'note down', 'writing', 'write', 'answer', 'answers'],
  },
  {
    kind: 'bring',
    label: 'Bring',
    synonyms: ['bring along', 'bring', 'carry'],
  },
  {
    kind: 'draw',
    label: 'Draw',
    synonyms: ['draw', 'drawing', 'sketch', 'trace', 'label'],
  },
  {
    kind: 'colour',
    label: 'Colour',
    synonyms: ['colour', 'color', 'colouring', 'coloring', 'paint', 'shade'],
  },
  {
    kind: 'paste',
    label: 'Paste',
    synonyms: ['paste', 'stick', 'glue'],
  },
  {
    kind: 'solve',
    label: 'Solve',
    synonyms: ['solve', 'solving', 'work out', 'calculate'],
  },
];

/** Escapes a synonym so it can be embedded in a regex. */
function escape(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
}

/** `read out|reading|read` style alternation for one rule. */
export function buildActionAlternation(rule: ActionRule): string {
  return rule.synonyms.map(escape).join('|');
}

/** Alternation covering every known action verb, used by the segmenter. */
export const ALL_ACTIONS_ALTERNATION = ACTION_RULES.map(buildActionAlternation).join('|');

/** Words that carry no meaning at the start of a target. */
export const LEADING_FILLER_WORDS = [
  'the',
  'a',
  'an',
  'your',
  'you',
  'all',
  'also',
  'and',
  'then',
  'please',
  'kindly',
  'must',
  'should',
  'have to',
  'has to',
  'to',
  'of',
];
