import React, { useEffect, useRef } from 'react';
import { Reicon } from './ui/reicon';

interface LoadMoreButtonProps {
  hasMore: boolean;
  onLoadMore: () => void;
  visibleCount: number;
  totalCount: number;
  isLoadingMore?: boolean;
}

export const LoadMoreButton: React.FC<LoadMoreButtonProps> = ({
  hasMore,
  onLoadMore,
  visibleCount,
  totalCount,
  isLoadingMore = false,
}) => {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasMore || isLoadingMore || !sentinelRef.current) return;

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
  }, [hasMore, isLoadingMore, onLoadMore]);

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
          disabled={isLoadingMore}
          className="group inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-semibold bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-all duration-200 cursor-pointer active:scale-95 border border-neutral-200/60 dark:border-neutral-700/60 shadow-2xs disabled:opacity-75 disabled:cursor-not-allowed"
        >
          {isLoadingMore ? (
            <>
              <Reicon name="loader" size={14} isLoading className="animate-spin text-neutral-500 dark:text-neutral-400" />
              <span>Loading more cards…</span>
            </>
          ) : (
            <>
              <span>Load More Cards</span>
              <Reicon name="chevron-down" size={14} className="transition-transform duration-200" />
            </>
          )}
        </button>
      )}
    </div>
  );
};
