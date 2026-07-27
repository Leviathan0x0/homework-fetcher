/**
 * Stage 5 — Formatter.
 *
 * Turns the semantic structure into a small render model the UI can map over.
 * The formatter owns presentation concerns only:
 *   - merging repeated actions ("Complete Page 42" + "Complete Ex 3.2")
 *   - choosing between an inline line and a grouped heading
 *   - sentence casing
 *
 * It never invents or removes content: every item still carries the original
 * clause in `raw`.
 */
import {
  FormattedGroup,
  FormattedHomework,
  FormattedItem,
  FormattedSection,
  SectionKind,
  SmartHomework,
  SmartTask,
} from './types';
import { subjectIcon } from './rules/subjects';

const SECTION_TITLES: Record<SectionKind, string> = {
  classwork: 'Classwork',
  homework: 'Homework',
};

function escapeRegex(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Entity labels that stay capitalised wherever they appear ("Chapter 8"). */
const ENTITY_LABELS = new Set([
  'chapter',
  'chapters',
  'lesson',
  'lessons',
  'unit',
  'units',
  'page',
  'pages',
  'exercise',
  'exercises',
  'question',
  'questions',
  'assignment',
  'assignments',
]);

/**
 * Lower-cases the first letter when the target is a common noun, so an inline
 * line reads "Bring notebook" while numbered entities stay as "Chapter 8".
 */
function inlineTarget(target: string, raw: string): string {
  if (!target) return '';

  const firstWord = target.split(/\s+/)[0];

  if (ENTITY_LABELS.has(firstWord.toLowerCase())) return target;
  // Acronyms such as "NCERT".
  if (/^[A-Z]{2,}$/.test(firstWord)) return target;
  // Proper nouns: the word was already capitalised in the original clause.
  if (new RegExp(`\\b${escapeRegex(firstWord)}\\b`).test(raw)) return target;

  return target.charAt(0).toLowerCase() + target.slice(1);
}

function toItem(task: SmartTask, text: string, checkable: boolean): FormattedItem {
  return { text, checkable, raw: task.raw };
}

/**
 * Drops items that render to exactly the same text. Identical repetitions carry
 * no extra information, and the first occurrence keeps its original clause.
 */
function dedupeItems(items: FormattedItem[]): FormattedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Groups tasks by action, preserving the order actions first appeared in. */
function buildGroups(tasks: SmartTask[], checkable: boolean): FormattedGroup[] {
  const order: string[] = [];
  const byLabel = new Map<string, SmartTask[]>();

  for (const task of tasks) {
    const key = task.actionLabel ?? '';
    if (!byLabel.has(key)) {
      byLabel.set(key, []);
      order.push(key);
    }
    byLabel.get(key)!.push(task);
  }

  return order.map((key) => {
    const groupTasks = byLabel.get(key)!;
    const label = key || null;

    // No recognised verb: show the clause as-is.
    if (!label) {
      return {
        label: null,
        layout: 'inline' as const,
        items: dedupeItems(groupTasks.map((task) => toItem(task, task.target || task.raw, checkable))),
      };
    }

    // A single task reads better inline: "Read Chapter 8".
    if (groupTasks.length === 1) {
      const task = groupTasks[0];
      const target = inlineTarget(task.target, task.raw);
      return {
        label,
        layout: 'inline' as const,
        items: [toItem(task, target ? `${label} ${target}` : label, checkable)],
      };
    }

    // Repeated action: merge under one heading.
    const items = dedupeItems(groupTasks.map((task) => toItem(task, task.target || label, checkable)));

    // Deduplication may leave a single target, which reads better inline again.
    if (items.length === 1) {
      const task = groupTasks[0];
      const target = inlineTarget(items[0].text, task.raw);
      return {
        label,
        layout: 'inline' as const,
        items: [{ ...items[0], text: target ? `${label} ${target}` : label }],
      };
    }

    return { label, layout: 'grouped' as const, items };
  });
}

/** Stage 5 entry point. */
export function formatSmartHomework(structure: SmartHomework): FormattedHomework {
  const sections: FormattedSection[] = [];

  if (structure.classwork.length > 0) {
    sections.push({
      kind: 'classwork',
      title: SECTION_TITLES.classwork,
      groups: buildGroups(structure.classwork, false),
    });
  }

  if (structure.homework.length > 0) {
    sections.push({
      kind: 'homework',
      title: SECTION_TITLES.homework,
      groups: buildGroups(structure.homework, true),
    });
  }

  return {
    subject: structure.subject,
    icon: subjectIcon(structure.subject),
    sections,
    confidence: structure.confidence,
  };
}

/**
 * Plain-text rendering of the same model. Handy for copy-to-clipboard, debugging
 * and for asserting the pipeline output in tests.
 */
export function renderSmartHomeworkText(formatted: FormattedHomework): string {
  const lines: string[] = [`${formatted.icon} ${formatted.subject}`];

  for (const section of formatted.sections) {
    lines.push('', section.title);

    for (const group of section.groups) {
      if (group.layout === 'grouped' && group.label) {
        lines.push(group.label);
        for (const item of group.items) {
          lines.push(`  ${item.checkable ? '☐' : '•'} ${item.text}`);
        }
        continue;
      }

      for (const item of group.items) {
        lines.push(`${item.checkable ? '☐' : '•'} ${item.text}`);
      }
    }
  }

  return lines.join('\n');
}
