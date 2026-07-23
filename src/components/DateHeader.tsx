import React from 'react';
import { formatRelativeDateHeader } from '../utils/dateUtils';

interface DateHeaderProps {
  dateStr: string;
  count: number;
}

export const DateHeader: React.FC<DateHeaderProps> = ({ dateStr, count }) => {
  const formattedTitle = formatRelativeDateHeader(dateStr);

  return (
    <div className="flex items-center justify-between py-2 mb-3 border-b border-neutral-200/60 dark:border-neutral-800/60">
      <h3 className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">
        {formattedTitle}
      </h3>
      <span className="text-xs font-medium text-neutral-400 dark:text-neutral-500">
        {count} {count === 1 ? 'assignment' : 'assignments'}
      </span>
    </div>
  );
};
