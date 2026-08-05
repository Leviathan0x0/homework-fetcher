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
        'relative flex flex-col items-center justify-center h-10 sm:h-11 rounded-lg text-[13px] tabular-nums select-none touch-manipulation',
        'transition-colors duration-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40',
        !isCurrentMonth && 'text-neutral-300 dark:text-neutral-700',
        isCurrentMonth && !isSelected && !hasHoliday && 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800/80',
        isCurrentMonth && !isSelected && hasHoliday && 'text-rose-700 dark:text-rose-300 bg-rose-50/80 dark:bg-rose-950/25 hover:bg-rose-100/80 dark:hover:bg-rose-950/40',
        isToday && !isSelected && 'font-semibold',
        isSelected && !hasHoliday && 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 font-semibold',
        isSelected && hasHoliday && 'bg-rose-600 text-white dark:bg-rose-500 font-semibold',
        !isSelected && 'cursor-pointer active:scale-[0.96]'
      )}
    >
      <span
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-full leading-none',
          isToday && !isSelected && !hasHoliday && 'ring-1 ring-neutral-900/20 dark:ring-white/25',
          isToday && !isSelected && hasHoliday && 'ring-1 ring-rose-400/50'
        )}
      >
        {dayNumber}
      </span>
      {(hwCount > 0 || hasHoliday) && (
        <span className="absolute bottom-1 flex items-center gap-0.5">
          {hasHoliday && (
            <span
              className={cn(
                'w-1.5 h-1.5 rounded-full',
                isSelected ? 'bg-white' : 'bg-rose-500'
              )}
            />
          )}
          {hwCount > 0 && (
            <span
              className={cn(
                'w-1 h-1 rounded-full',
                isSelected
                  ? allDone
                    ? 'bg-emerald-200'
                    : 'bg-white/70'
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
              className="h-9 px-3.5 text-xs font-medium rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#141417] text-neutral-700 dark:text-neutral-300 hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors cursor-pointer active:scale-[0.98] shadow-2xs"
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-5 lg:sticky lg:top-4 space-y-3">
          <div className="bg-white dark:bg-[#141417] border border-neutral-200/80 dark:border-neutral-800/80 rounded-2xl p-3 sm:p-4 shadow-2xs">
            <div className="flex items-center justify-between mb-3 px-1">
              <h2 className="text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
                {monthTitle}
              </h2>
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100 cursor-pointer"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleNextMonth}
                  className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100 cursor-pointer"
                  aria-label="Next month"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 mb-0.5">
              {WEEKDAYS.map((name) => (
                <div
                  key={name}
                  className="text-[10px] font-medium text-neutral-400 dark:text-neutral-500 text-center py-1"
                >
                  {name}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-px">
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

            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800/80 px-1 text-[11px] text-neutral-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> Holiday
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-neutral-400" /> Homework
              </span>
            </div>
          </div>

          <div className="bg-white dark:bg-[#141417] border border-neutral-200/80 dark:border-neutral-800/80 rounded-2xl p-3.5 sm:p-4 shadow-2xs">
            <div className="flex items-center justify-between gap-2 mb-2 px-0.5">
              <h3 className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                Holidays · {monthTitle.split(' ')[0]}
              </h3>
              {eventsError && (
                <button
                  type="button"
                  onClick={() => reload(true)}
                  className="text-[11px] text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                >
                  Retry
                </button>
              )}
            </div>

            {eventsLoading && events.length === 0 ? (
              <p className="text-xs text-neutral-400 py-3 px-0.5">Loading from EduSecure…</p>
            ) : monthHolidays.length === 0 ? (
              <p className="text-xs text-neutral-400 py-3 px-0.5">
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
