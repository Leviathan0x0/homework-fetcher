import React from 'react';

export const LoadingSkeleton: React.FC = () => {
  return (
    <div className="space-y-4 my-4">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="bg-white dark:bg-[#18181b] border border-neutral-200/80 dark:border-neutral-800/80 rounded-xl p-5 space-y-3 animate-pulse"
        >
          <div className="flex items-center justify-between">
            <div className="h-5 w-24 bg-neutral-200 dark:bg-neutral-800 rounded-full" />
            <div className="h-4 w-20 bg-neutral-100 dark:bg-neutral-800 rounded" />
          </div>
          <div className="space-y-2 pt-1">
            <div className="h-4 w-full bg-neutral-200 dark:bg-neutral-800 rounded" />
            <div className="h-4 w-5/6 bg-neutral-100 dark:bg-neutral-800 rounded" />
            <div className="h-4 w-2/3 bg-neutral-100 dark:bg-neutral-800 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
};
