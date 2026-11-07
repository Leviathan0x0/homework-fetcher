import { useCallback, useEffect, useRef, useState } from 'react';
import { schoolNoticeService } from '../services/api';
import { SchoolNotice, SchoolNoticeKind } from '../types/homework';

/** Loads one of the two authenticated EduSecure school-update feeds. */
export function useSchoolNotices(kind: SchoolNoticeKind) {
  // Seeded from the last load so the screen paints immediately instead of
  // showing a spinner until the first request comes back.
  const [notices, setNotices] = useState<SchoolNotice[]>(
    () => schoolNoticeService.getCachedNotices(kind).notices as SchoolNotice[]
  );
  const [recentCount, setRecentCount] = useState(
    () => schoolNoticeService.getCachedNotices(kind).recentCount
  );
  const [isLoading, setIsLoading] = useState(
    () => schoolNoticeService.getCachedNotices(kind).notices.length === 0
  );
  const [error, setError] = useState<string | null>(null);
  // Only the latest request may write state (stale feed / unmounted guard).
  const requestIdRef = useRef(0);

  useEffect(
    () => () => {
      requestIdRef.current = -1;
    },
    []
  );

  const load = useCallback(
    async (forceRefresh = false) => {
      const requestId = ++requestIdRef.current;
      const isCurrent = () => requestIdRef.current === requestId;
      setIsLoading(true);
      setError(null);
      try {
        const next = await schoolNoticeService.getNotices(kind, forceRefresh);
        if (isCurrent()) {
          setNotices(next.notices);
          setRecentCount(next.recentCount);
        }
        return next.notices;
      } catch (err: any) {
        if (isCurrent()) setError(err?.message || 'Could not load school updates.');
        return [] as SchoolNotice[];
      } finally {
        if (isCurrent()) setIsLoading(false);
      }
    },
    [kind]
  );

  useEffect(() => {
    const previous = schoolNoticeService.getCachedNotices(kind);
    setNotices(previous.notices as SchoolNotice[]);
    setRecentCount(previous.recentCount);
    void load(false);
  }, [kind, load]);

  return { notices, recentCount, isLoading, error, reload: load };
}
