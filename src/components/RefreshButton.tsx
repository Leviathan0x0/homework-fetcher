import React, { useState } from 'react';
import { RefreshCWIcon } from '@/components/ui/refresh-cw';
import { cn } from '../utils/cn';

interface RefreshButtonProps {
  onRefresh: () => void;
  isRefreshing?: boolean;
  /** Hides the label below `sm`, keeping the icon only. */
  compact?: boolean;
  className?: string;
  /** Name announced to assistive technology, e.g. "calendar". */
  label?: string;
}

export const RefreshButton: React.FC<RefreshButtonProps> = ({
  onRefresh,
  isRefreshing = false,
  compact = false,
  className,
  label = 'homework',
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const replayAnimation = () => {
    setIsHovered(false);
    requestAnimationFrame(() => setIsHovered(true));
  };

  return (
    <button
      type="button"
      onClick={() => {
        replayAnimation();
        onRefresh();
      }}
      onPointerDown={replayAnimation}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      disabled={isRefreshing}
      title={`Refresh ${label}`}
      aria-label={`Refresh ${label}`}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#141417] text-xs font-medium text-neutral-700 dark:text-neutral-300',
        'transition-colors duration-150 hover:text-neutral-900 dark:hover:text-neutral-100 hover:border-neutral-300 dark:hover:border-neutral-700',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40 dark:focus-visible:ring-neutral-600/50 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent',
        'shadow-2xs cursor-pointer active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed',
        className
      )}
    >
      <RefreshCWIcon size={14} isAnimated={isHovered} className={cn('shrink-0', isRefreshing && 'animate-spin')} />
      <span className={cn(compact && 'sr-only sm:not-sr-only')}>
        {isRefreshing ? 'Refreshing' : 'Refresh'}
      </span>
    </button>
  );
};
