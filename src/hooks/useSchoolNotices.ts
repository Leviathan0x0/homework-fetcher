import { useCallback, useEffect, useState } from 'react';
import { schoolNoticeService } from '../services/api';
import { SchoolNotice, SchoolNoticeKind } from '../types/homework';

/** Loads one of the two authenticated EduSecure school-update feeds. */
export function useSchoolNotices(kind: SchoolNoticeKind) {
  const [notices, setNotices] = useState<SchoolNotice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (forceRefresh = false) => {
      setIsLoading(true);
      setError(null);
      try {
        const next = await schoolNoticeService.getNotices(kind, forceRefresh);
        setNotices(next);
        return next;
      } catch (err: any) {
        setError(err?.message || 'Could not load school updates.');
        return [] as SchoolNotice[];
      } finally {
        setIsLoading(false);
      }
    },
    [kind]
  );

  useEffect(() => {
    setNotices([]);
    load(false);
  }, [load]);

  return { notices, isLoading, error, reload: load };
}
