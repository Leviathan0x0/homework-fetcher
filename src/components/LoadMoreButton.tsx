import React, { useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

interface LoadMoreButtonProps {
  hasMore: boolean;
  onLoadMore: () => void;
  visibleCount: number;
  totalCount: number;
}

export const LoadMoreButton: React.FC<LoadMoreButtonProps> = ({
  hasMore,
  onLoadMore,
  visibleCount,
  totalCount,
}) => {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasMore || !sentinelRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onLoadMore();
        }
      },
      { rootMargin: '300px' } // Preload 300px before reaching the end
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore]);

  if (totalCount === 0) return null;

  return (
    <div className="pt-6 pb-4 flex flex-col items-center justify-center space-y-3">
      {/* Invisible sentinel element for scroll observer */}
      <div ref={sentinelRef} className="h-1 w-full" />

      <p className="text-xs text-neutral-400 dark:text-neutral-500 font-medium">
        Showing <span className="font-semibold text-neutral-700 dark:text-neutral-300">{Math.min(visibleCount, totalCount)}</span> of{' '}
        <span className="font-semibold text-neutral-700 dark:text-neutral-300">{totalCount}</span> entries
      </p>

      {hasMore && (
        <button
          onClick={onLoadMore}
          className="group inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-semibold bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-all duration-200 cursor-pointer active:scale-95 border border-neutral-200/60 dark:border-neutral-700/60 shadow-2xs"
        >
          <span>Load More Cards</span>
          <ChevronDown className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-y-0.5" />
        </button>
      )}
    </div>
  );
};
