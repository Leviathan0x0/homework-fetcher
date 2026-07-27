import React from 'react';
import LiquidGlass from 'liquid-glass-react';
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

  const allList = ['All', ...subjects];

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-0.5 no-scrollbar scroll-smooth touch-pan-x -mx-4 px-4 sm:mx-0 sm:px-0">
      {allList.map((subjKey) => {
        const isSelected = selectedSubject === subjKey;
        const label = subjKey === 'All' ? 'All Subjects' : subjKey;

        if (isSelected) {
          return (
            <LiquidGlass
              key={subjKey}
              blurAmount={0.07}
              displacementScale={35}
              saturation={135}
              aberrationIntensity={1.2}
              elasticity={0.18}
              cornerRadius={999}
              padding="0px"
              className="inline-block cursor-pointer select-none shrink-0"
            >
              <button
                onClick={() => onSelectSubject(subjKey)}
                className="px-3.5 py-1.5 sm:px-3 sm:py-1 rounded-full text-xs font-semibold whitespace-nowrap text-neutral-900 dark:text-white transition-colors duration-150 cursor-pointer touch-manipulation active:scale-[0.98]"
              >
                {label}
              </button>
            </LiquidGlass>
          );
        }

        return (
          <button
            key={subjKey}
            onClick={() => onSelectSubject(subjKey)}
            className="px-3.5 py-1.5 sm:px-3 sm:py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors duration-150 cursor-pointer touch-manipulation active:scale-[0.98] border border-neutral-200/60 dark:border-neutral-800 bg-neutral-100/80 text-neutral-600 dark:bg-neutral-800/60 dark:text-neutral-400 hover:bg-neutral-200/80 dark:hover:bg-neutral-700/80 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            {label}
          </button>
        );
      })}
    </div>
  );
};
