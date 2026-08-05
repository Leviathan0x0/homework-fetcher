import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../utils/cn';

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
    <Loader2 className="size-5 animate-spin text-neutral-400 dark:text-neutral-500" aria-hidden="true" />
    <p className="text-xs font-medium">{label}</p>
  </div>
);
