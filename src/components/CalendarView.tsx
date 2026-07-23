import React, { useState, useMemo } from 'react';
import { HomeworkEntry } from '../types/homework';
import { HomeworkCard } from './HomeworkCard';
import { EmptyState } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';
import {
  getHomeworkDateYmd,
  getCalendarDaysForMonth,
  formatYmd,
  isSameDay,
} from '../utils/dateUtils';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  RotateCw,
  CheckCircle2,
  ListTodo,
} from 'lucide-react';
import { cn } from '../utils/cn';

interface CalendarViewProps {
  homework: HomeworkEntry[];
  isLoading: boolean;
  onRefresh: (forceRefresh: boolean) => void;
  completedMap: Record<string, boolean>;
  onToggleCompleted: (id: string) => void;
  onUpdateNote: (id: string, note: string | null) => void;
  onOpenPreview: (url: string) => void;
}

const WEEKDAY_NAMES = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export const CalendarView: React.FC<CalendarViewProps> = ({
  homework,
  isLoading,
  onRefresh,
  completedMap,
  onToggleCompleted,
  onUpdateNote,
  onOpenPreview,
}) => {
  const today = useMemo(() => new Date(), []);
  const [currentDate, setCurrentDate] = useState<Date>(today);
  const [selectedYmd, setSelectedYmd] = useState<string>(formatYmd(today));

  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();

  // Map YMD strings to homework entries
  const homeworkByDate = useMemo(() => {
    const map: Record<string, HomeworkEntry[]> = {};
    homework.forEach((item) => {
      const ymd = getHomeworkDateYmd(item.date);
      if (ymd) {
        if (!map[ymd]) {
          map[ymd] = [];
        }
        map[ymd].push(item);
      }
    });
    return map;
  }, [homework]);

  // Calendar grid days
  const calendarDays = useMemo(() => {
    return getCalendarDaysForMonth(currentYear, currentMonth);
  }, [currentYear, currentMonth]);

  // Month navigation handlers
  const handlePrevMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const handleJumpToToday = () => {
    const now = new Date();
    setCurrentDate(now);
    setSelectedYmd(formatYmd(now));
  };

  // Selected date homework items
  const selectedDateEntries = useMemo(() => {
    return homeworkByDate[selectedYmd] || [];
  }, [homeworkByDate, selectedYmd]);

  // Format header string for current month (e.g. "July 2026")
  const monthTitle = useMemo(() => {
    return currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }, [currentDate]);

  // Selected Date Display String (e.g. "Thursday, July 23, 2026")
  const selectedDateFormatted = useMemo(() => {
    const [yearStr, monthStr, dayStr] = selectedYmd.split('-').map(Number);
    if (!yearStr || !monthStr || !dayStr) return selectedYmd;
    const d = new Date(yearStr, monthStr - 1, dayStr);
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }, [selectedYmd]);

  const todayYmd = formatYmd(today);

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-200">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-neutral-200/80 dark:border-neutral-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
              Calendar
            </h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">
              {monthTitle}
            </span>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            Click any date to view and manage assignments.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleJumpToToday}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors cursor-pointer active:scale-95"
          >
            Today
          </button>

          <button
            onClick={() => onRefresh(true)}
            disabled={isLoading}
            className="p-2 rounded-xl text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer active:scale-95 disabled:opacity-50"
            title="Refresh homework"
          >
            <RotateCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Main Grid & Detail Panel Container */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Calendar Card (Month View - Balanced) */}
        <div className="lg:col-span-5 bg-white dark:bg-[#141417] border border-neutral-200/80 dark:border-neutral-800/80 rounded-3xl p-4 sm:p-5 shadow-2xs">
          {/* Month Controls Header */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
              {monthTitle}
            </h2>

            <div className="flex items-center gap-1">
              <button
                onClick={handlePrevMonth}
                className="p-1.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400 transition-colors cursor-pointer active:scale-90"
                title="Previous month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={handleNextMonth}
                className="p-1.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400 transition-colors cursor-pointer active:scale-90"
                title="Next month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Weekday Labels Grid */}
          <div className="grid grid-cols-7 gap-1 text-center mb-2">
            {WEEKDAY_NAMES.map((dayName, idx) => (
              <div
                key={idx}
                className="text-[11px] font-bold text-neutral-400 dark:text-neutral-500 py-1"
              >
                {dayName}
              </div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((dayItem) => {
              const entries = homeworkByDate[dayItem.ymd] || [];
              const hasHomework = entries.length > 0;
              const completedCount = entries.filter((e) => completedMap[e.id || ''] ?? e.completed).length;
              const allDone = hasHomework && completedCount === entries.length;
              const isToday = dayItem.ymd === todayYmd;
              const isSelected = dayItem.ymd === selectedYmd;

              return (
                <button
                  key={dayItem.ymd}
                  onClick={() => setSelectedYmd(dayItem.ymd)}
                  className={cn(
                    'relative aspect-square sm:h-11 rounded-2xl flex flex-col items-center justify-center text-xs font-medium transition-all duration-150 cursor-pointer select-none group touch-manipulation',
                    !dayItem.isCurrentMonth && 'text-neutral-300 dark:text-neutral-700 opacity-40',
                    dayItem.isCurrentMonth && 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800/80',
                    // Today Styling
                    isToday && 'font-bold ring-2 ring-neutral-900 dark:ring-neutral-100 text-neutral-900 dark:text-white',
                    // Selected Styling
                    isSelected && 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 font-semibold shadow-xs hover:bg-neutral-900 dark:hover:bg-white',
                    isSelected && isToday && 'ring-offset-2 ring-offset-background'
                  )}
                >
                  <span>{dayItem.date.getDate()}</span>

                  {/* Homework Indicator Dots */}
                  {hasHomework && (
                    <div className="absolute bottom-1.5 flex items-center justify-center gap-0.5">
                      {allDone ? (
                        <div
                          className={cn(
                            'w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400',
                            isSelected && 'bg-emerald-300 dark:bg-emerald-600'
                          )}
                          title={`${entries.length} completed`}
                        />
                      ) : (
                        <div
                          className={cn(
                            'w-1.5 h-1.5 rounded-full bg-indigo-500 dark:bg-indigo-400',
                            isSelected && 'bg-white dark:bg-neutral-900'
                          )}
                          title={`${entries.length} assignments`}
                        />
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Date Detail Panel */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white dark:bg-[#141417] border border-neutral-200/80 dark:border-neutral-800/80 rounded-3xl p-5 sm:p-6 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800/80 pb-3">
              <div>
                <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                  Selected Date
                </span>
                <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
                  {selectedDateFormatted}
                </h3>
              </div>

              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300">
                {selectedDateEntries.length} {selectedDateEntries.length === 1 ? 'item' : 'items'}
              </span>
            </div>

            {/* List of Homework Cards for Selected Date */}
            {isLoading ? (
              <LoadingSkeleton count={2} />
            ) : selectedDateEntries.length > 0 ? (
              <div className="space-y-4 max-h-[600px] overflow-y-auto pr-1">
                {selectedDateEntries.map((item, idx) => (
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
            ) : (
              <EmptyState
                icon={CalendarIcon}
                title="No homework on this date"
                description="Enjoy your day off or select another date on the calendar."
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
