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
import { Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '../utils/cn';
import { ChevronLeftIcon } from './ui/chevron-left';
import { ChevronRightIcon } from './ui/chevron-right';
import { InteractiveAnimatedIcon } from './ui/interactive-animated-icon';

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
        'group relative flex h-full min-w-0 flex-col items-center justify-center rounded-lg text-xs tabular-nums select-none touch-manipulation',
        'transition-[background-color,color] duration-150 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40',
        !isCurrentMonth && 'text-neutral-300/60 dark:text-neutral-700/70',
        isCurrentMonth && !isSelected && !hasHoliday && 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800/70',
        isCurrentMonth && !isSelected && hasHoliday && 'text-rose-600 hover:bg-neutral-100 dark:text-rose-300 dark:hover:bg-neutral-800/70',
        isToday && !isSelected && 'ring-1 ring-inset ring-neutral-300 dark:ring-neutral-700',
        isSelected && 'bg-neutral-900 text-white font-semibold dark:bg-white dark:text-neutral-900',
        !isSelected && 'cursor-pointer'
      )}
    >
      <span
        className={cn(
          'flex size-7 items-center justify-center rounded-full leading-none',
          isToday && !isSelected && 'bg-neutral-100 dark:bg-neutral-800'
        )}
      >
        {dayNumber}
      </span>
      {(hwCount > 0 || hasHoliday) && (
        <span className="absolute bottom-1 flex items-center gap-1">
          {hasHoliday && (
            <span
              className={cn(
                'size-1.5 rounded-full',
                isSelected ? 'bg-white dark:bg-rose-500' : 'bg-rose-500'
              )}
            />
          )}
          {hwCount > 0 && (
            <span
              className={cn(
                'size-1 rounded-full',
                isSelected
                  ? allDone
                    ? 'bg-emerald-200 dark:bg-emerald-600'
                    : 'bg-white/75 dark:bg-neutral-700'
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
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1279px)').matches) {
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
    <div className="space-y-4">
      <PageHeader
        title="Calendar"
        description="Homework and school holidays from EduSecure."
        className="pb-4"
        actions={
          <>
            <button
              type="button"
              onClick={handleJumpToToday}
              className="h-9 rounded-xl border border-neutral-200 bg-white px-4 text-xs font-medium text-neutral-700 shadow-2xs transition-colors hover:border-neutral-300 hover:text-neutral-950 dark:border-neutral-800 dark:bg-[#141417] dark:text-neutral-300 dark:hover:border-neutral-700 dark:hover:text-white"
            >
              Today
            </button>
            <RefreshButton
              onRefresh={handleRefreshAll}
              isRefreshing={isLoading || Boolean(isRefreshing) || eventsLoading}
              compact
              label="calendar"
            />
          </>
        }
      />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(20rem,3fr)_minmax(0,7fr)] xl:gap-5">
        <div className="space-y-3 xl:sticky xl:top-4">
          <div className="rounded-2xl border border-neutral-200/80 bg-white p-3 dark:border-neutral-800/80 dark:bg-[#141417] sm:p-4">
            <div>
              <div className="mb-3 flex items-center justify-between gap-3 px-0.5">
                <h2 className="text-base font-semibold tracking-[-0.03em] text-neutral-950 dark:text-neutral-50">
                  {monthTitle}
                </h2>
                <div className="flex items-center gap-0.5 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800/70">
                  <button
                    type="button"
                    onClick={handlePrevMonth}
                    className="flex size-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-white hover:text-neutral-950 dark:hover:bg-neutral-700 dark:hover:text-white"
                    aria-label="Previous month"
                  >
                    <InteractiveAnimatedIcon icon={ChevronLeftIcon} size={16} className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleNextMonth}
                    className="flex size-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-white hover:text-neutral-950 dark:hover:bg-neutral-700 dark:hover:text-white"
                    aria-label="Next month"
                  >
                    <InteractiveAnimatedIcon icon={ChevronRightIcon} size={16} className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="mb-1 grid grid-cols-7">
                {WEEKDAYS.map((name) => (
                  <div
                    key={name}
                    className="py-0.5 text-center text-[9px] font-semibold text-neutral-400 dark:text-neutral-500"
                  >
                    {name}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1 [grid-auto-rows:2.75rem] sm:[grid-auto-rows:3rem] xl:[grid-auto-rows:3.125rem]">
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

              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-neutral-100 px-0.5 pt-3 text-[9px] font-medium text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                <span className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-300">
                  <span className="size-1.5 rounded-full bg-rose-500" /> Holiday
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-neutral-400 dark:bg-neutral-500" /> Homework
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200/80 bg-white p-3 dark:border-neutral-800/80 dark:bg-[#141417] sm:p-4">
            <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
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
              <p className="rounded-xl bg-black/[0.025] px-3 py-3 text-xs text-neutral-400 dark:bg-white/[0.04]">Loading from EduSecure…</p>
            ) : monthHolidays.length === 0 ? (
              <p className="rounded-xl bg-black/[0.025] px-3 py-3 text-xs text-neutral-400 dark:bg-white/[0.04]">
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

        <div ref={detailRef} className="space-y-3 scroll-mt-4">
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
