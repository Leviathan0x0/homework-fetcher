import React from 'react';
import { FormattedHomework } from '../utils/smartFormat';
import { cn } from '../utils/cn';

/**
 * UI stage of the Smart Homework Formatter pipeline.
 *
 * Purely presentational: it maps over the render model produced by
 * src/utils/smartFormat/formatter.ts and never parses text itself. Every item
 * keeps its original clause in `raw`, exposed through the `title` attribute so
 * the source wording is always one hover away.
 */
interface SmartHomeworkContentProps {
  formatted: FormattedHomework;
  isCompleted?: boolean;
}

const SECTION_TAGS: Record<string, string> = {
  classwork: 'CW',
  homework: 'HW',
};

export const SmartHomeworkContent: React.FC<SmartHomeworkContentProps> = ({ formatted, isCompleted = false }) => {
  if (formatted.sections.length === 0) return null;

  return (
    <div
      className={cn(
        'space-y-3.5 text-sm leading-relaxed text-neutral-800 dark:text-neutral-200 font-normal transition-all',
        isCompleted && 'line-through text-neutral-400 dark:text-neutral-500'
      )}
    >
      {formatted.sections.map((section) => (
        <div key={section.kind} className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wider text-neutral-600 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 shrink-0 select-none">
              {SECTION_TAGS[section.kind] ?? section.title}
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              {section.title}
            </span>
          </div>

          <div className="space-y-1.5 pl-1">
            {section.groups.map((group, groupIndex) => (
              <div key={`${group.label ?? 'plain'}-${groupIndex}`} className="space-y-1">
                {/* Repeated actions are merged under one heading. */}
                {group.layout === 'grouped' && group.label && (
                  <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">{group.label}</p>
                )}

                <ul className={cn('space-y-1', group.layout === 'grouped' && 'pl-3')}>
                  {group.items.map((item, itemIndex) => (
                    <li
                      key={`${item.text}-${itemIndex}`}
                      title={item.raw}
                      className="flex items-start gap-2 text-xs sm:text-sm"
                    >
                      {item.checkable ? (
                        <span
                          aria-hidden="true"
                          className="mt-1 w-3 h-3 rounded-[4px] border border-neutral-300 dark:border-neutral-600 shrink-0"
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="mt-1.5 w-1.5 h-1.5 rounded-full bg-neutral-400 dark:bg-neutral-500 shrink-0"
                        />
                      )}
                      <span className="break-words flex-1 leading-relaxed">{item.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
