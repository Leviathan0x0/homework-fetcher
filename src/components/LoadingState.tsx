import React from 'react';
import { cn } from '../utils/cn';
import { WanderingEyes } from "@/components/loading-ui/wandering-eyes";

interface LoadingStateProps {
  label: string;
  className?: string;
}

/** A visible, centered status for requests whose result is not known yet. */
export const LoadingState: React.FC<LoadingStateProps> = ({ label, className }) => (
  <div
    className={cn(
      'flex min-h-40 flex-col items-center justify-center gap-2.5 rounded-2xl text-center text-neutral-500 dark:text-neutral-400',
      className
    )}
    role="status"
    aria-live="polite"
    aria-busy="true"
  >
    <WanderingEyes className="h-10 text-neutral-400 dark:text-neutral-500" />
    <p className="text-xs font-medium">{label}</p>
  </div>
);
