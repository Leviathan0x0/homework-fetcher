import React from 'react';

interface LoadingSkeletonProps {
  count?: number;
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({ count = 3 }) => {
  return (
    <div className="space-y-3.5" role="status" aria-busy="true" aria-label="Loading homework">
      {Array.from({ length: Math.max(1, count) }).map((_, i) => (
        <div
          key={i}
          className="bg-white dark:bg-[#141417] border border-neutral-200/80 dark:border-neutral-800/80 rounded-3xl p-5 sm:p-6 space-y-4 animate-pulse"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="h-5 w-28 bg-neutral-200/80 dark:bg-neutral-800 rounded-full" />
            <div className="h-3.5 w-20 bg-neutral-100 dark:bg-neutral-800/70 rounded-full" />
          </div>
          <div className="space-y-2.5">
            <div className="h-3.5 w-full bg-neutral-200/70 dark:bg-neutral-800 rounded-full" />
            <div className="h-3.5 w-5/6 bg-neutral-100 dark:bg-neutral-800/70 rounded-full" />
            <div className="h-3.5 w-2/3 bg-neutral-100 dark:bg-neutral-800/70 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
};
