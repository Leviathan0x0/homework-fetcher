import { useCallback, useEffect, useState } from 'react';
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

  const load = useCallback(async (force = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const list = force ? await calendarService.refresh() : await calendarService.getEvents();
      setEvents(list);
      return list;
    } catch (err: any) {
      setError(err?.message || 'Could not load school holidays.');
      return [] as SchoolCalendarEvent[];
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
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
