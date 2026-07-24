import React, { useState } from 'react';
import { HomeworkEntry } from '../types/homework';
import { isTodayDate, formatContextualDate } from '../utils/dateUtils';
import { detectSubject } from '../utils/subjectDetector';
import { HomeworkCard } from './HomeworkCard';
import { SubjectFilterPills } from './SubjectFilterPills';
import { EmptyState } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';
import { RefreshCw } from 'lucide-react';

interface TodayViewProps {
  homework: HomeworkEntry[];
  isLoading: boolean;
  isRefreshing?: boolean;
  onRefresh: (force?: boolean) => void;
  lastUpdated: string | null;
  completedMap: Record<string, boolean>;
  onToggleCompleted: (id: string) => void;
  onUpdateNote?: (id: string, note: string | null) => void;
  onOpenPreview?: (url: string) => void;
}

export const TodayView: React.FC<TodayViewProps> = ({
  homework,
  isLoading,
  isRefreshing,
  onRefresh,
  lastUpdated,
  completedMap,
  onToggleCompleted,
  onUpdateNote,
  onOpenPreview,
}) => {
  const [selectedSubject, setSelectedSubject] = useState<string>('All');

  const todayAllEntries = homework.filter((item) => isTodayDate(item.date));

  // Extract unique subjects for subject filter pills
  const availableSubjects = Array.from(
    new Set(todayAllEntries.map((item) => detectSubject(item.homework).name))
  );

  // Apply Subject Filter
  const todayEntries = selectedSubject === 'All'
    ? todayAllEntries
    : todayAllEntries.filter((item) => detectSubject(item.homework).name === selectedSubject);

  const getEntryId = (item: HomeworkEntry) =>
    item.id || `${item.date}_${detectSubject(item.homework).name}_${item.homework.slice(0, 30)}`;

  const dateStr = formatContextualDate();

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-neutral-200/60 dark:border-neutral-800/60 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50 tracking-tight">
            Today's homework
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 font-medium">
            {dateStr}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onRefresh(true)}
            disabled={isLoading || isRefreshing}
            className="group/ref inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#141417] text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors duration-150 shadow-2xs cursor-pointer active:scale-95 disabled:opacity-50"
            title="Refresh homework from school server"
          >
            <RefreshCw className={`w-3.5 h-3.5 transition-transform duration-300 ${(isLoading || isRefreshing) ? 'animate-spin' : 'group-hover/ref:rotate-180'}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Subject Filter Pills */}
      <SubjectFilterPills
        subjects={availableSubjects}
        selectedSubject={selectedSubject}
        onSelectSubject={setSelectedSubject}
      />

      {/* Main Content List */}
      {isLoading ? (
        <LoadingSkeleton />
      ) : todayEntries.length === 0 ? (
        <EmptyState type="today" />
      ) : (
        <div className="space-y-3.5 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
          {todayEntries.map((item, index) => {
            const entryId = getEntryId(item);
            return (
              <HomeworkCard
                key={item.id || index}
                item={item}
                isCompleted={Boolean(completedMap[entryId]) || item.completed === true}
                onToggleCompleted={() => onToggleCompleted(entryId)}
                onUpdateNote={onUpdateNote}
                onOpenPreview={onOpenPreview}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};
