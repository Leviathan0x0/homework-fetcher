import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

export function usePagination<T>(items: T[], pageSize = 25) {
  const [visibleCount, setVisibleCount] = useState(pageSize);
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

  const total = items.length;

  // Rendering another page is cheap, so reveal it immediately (no artificial delay).
  const loadMore = useCallback(() => {
    setVisibleCount((prev) => (prev >= total ? prev : Math.min(prev + pageSize, total)));
  }, [pageSize, total]);

  const resetPagination = useCallback(() => {
    setVisibleCount(pageSize);
  }, [pageSize]);

  const displayedItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  const hasMore = visibleCount < total;

  return {
    displayedItems,
    visibleCount,
    totalCount: total,
    hasMore,
    isLoadingMore: false,
    loadMore,
    resetPagination,
  };
}
