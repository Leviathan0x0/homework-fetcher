import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingSkeletonProps {
  count?: number;
  label?: string;
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({
  count = 3,
  label = 'Loading homework…',
}) => {
  return (
    <div className="space-y-3.5" role="status" aria-live="polite" aria-busy="true">
      <div className="flex items-center justify-center gap-2 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
        <Loader2 className="size-4 animate-spin text-neutral-400 dark:text-neutral-500" aria-hidden="true" />
        <span>{label}</span>
      </div>
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
