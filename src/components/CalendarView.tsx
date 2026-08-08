import React, { useState, useMemo, useCallback, useRef, memo, startTransition } from 'react';
import { HomeworkEntry } from '../types/homework';
import { HomeworkCard } from './HomeworkCard';
import { HolidayCard } from './HolidayCard';
import { EmptyState } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';
import { PageHeader } from './PageHeader';
import { RefreshButton } from './RefreshButton';
import { useSchoolCalendar } from '../hooks/useSchoolCalendar';
import {
  getHomeworkDateYmd,
  getCalendarDaysForMonth,
  formatYmd,
} from '../utils/dateUtils';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '../utils/cn';

interface CalendarViewProps {
  homework: HomeworkEntry[];
  isLoading: boolean;
  isRefreshing?: boolean;
  onRefresh: (forceRefresh: boolean) => void;
  completedMap: Record<string, boolean>;
  onToggleCompleted: (id: string) => void;
  onUpdateNote: (id: string, note: string | null) => void;
  onOpenPreview: (url: string) => void;
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

interface DayMeta {
  hwCount: number;
  allDone: boolean;
  holidayCount: number;
}

interface DayCellProps {
  ymd: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  meta: DayMeta | undefined;
  onSelect: (ymd: string) => void;
}

const DayCell = memo(function DayCell({
  ymd,
  dayNumber,
  isCurrentMonth,
  isToday,
  isSelected,
  meta,
  onSelect,
}: DayCellProps) {
  const hwCount = meta?.hwCount ?? 0;
  const hasHoliday = (meta?.holidayCount ?? 0) > 0;
  const allDone = meta?.allDone ?? false;

  return (
    <button
      type="button"
      onClick={() => onSelect(ymd)}
      aria-label={`${dayNumber}${hasHoliday ? ', holiday' : ''}${hwCount ? `, ${hwCount} homework` : ''}`}
      aria-pressed={isSelected}
      className={cn(
        'group relative flex h-12 flex-col items-center justify-center rounded-[1.35rem] text-[13px] tabular-nums select-none touch-manipulation sm:h-14',
        'transition-[transform,background-color,box-shadow] duration-200 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50',
        !isCurrentMonth && 'text-neutral-300/60 dark:text-neutral-700/70',
        isCurrentMonth && !isSelected && !hasHoliday && 'text-neutral-700 hover:bg-black/[0.035] dark:text-neutral-300 dark:hover:bg-white/[0.055]',
        isCurrentMonth && !isSelected && hasHoliday && 'text-rose-600 hover:bg-rose-500/[0.08] dark:text-rose-300 dark:hover:bg-rose-400/[0.08]',
        isToday && !isSelected && 'font-semibold',
        isToday && !isSelected && 'ring-1 ring-inset ring-sky-400/55 dark:ring-sky-300/45',
        isSelected && 'bg-[#ff2d55] text-white font-semibold shadow-[0_10px_24px_-12px_rgba(255,45,85,0.95)]',
        !isSelected && 'cursor-pointer active:scale-[0.94]'
      )}
    >
      <span
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full leading-none transition-transform duration-200 group-hover:scale-105',
          isToday && !isSelected && 'bg-sky-400/10 dark:bg-sky-300/10'
        )}
      >
        {dayNumber}
      </span>
      {(hwCount > 0 || hasHoliday) && (
        <span className="absolute bottom-1.5 flex items-center gap-1">
          {hasHoliday && (
            <span
              className={cn(
                'size-1.5 rounded-full',
                isSelected ? 'bg-white' : 'bg-rose-500'
              )}
            />
          )}
          {hwCount > 0 && (
            <span
              className={cn(
                'size-1 rounded-full',
                isSelected
                  ? allDone
                    ? 'bg-emerald-200'
                    : 'bg-white/75'
                  : allDone
                    ? 'bg-emerald-500'
                    : 'bg-neutral-400 dark:bg-neutral-500'
              )}
            />
          )}
        </span>
      )}
    </button>
  );
});

export const CalendarView: React.FC<CalendarViewProps> = ({
  homework,
  isLoading,
  isRefreshing,
  onRefresh,
  completedMap,
  onToggleCompleted,
  onUpdateNote,
  onOpenPreview,
}) => {
  const todayYmd = useMemo(() => formatYmd(new Date()), []);
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedYmd, setSelectedYmd] = useState(todayYmd);
  const detailRef = useRef<HTMLDivElement>(null);
  const { events, isLoading: eventsLoading, error: eventsError, reload, setSelected } =
    useSchoolCalendar();

  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();
  const monthPrefix = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

  const homeworkByDate = useMemo(() => {
    const map: Record<string, HomeworkEntry[]> = {};
    const list = Array.isArray(homework) ? homework : [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (!item) continue;
      const ymd = getHomeworkDateYmd(item.date);
      if (!ymd) continue;
      (map[ymd] ??= []).push(item);
    }
    return map;
  }, [homework]);

  const holidaysByDate = useMemo(() => {
    const map: Record<string, typeof events> = {};
    for (const event of events) {
      if (!event?.date || event.selected === false) continue;
      (map[event.date] ??= []).push(event);
    }
    return map;
  }, [events]);

  const dayMeta = useMemo(() => {
    const meta: Record<string, DayMeta> = {};
    const dates = new Set([...Object.keys(homeworkByDate), ...Object.keys(holidaysByDate)]);
    for (const ymd of dates) {
      const entries = homeworkByDate[ymd] || [];
      let completed = 0;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (completedMap[e.id || ''] ?? e.completed) completed++;
      }
      meta[ymd] = {
        hwCount: entries.length,
        allDone: entries.length > 0 && completed === entries.length,
        holidayCount: (holidaysByDate[ymd] || []).length,
      };
    }
    return meta;
  }, [homeworkByDate, holidaysByDate, completedMap]);

  const calendarDays = useMemo(
    () => getCalendarDaysForMonth(currentYear, currentMonth),
    [currentYear, currentMonth]
  );

  const monthTitle = useMemo(
    () => currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    [currentDate]
  );

  const monthHolidays = useMemo(
    () =>
      events
        .filter((e) => e.date.startsWith(monthPrefix))
        .sort((a, b) => a.date.localeCompare(b.date) || Number(b.selected !== false) - Number(a.selected !== false)),
    [events, monthPrefix]
  );

  const selectedDateLabel = useMemo(() => {
    const [y, m, d] = selectedYmd.split('-').map(Number);
    if (!y || !m || !d) return selectedYmd;
    const date = new Date(y, m - 1, d);
    const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
    const rest = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return selectedYmd === todayYmd ? `Today · ${rest}` : `${weekday} · ${rest}`;
  }, [selectedYmd, todayYmd]);

  const selectedEntries = homeworkByDate[selectedYmd] || [];
  const selectedHolidays = holidaysByDate[selectedYmd] || [];
  const isSelectedDateLoading =
    isLoading ||
    (Boolean(isRefreshing) && selectedEntries.length === 0 && selectedHolidays.length === 0) ||
    (eventsLoading && selectedEntries.length === 0 && selectedHolidays.length === 0);

  const handleSelect = useCallback((ymd: string) => {
    setSelectedYmd(ymd);
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() => {
        detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, []);

  const handlePrevMonth = useCallback(() => {
    startTransition(() => {
      setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    });
  }, []);

  const handleNextMonth = useCallback(() => {
    startTransition(() => {
      setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    });
  }, []);

  const handleJumpToToday = useCallback(() => {
    const now = new Date();
    startTransition(() => {
      setCurrentDate(now);
      setSelectedYmd(formatYmd(now));
    });
  }, []);

  const handleRefreshAll = useCallback(() => {
    onRefresh(true);
    reload(true);
  }, [onRefresh, reload]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Calendar"
        description="Homework and school holidays from EduSecure."
        actions={
          <>
            <button
              type="button"
              onClick={handleJumpToToday}
              className="h-9 rounded-full border border-black/[0.06] bg-white/75 px-4 text-xs font-medium text-neutral-700 shadow-2xs backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:border-black/[0.12] hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.06] dark:text-neutral-200 dark:hover:border-white/[0.14] dark:hover:bg-white/[0.1]"
            >
              Today
            </button>
            <RefreshButton
              onRefresh={handleRefreshAll}
              isRefreshing={isLoading || Boolean(isRefreshing) || eventsLoading}
              compact
            />
          </>
        }
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        <div className="space-y-4 lg:sticky lg:top-4 lg:col-span-5">
          <div className="relative overflow-hidden rounded-[2.25rem] border border-black/[0.06] bg-white/85 p-3 shadow-[0_24px_70px_-38px_rgba(15,23,42,0.55)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#151519]/90 dark:shadow-[0_28px_90px_-42px_rgba(0,0,0,0.95)] sm:p-5">
            <div className="pointer-events-none absolute -right-24 -top-28 size-64 rotate-12 rounded-[44%_56%_62%_38%] bg-fuchsia-300/25 blur-3xl dark:bg-fuchsia-500/10" />
            <div className="pointer-events-none absolute -bottom-32 -left-24 size-64 -rotate-12 rounded-[63%_37%_42%_58%] bg-sky-300/25 blur-3xl dark:bg-sky-400/10" />
            <div className="relative">
              <div className="mb-5 flex items-center justify-between gap-3 px-1">
              <h2 className="text-lg font-semibold tracking-[-0.03em] text-neutral-950 dark:text-neutral-50 sm:text-xl">
                {monthTitle}
              </h2>
              <div className="flex items-center gap-1 rounded-full border border-black/[0.06] bg-black/[0.025] p-1 dark:border-white/[0.08] dark:bg-white/[0.04]">
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  className="flex size-8 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-white hover:text-neutral-950 dark:hover:bg-white/10 dark:hover:text-white"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleNextMonth}
                  className="flex size-8 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-white hover:text-neutral-950 dark:hover:bg-white/10 dark:hover:text-white"
                  aria-label="Next month"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              </div>

            <div className="mb-2 grid grid-cols-7">
              {WEEKDAYS.map((name) => (
                <div
                  key={name}
                  className="py-1 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400 dark:text-neutral-500"
                >
                  {name}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
              {calendarDays.map((dayItem) => (
                <DayCell
                  key={dayItem.ymd}
                  ymd={dayItem.ymd}
                  dayNumber={dayItem.date.getDate()}
                  isCurrentMonth={dayItem.isCurrentMonth}
                  isToday={dayItem.ymd === todayYmd}
                  isSelected={dayItem.ymd === selectedYmd}
                  meta={dayMeta[dayItem.ymd]}
                  onSelect={handleSelect}
                />
              ))}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-black/[0.06] px-1 pt-4 text-[10px] font-medium text-neutral-500 dark:border-white/[0.08] dark:text-neutral-400">
              <span className="inline-flex items-center gap-2 rounded-full bg-rose-500/[0.08] px-2.5 py-1.5 text-rose-600 dark:bg-rose-400/[0.1] dark:text-rose-300">
                <span className="size-1.5 rounded-full bg-rose-500" /> Holiday
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-black/[0.04] px-2.5 py-1.5 dark:bg-white/[0.06]">
                <span className="size-1.5 rounded-full bg-neutral-400 dark:bg-neutral-500" /> Homework
              </span>
            </div>
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-black/[0.06] bg-white/75 p-4 shadow-[0_18px_50px_-36px_rgba(15,23,42,0.7)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#151519]/80 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2 px-0.5">
              <h3 className="text-sm font-semibold tracking-[-0.02em] text-neutral-950 dark:text-neutral-100">
                Holidays · {monthTitle.split(' ')[0]}
              </h3>
              {eventsError && (
                <button
                  type="button"
                  onClick={() => reload(true)}
                  className="rounded-full px-2 py-1 text-[11px] font-medium text-rose-600 transition-colors hover:bg-rose-500/[0.08] dark:text-rose-400"
                >
                  Retry
                </button>
              )}
            </div>

            {eventsLoading && events.length === 0 ? (
              <p className="rounded-2xl bg-black/[0.025] px-3 py-4 text-xs text-neutral-400 dark:bg-white/[0.04]">Loading from EduSecure…</p>
            ) : monthHolidays.length === 0 ? (
              <p className="rounded-2xl bg-black/[0.025] px-3 py-4 text-xs text-neutral-400 dark:bg-white/[0.04]">
                {eventsError || 'No school holidays listed for this month.'}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {monthHolidays.map((event) => (
                  <li key={event.id}>
                    <HolidayCard
                      event={event}
                      variant="compact"
                      active={selectedYmd === event.date}
                      onSelect={() => handleSelect(event.date)}
                      onToggleVisible={() =>
                        setSelected(event, !(event.selected !== false))
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div ref={detailRef} className="lg:col-span-7 space-y-3 scroll-mt-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-base font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
              {selectedDateLabel}
            </h3>
            {(selectedEntries.length > 0 || selectedHolidays.length > 0) && (
              <span className="text-[11px] tabular-nums text-neutral-400">
                {[
                  selectedHolidays.length
                    ? `${selectedHolidays.length} holiday${selectedHolidays.length === 1 ? '' : 's'}`
                    : null,
                  selectedEntries.length
                    ? `${selectedEntries.length} task${selectedEntries.length === 1 ? '' : 's'}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
          </div>

          {selectedHolidays.map((event) => (
            <HolidayCard
              key={event.id}
              event={event}
              variant="detail"
              onToggleVisible={() => setSelected(event, false)}
            />
          ))}

          {isSelectedDateLoading ? (
            <LoadingSkeleton count={2} label="Loading this day’s schedule…" />
          ) : selectedEntries.length > 0 ? (
            <div className="space-y-3">
              {selectedEntries.map((item, idx) => (
                <HomeworkCard
                  key={item.id || `cal-${idx}`}
                  item={item}
                  isCompleted={completedMap[item.id || ''] ?? item.completed}
                  onToggleCompleted={
                    item.id ? () => onToggleCompleted(item.id!) : undefined
                  }
                  onUpdateNote={onUpdateNote}
                  onOpenPreview={onOpenPreview}
                />
              ))}
            </div>
          ) : selectedHolidays.length === 0 ? (
            <EmptyState
              icon={CalendarIcon}
              title="Nothing on this day"
              description="No homework or holidays selected."
            />
          ) : null}
        </div>
      </div>
    </div>
  );
};
