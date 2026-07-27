import React from 'react';
import { RefreshCw } from 'lucide-react';
import LiquidGlass from 'liquid-glass-react';
import { cn } from '../utils/cn';

interface RefreshButtonProps {
  onRefresh: () => void;
  isRefreshing?: boolean;
  /** Hides the label below `sm`, keeping the icon only. */
  compact?: boolean;
  className?: string;
}

export const RefreshButton: React.FC<RefreshButtonProps> = ({
  onRefresh,
  isRefreshing = false,
  compact = false,
  className,
}) => {
  return (
    <LiquidGlass
      blurAmount={0.08}
      displacementScale={40}
      saturation={130}
      aberrationIntensity={1.5}
      elasticity={0.2}
      cornerRadius={14}
      padding="0px"
      className={cn('inline-block cursor-pointer select-none', className)}
    >
      <button
        type="button"
        onClick={onRefresh}
        disabled={isRefreshing}
        title="Refresh homework"
        aria-label="Refresh homework"
        className={cn(
          'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-xl text-xs font-medium text-neutral-800 dark:text-neutral-200',
          'transition-colors duration-150 hover:text-neutral-900 dark:hover:text-neutral-100',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40 dark:focus-visible:ring-neutral-600/50',
          'cursor-pointer active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed'
        )}
      >
        <RefreshCw className={cn('w-3.5 h-3.5 shrink-0', isRefreshing && 'animate-spin')} />
        <span className={cn(compact && 'sr-only sm:not-sr-only')}>
          {isRefreshing ? 'Refreshing' : 'Refresh'}
        </span>
      </button>
    </LiquidGlass>
  );
};
