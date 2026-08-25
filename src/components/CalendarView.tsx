import React, { useState, useMemo, useCallback, useRef, memo, startTransition } from 'react';
import type { HomeworkEntry, SchoolCalendarEvent } from '../types/homework';
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
import { cn } from '../utils/cn';
import { Reicon } from './ui/reicon';

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
        'group relative flex aspect-square min-h-[2.5rem] sm:min-h-[2.75rem] w-full flex-col items-center justify-center rounded-xl text-xs tabular-nums select-none touch-manipulation',
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
        <span className="absolute bottom-1.5 flex items-center gap-1">
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

  const homeworkByYmd = useMemo(() => {
    const map = new Map<string, HomeworkEntry[]>();
    for (const item of homework) {
      if (!item.date) continue;
      const ymd = getHomeworkDateYmd(item.date);
      if (!ymd) continue;
      const list = map.get(ymd);
      if (list) {
        list.push(item);
      } else {
        map.set(ymd, [item]);
      }
    }
    return map;
  }, [homework]);

  const holidaysByYmd = useMemo(() => {
    const map = new Map<string, SchoolCalendarEvent[]>();
    for (const event of events) {
      if (event.selected === false) continue;
      const list = map.get(event.date);
      if (list) {
        list.push(event);
      } else {
        map.set(event.date, [event]);
      }
    }
    return map;
  }, [events]);

  const calendarDays = useMemo(
    () => getCalendarDaysForMonth(currentYear, currentMonth),
    [currentYear, currentMonth]
  );

  const dayMeta = useMemo(() => {
    const record: Record<string, DayMeta> = {};
    for (const day of calendarDays) {
      const hwList = homeworkByYmd.get(day.ymd) || [];
      const holList = holidaysByYmd.get(day.ymd) || [];
      const hwCount = hwList.length;
      let allDone = false;
      if (hwCount > 0) {
        allDone = hwList.every((item) => {
          const entryId = item.id || `${item.date}_${item.homework}`;
          return Boolean(completedMap[entryId]);
        });
      }
      record[day.ymd] = {
        hwCount,
        allDone,
        holidayCount: holList.length,
      };
    }
    return record;
  }, [calendarDays, homeworkByYmd, holidaysByYmd, completedMap]);

  const monthTitle = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
        currentDate
      ),
    [currentDate]
  );

  const selectedDateLabel = useMemo(() => {
    const [y, m, d] = selectedYmd.split('-').map(Number);
    if (!y || !m || !d) return selectedYmd;
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(y, m - 1, d));
  }, [selectedYmd]);

  const selectedHomework = useMemo(
    () => homeworkByYmd.get(selectedYmd) || [],
    [homeworkByYmd, selectedYmd]
  );

  const selectedHolidays = useMemo(
    () => holidaysByYmd.get(selectedYmd) || [],
    [holidaysByYmd, selectedYmd]
  );

  const monthHolidays = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const prefix = `${currentYear}-${pad(currentMonth + 1)}`;
    return events
      .filter((e) => e.date.startsWith(prefix))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [events, currentYear, currentMonth]);

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
    startTransition(() => {
      setCurrentDate(new Date());
      setSelectedYmd(todayYmd);
    });
  }, [todayYmd]);

  const handleSelect = useCallback((ymd: string) => {
    startTransition(() => {
      setSelectedYmd(ymd);
    });
    if (window.innerWidth < 1280 && detailRef.current) {
      detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, []);

  const handleRefreshAll = useCallback(() => {
    onRefresh(true);
    reload(true);
  }, [onRefresh, reload]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description="Browse homework and school holidays month by month."
        actions={
          <>
            <button
              type="button"
              onClick={handleJumpToToday}
              className="h-9 rounded-xl border border-neutral-200 bg-white px-4 text-xs font-medium text-neutral-700 shadow-2xs transition-colors hover:border-neutral-300 hover:text-neutral-950 dark:border-neutral-800 dark:bg-[#141417] dark:text-neutral-300 dark:hover:border-neutral-700 dark:hover:text-white cursor-pointer"
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
          <div className="rounded-2xl border border-neutral-200/80 bg-white p-3 dark:border-neutral-800/80 dark:bg-[#141417] sm:p-4 shadow-xs">
            <div>
              <div className="mb-3 flex items-center justify-between gap-3 px-0.5">
                <h2 className="text-base font-semibold tracking-[-0.03em] text-neutral-950 dark:text-neutral-50">
                  {monthTitle}
                </h2>
                <div className="flex items-center gap-0.5 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800/70">
                  <button
                    type="button"
                    onClick={handlePrevMonth}
                    className="flex size-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-white hover:text-neutral-950 dark:hover:bg-neutral-700 dark:hover:text-white cursor-pointer"
                    aria-label="Previous month"
                  >
                    <Reicon name="chevron-left" size={16} preset="scale" />
                  </button>
                  <button
                    type="button"
                    onClick={handleNextMonth}
                    className="flex size-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-white hover:text-neutral-950 dark:hover:bg-neutral-700 dark:hover:text-white cursor-pointer"
                    aria-label="Next month"
                  >
                    <Reicon name="chevron-right" size={16} preset="scale" />
                  </button>
                </div>
              </div>

              <div className="mb-1.5 grid grid-cols-7">
                {WEEKDAYS.map((name) => (
                  <div
                    key={name}
                    className="py-0.5 text-center text-[10px] font-semibold text-neutral-400 dark:text-neutral-500"
                  >
                    {name}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1 sm:gap-1.5 [grid-auto-rows:2.75rem] sm:[grid-auto-rows:3rem] xl:[grid-auto-rows:3.125rem]">
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

              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-neutral-100 px-0.5 pt-3 text-[10px] font-medium text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                <span className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-300">
                  <span className="size-1.5 rounded-full bg-rose-500" /> Holiday
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-neutral-400 dark:bg-neutral-500" /> Homework
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200/80 bg-white p-3 dark:border-neutral-800/80 dark:bg-[#141417] sm:p-4 shadow-xs">
            <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
              <h3 className="text-sm font-semibold tracking-[-0.02em] text-neutral-950 dark:text-neutral-100">
                Holidays · {monthTitle.split(' ')[0]}
              </h3>
              {eventsError && (
                <button
                  type="button"
                  onClick={() => reload(true)}
                  className="rounded-full px-2 py-1 text-[11px] font-medium text-rose-600 transition-colors hover:bg-rose-500/[0.08] dark:text-rose-400 cursor-pointer"
                >
                  Retry
                </button>
              )}
            </div>

            {eventsLoading && events.length === 0 ? (
              <p className="py-3 text-center text-xs text-neutral-400">Loading holidays…</p>
            ) : monthHolidays.length === 0 ? (
              <p className="py-3 text-center text-xs text-neutral-400">
                No holidays scheduled for this month.
              </p>
            ) : (
              <div className="space-y-1">
                {monthHolidays.map((event) => (
                  <HolidayCard
                    key={event.id}
                    event={event}
                    variant="compact"
                    active={event.date === selectedYmd}
                    onSelect={() => handleSelect(event.date)}
                    onToggleVisible={() =>
                      setSelected(event, event.selected === false)
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div ref={detailRef} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200/80 pb-3 dark:border-neutral-800/80">
            <div>
              <p className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
                Selected Day
              </p>
              <h3 className="text-base font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">
                {selectedDateLabel}
              </h3>
            </div>
            {(selectedHomework.length > 0 || selectedHolidays.length > 0) && (
              <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                {selectedHolidays.length > 0 && (
                  <span className="rounded-full bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                    {selectedHolidays.length} holiday
                  </span>
                )}
                {selectedHomework.length > 0 && (
                  <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                    {selectedHomework.length} homework
                  </span>
                )}
              </div>
            )}
          </div>

          {selectedHolidays.length > 0 && (
            <div className="space-y-2">
              {selectedHolidays.map((event) => (
                <HolidayCard
                  key={event.id}
                  event={event}
                  variant="detail"
                  onToggleVisible={() =>
                    setSelected(event, event.selected === false)
                  }
                />
              ))}
            </div>
          )}

          {isLoading ? (
            <LoadingSkeleton label="Loading homework for selected day…" />
          ) : selectedHomework.length > 0 ? (
            <div className="space-y-3">
              {selectedHomework.map((item, idx) => {
                const entryId = item.id || `${item.date}_${item.homework}`;
                return (
                  <HomeworkCard
                    key={item.id || idx}
                    item={item}
                    isCompleted={Boolean(completedMap[entryId])}
                    onToggleCompleted={() => onToggleCompleted(entryId)}
                    onUpdateNote={onUpdateNote}
                    onOpenPreview={onOpenPreview}
                  />
                );
              })}
            </div>
          ) : selectedHolidays.length === 0 ? (
            <EmptyState
              type="today"
              title="Nothing on this day"
              description="No homework or holidays on this date."
            />
          ) : null}
        </div>
      </div>
    </div>
  );
};
