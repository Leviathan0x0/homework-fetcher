import React from 'react';
import { cn } from '../utils/cn';

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Small pill rendered next to the title, e.g. a section or month label. */
  badge?: React.ReactNode;
  /** Buttons aligned to the end of the header row. */
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  badge,
  actions,
  className,
}) => {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 pb-5 border-b border-neutral-200/70 dark:border-neutral-800/70 sm:flex-row sm:items-start sm:justify-between sm:gap-6',
        className
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
            {title}
          </h1>
          {badge}
        </div>
        {description && (
          <p className="text-xs sm:text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400 mt-1.5 max-w-prose">
            {description}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex items-center gap-2 shrink-0 sm:pt-0.5">{actions}</div>
      )}
    </div>
  );
};
