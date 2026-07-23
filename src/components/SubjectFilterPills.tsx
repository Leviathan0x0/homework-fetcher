import React from 'react';
import { cn } from '../utils/cn';

interface SubjectFilterPillsProps {
  subjects: string[];
  selectedSubject: string;
  onSelectSubject: (subject: string) => void;
}

export const SubjectFilterPills: React.FC<SubjectFilterPillsProps> = ({
  subjects,
  selectedSubject,
  onSelectSubject,
}) => {
  if (subjects.length <= 1) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1.5 no-scrollbar scroll-smooth touch-pan-x -mx-4 px-4 sm:mx-0 sm:px-0">
      <button
        onClick={() => onSelectSubject('All')}
        className={cn(
          'px-3.5 py-1.5 sm:px-3 sm:py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors duration-150 cursor-pointer touch-manipulation active:scale-[0.98] border',
          selectedSubject === 'All'
            ? 'bg-neutral-900 text-white border-neutral-900 dark:bg-white dark:text-neutral-900 dark:border-white shadow-2xs font-bold'
            : 'bg-neutral-100/80 text-neutral-600 border-neutral-200/60 dark:bg-neutral-800/60 dark:text-neutral-400 dark:border-neutral-800 hover:bg-neutral-200/80 dark:hover:bg-neutral-700/80 hover:text-neutral-900 dark:hover:text-neutral-100'
        )}
      >
        All Subjects
      </button>

      {subjects.map((subject) => (
        <button
          key={subject}
          onClick={() => onSelectSubject(subject)}
          className={cn(
            'px-3.5 py-1.5 sm:px-3 sm:py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors duration-150 cursor-pointer touch-manipulation active:scale-[0.98] border',
            selectedSubject === subject
              ? 'bg-neutral-900 text-white border-neutral-900 dark:bg-white dark:text-neutral-900 dark:border-white shadow-2xs font-bold'
              : 'bg-neutral-100/80 text-neutral-600 border-neutral-200/60 dark:bg-neutral-800/60 dark:text-neutral-400 dark:border-neutral-800 hover:bg-neutral-200/80 dark:hover:bg-neutral-700/80 hover:text-neutral-900 dark:hover:text-neutral-100'
          )}
        >
          {subject}
        </button>
      ))}
    </div>
  );
};
