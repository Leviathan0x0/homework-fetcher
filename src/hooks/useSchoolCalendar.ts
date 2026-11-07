import { useCallback, useEffect, useRef, useState } from 'react';
import { SchoolCalendarEvent } from '../types/homework';
import { calendarService } from '../services/api';

/**
 * Loads EduSecure school calendar events (holidays) with optional force refresh.
 */
export function useSchoolCalendar() {
  // Seeded from the last load so the calendar paints immediately instead of
  // showing a spinner until the first request comes back.
  const [events, setEvents] = useState<SchoolCalendarEvent[]>(
    () => calendarService.getCachedEvents() as SchoolCalendarEvent[]
  );
  const [isLoading, setIsLoading] = useState(() => calendarService.getCachedEvents().length === 0);
  const [error, setError] = useState<string | null>(null);

  // Only the latest request may write state (stale response / unmounted guard).
  const requestIdRef = useRef(0);

  useEffect(
    () => () => {
      requestIdRef.current = -1;
    },
    []
  );

  const load = useCallback(async (force = false) => {
    const requestId = ++requestIdRef.current;
    const isCurrent = () => requestIdRef.current === requestId;
    setIsLoading(true);
    setError(null);
    try {
      const list = force ? await calendarService.refresh() : await calendarService.getEvents();
      if (isCurrent()) setEvents(list);
      return list;
    } catch (err: any) {
      if (isCurrent()) setError(err?.message || 'Could not load school holidays.');
      return [] as SchoolCalendarEvent[];
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const setSelected = useCallback(async (event: SchoolCalendarEvent, selected: boolean) => {
    setEvents((prev) =>
      prev.map((e) => (e.id === event.id ? { ...e, selected } : e))
    );
    try {
      await calendarService.setSelected(event.id, selected);
    } catch {
      setEvents((prev) =>
        prev.map((e) => (e.id === event.id ? { ...e, selected: !selected } : e))
      );
    }
  }, []);

  return { events, isLoading, error, reload: load, setSelected };
}
