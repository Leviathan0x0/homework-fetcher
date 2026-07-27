/**
 * Rule module — entity patterns.
 *
 * Every pattern is a small, self-contained matcher instead of one giant regex.
 * Patterns are tried in array order and the first match wins any overlap, so
 * more specific patterns (exercise "Ex 3.2") are listed before looser ones
 * (page "P 3").
 *
 * To teach the parser a new entity: add an entry here and, if it should end up
 * in the semantic structure, map it in ../ruleEngine.ts.
 */
import { TokenType } from '../types';

export interface EntityPattern {
  type: TokenType;
  /** Must be global so the tokenizer can scan the whole clause. */
  regex: RegExp;
  /** Turns a raw match into its expanded, human readable form. */
  build: (match: RegExpMatchArray) => { normalized: string; meta?: Record<string, string> };
}

/** "8 and 9", "2 to 5", "10,11" -> "8, 9", "2-5", "10, 11". */
function cleanNumberList(raw: string): string {
  return raw
    .replace(/\s*(?:-|–|through|to)\s*/gi, '-')
    .replace(/\s*(?:,|&|and)\s*/gi, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A list or range refers to more than one item, so the label is pluralised. */
function isMultiple(list: string): boolean {
  return /[,\-]/.test(list);
}

function label(singular: string, list: string): string {
  return isMultiple(list) ? `${singular}s` : singular;
}

/** Collapses internal whitespace without touching casing. */
function collapse(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

const MONTHS =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

const WEEKDAYS = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun';

export const ENTITY_PATTERNS: EntityPattern[] = [
  {
    // Exam keywords: "unit test", "periodic test", "dictation", ...
    type: 'exam',
    regex:
      /\b(?:unit\s*test|periodic\s*test|class\s*test|weekly\s*test|pre[-\s]?board|half\s*yearly|annual\s*exam(?:ination)?|final\s*exam(?:ination)?|exam(?:ination)?s?|tests?|assessments?|dictation|viva|quiz)\b/gi,
    build: (match) => ({ normalized: collapse(match[0]).toLowerCase() }),
  },
  {
    // Chapter / lesson / unit numbers: "Ch-8", "chapter 8 & 9", "Lesson 3".
    type: 'chapter',
    regex:
      /\b(chapters?|chap|ch|lessons?|units?)\s*\.?\s*(?:no\.?\s*)?-?\s*(\d+[A-Za-z]?(?:\s*(?:,|&|and|to|through|-|–)\s*\d+[A-Za-z]?)*)/gi,
    build: (match) => {
      const list = cleanNumberList(match[2]);
      const keyword = match[1].toLowerCase();
      const singular = keyword.startsWith('lesson') ? 'Lesson' : keyword.startsWith('unit') ? 'Unit' : 'Chapter';
      return { normalized: `${label(singular, list)} ${list}`, meta: { numbers: list } };
    },
  },
  {
    // Exercises, including decimal numbering: "Ex 3.2", "exercise 4".
    type: 'exercise',
    regex:
      /\b(?:exercises?|ex)\s*\.?\s*(?:no\.?\s*)?-?\s*(\d+(?:\.\d+)*[A-Za-z]?(?:\s*(?:,|&|and|to|through|-|–)\s*\d+(?:\.\d+)*[A-Za-z]?)*)/gi,
    build: (match) => {
      const list = cleanNumberList(match[1]);
      return { normalized: `${label('Exercise', list)} ${list}`, meta: { numbers: list } };
    },
  },
  {
    // Question ranges written with a repeated marker: "Q1 to Q5", "Q3 & Q4".
    type: 'question',
    regex: /\b(?:questions?|ques|qs|q)\s*\.?\s*(\d+)\s*(?:to|through|-|–|&|and)\s*(?:questions?|ques|qs|q)\s*\.?\s*(\d+)/gi,
    build: (match) => ({
      normalized: `Questions ${match[1]}-${match[2]}`,
      meta: { numbers: `${match[1]}-${match[2]}` },
    }),
  },
  {
    // Question numbers and ranges: "Q 1-5", "ques 3, 4", "Q/Ans 1 to 4".
    type: 'question',
    regex:
      /\bq\s*\/\s*a(?:ns(?:wers?)?)?(?:\s*\.?\s*(?:no\.?\s*)?-?\s*(\d+(?:\s*(?:,|&|and|to|through|-|–)\s*\d+)*))?/gi,
    build: (match) => {
      if (!match[1]) return { normalized: 'question answers' };
      const list = cleanNumberList(match[1]);
      return { normalized: `${label('Question', list)} ${list}`, meta: { numbers: list } };
    },
  },
  {
    type: 'question',
    regex:
      /\b(?:questions?|ques|qs|q)\s*\.?\s*(?:no\.?\s*)?-?\s*(\d+(?:\s*(?:,|&|and|to|through|-|–)\s*\d+)*)/gi,
    build: (match) => {
      const list = cleanNumberList(match[1]);
      return { normalized: `${label('Question', list)} ${list}`, meta: { numbers: list } };
    },
  },
  {
    // Page numbers: "Pg-42", "page no. 12", "pages 5 to 7".
    type: 'page',
    regex:
      /\b(?:pages?|pgs?|p)\s*\.?\s*(?:no\.?\s*)?-?\s*(\d+(?:\s*(?:,|&|and|to|through|-|–)\s*\d+)*)/gi,
    build: (match) => {
      const list = cleanNumberList(match[1]);
      return { normalized: `${label('Page', list)} ${list}`, meta: { numbers: list } };
    },
  },
  {
    // Assignment numbers: "Assignment 8", "assignment".
    type: 'assignment',
    regex: /\b(?:assignments?|asgmt)(?:\s*\.?\s*-?\s*(\d+))?/gi,
    build: (match) => ({
      normalized: match[1] ? `Assignment ${match[1]}` : 'assignment',
      ...(match[1] ? { meta: { numbers: match[1] } } : {}),
    }),
  },
  {
    // Worksheet references: "worksheet 3", "W.S.".
    type: 'worksheet',
    regex: /\b(?:work\s*sheets?|w\s*\.\s*s\s*\.?)(?:\s*-?\s*(\d+))?/gi,
    build: (match) => ({
      normalized: match[1] ? `worksheet ${match[1]}` : 'worksheet',
      ...(match[1] ? { meta: { numbers: match[1] } } : {}),
    }),
  },
  {
    // Notebook references: "fair notebook", "note book", "register".
    type: 'notebook',
    regex: /\b(?:fair\s*note\s*books?|rough\s*note\s*books?|note\s*books?|registers?)\b/gi,
    build: (match) => ({ normalized: collapse(match[0]).toLowerCase().replace(/note\s*book/g, 'notebook') }),
  },
  {
    // Attachment mentions: "see attachment", "refer to the pdf".
    type: 'attachment',
    regex:
      /\b(?:see\s*(?:the\s*)?attachments?|refer\s*(?:to\s*)?(?:the\s*)?(?:attachments?|attached|file|pdf)|attachments?|attached\s*(?:file|pdf|image|sheet)?|pdf)\b/gi,
    build: (match) => ({ normalized: collapse(match[0]) }),
  },
  {
    // Numeric dates: "12/08", "5-9-2025".
    type: 'date',
    regex: /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/g,
    build: (match) => ({ normalized: collapse(match[0]), meta: { kind: 'numeric' } }),
  },
  {
    // Dates with a month name: "5th Aug", "August 5, 2025".
    type: 'date',
    regex: new RegExp(
      `\\b(?:(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s*(?:of\\s*)?(?:${MONTHS})|(?:${MONTHS})\\s*\\.?\\s*(\\d{1,2})(?:\\s*(?:st|nd|rd|th))?)(?:\\s*,?\\s*(\\d{4}))?\\b`,
      'gi'
    ),
    build: (match) => ({ normalized: collapse(match[0]), meta: { kind: 'calendar' } }),
  },
  {
    // Relative dates and weekdays: "tomorrow", "next Monday".
    type: 'date',
    regex: new RegExp(`\\b(?:day\\s*after\\s*tomorrow|tomorrow|today|tonight|next\\s*week|(?:next\\s*)?(?:${WEEKDAYS}))\\b`, 'gi'),
    build: (match) => ({ normalized: collapse(match[0]), meta: { kind: 'relative' } }),
  },
];
