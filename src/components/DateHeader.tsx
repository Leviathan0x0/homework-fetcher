import React from 'react';
import { formatRelativeDateHeader } from '../utils/dateUtils';

interface DateHeaderProps {
  dateStr: string;
  count: number;
}

export const DateHeader: React.FC<DateHeaderProps> = ({ dateStr, count }) => {
  const formattedTitle = formatRelativeDateHeader(dateStr);

  return (
    <div className="flex items-baseline justify-between gap-3 pb-2 border-b border-neutral-200/60 dark:border-neutral-800/60">
      <h3 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 truncate">
        {formattedTitle}
      </h3>
      <span className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500 shrink-0 tabular-nums">
        {count} {count === 1 ? 'assignment' : 'assignments'}
      </span>
    </div>
  );
};
