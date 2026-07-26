import { useState, useEffect, useCallback } from 'react';

export function usePagination<T>(items: T[], pageSize = 25) {
  const [visibleCount, setVisibleCount] = useState(pageSize);

  // Reset to initial pageSize whenever items list changes
  useEffect(() => {
    setVisibleCount(pageSize);
  }, [items, pageSize]);

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + pageSize, items.length));
  }, [items.length, pageSize]);

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
    loadMore,
    resetPagination,
  };
}
