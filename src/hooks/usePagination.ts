import { useState, useEffect, useCallback, useRef } from 'react';

export function usePagination<T>(items: T[], pageSize = 25) {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const prevItemsRef = useRef<T[]>(items);

  // Reset pagination ONLY when dataset content changes (length or items change),
  // preventing inline filter re-renders from constantly resetting visibleCount.
  useEffect(() => {
    const prev = prevItemsRef.current;
    prevItemsRef.current = items;

    const hasChanged =
      prev.length !== items.length ||
      prev[0] !== items[0] ||
      prev[prev.length - 1] !== items[items.length - 1];

    if (hasChanged) {
      setVisibleCount(pageSize);
    }
  }, [items, pageSize]);

  const loadMore = useCallback(() => {
    if (visibleCount >= items.length || isLoadingMore) return;
    setIsLoadingMore(true);

    setTimeout(() => {
      setVisibleCount((prev) => Math.min(prev + pageSize, items.length));
      setIsLoadingMore(false);
    }, 200);
  }, [visibleCount, items.length, pageSize, isLoadingMore]);

  const resetPagination = useCallback(() => {
    setVisibleCount(pageSize);
  }, [pageSize]);

  const displayedItems = items.slice(0, visibleCount);
  const hasMore = visibleCount < items.length;

  return {
    displayedItems,
    visibleCount,
    totalCount: items.length,
    hasMore,
    isLoadingMore,
    loadMore,
    resetPagination,
  };
}
