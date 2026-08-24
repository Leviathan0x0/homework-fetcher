import React, { useMemo, useState } from 'react';
import { HomeworkEntry } from '../types/homework';
import { filterExamHomework } from '../utils/examDetector';
import { detectSubject } from '../utils/subjectDetector';
import { HomeworkCard } from './HomeworkCard';
import { EmptyState } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';
import { PageHeader } from './PageHeader';
import { RefreshButton } from './RefreshButton';
import { Reicon } from './ui/reicon';
import { cn } from '../utils/cn';

interface ExamsViewProps {
  homework: HomeworkEntry[];
  isLoading: boolean;
  isRefreshing?: boolean;
  onRefresh: (forceRefresh: boolean) => void;
  completedMap: Record<string, boolean>;
  onToggleCompleted: (id: string) => void;
  onUpdateNote: (id: string, note: string | null) => void;
  onOpenPreview: (url: string) => void;
}

export const ExamsView: React.FC<ExamsViewProps> = ({
  homework,
  isLoading,
  isRefreshing,
  onRefresh,
  completedMap,
  onToggleCompleted,
  onUpdateNote,
  onOpenPreview,
}) => {
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'high' | 'medium'>('all');

  // Filter exam-related homework
  const examItems = useMemo(() => {
    const validHomework = Array.isArray(homework) ? homework.filter(Boolean) : [];
    return filterExamHomework(validHomework);
  }, [homework]);

  // Total statistics
  const totalExamsCount = examItems.length;
  const completedCount = useMemo(() => {
    return examItems.filter(({ entry }) => {
      if (!entry) return false;
      const isDone = completedMap[entry.id || ''] ?? entry.completed;
      return Boolean(isDone);
    }).length;
  }, [examItems, completedMap]);

  const remainingCount = totalExamsCount - completedCount;

  // Filtered by confidence pill
  const filteredExamItems = useMemo(() => {
    if (selectedFilter === 'high') {
      return examItems.filter((i) => i?.detection?.category === 'Exam-related');
    }
    if (selectedFilter === 'medium') {
      return examItems.filter((i) => i?.detection?.category === 'Possibly exam-related');
    }
    return examItems;
  }, [examItems, selectedFilter]);
  const isContentLoading =
    isLoading || (Boolean(isRefreshing) && filteredExamItems.length === 0);

  // Group exam items by Subject
  const groupedBySubject = useMemo(() => {
    const map: Record<string, typeof examItems> = {};
    filteredExamItems.forEach((item) => {
      if (!item?.entry) return;
      const subject = detectSubject(item.entry.homework || '').name;
      if (!map[subject]) {
        map[subject] = [];
      }
      map[subject].push(item);
    });
    return map;
  }, [filteredExamItems]);

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-200">
      <PageHeader
        title="Exam Mode"
        description="Automatically grouped revision, syllabus, and exam-related assignments."
        actions={<RefreshButton onRefresh={() => onRefresh(true)} isRefreshing={isLoading || isRefreshing} compact />}
      />

      {/* Subtle Exam Summary Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5 rounded-3xl bg-white dark:bg-[#141417] border border-neutral-200/80 dark:border-neutral-800/80 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-900 dark:text-white shrink-0">
            <Reicon name="graduation-cap" size={20} preset="scale" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {isContentLoading ? '…' : totalExamsCount} exam-related {totalExamsCount === 1 ? 'assignment' : 'assignments'}
            </h2>
            <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                {isContentLoading ? '…' : completedCount} completed
              </span>
              <span>·</span>
              <span className="text-neutral-700 dark:text-neutral-300 font-medium">
                {isContentLoading ? '…' : remainingCount} remaining
              </span>
            </div>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 bg-neutral-100/80 dark:bg-neutral-800/80 p-1 rounded-2xl">
          <button
            onClick={() => setSelectedFilter('all')}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-xl transition-colors duration-150 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40 dark:focus-visible:ring-neutral-600/50',
              selectedFilter === 'all'
                ? 'bg-white dark:bg-[#18181b] text-neutral-900 dark:text-neutral-100 font-semibold shadow-2xs'
                : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200'
            )}
          >
            All ({isContentLoading ? '…' : totalExamsCount})
          </button>
          <button
            onClick={() => setSelectedFilter('high')}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-xl transition-colors duration-150 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40 dark:focus-visible:ring-neutral-600/50',
              selectedFilter === 'high'
                ? 'bg-white dark:bg-[#18181b] text-neutral-900 dark:text-neutral-100 font-semibold shadow-2xs'
                : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200'
            )}
          >
            Exams Only
          </button>
          <button
            onClick={() => setSelectedFilter('medium')}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-xl transition-colors duration-150 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40 dark:focus-visible:ring-neutral-600/50',
              selectedFilter === 'medium'
                ? 'bg-white dark:bg-[#18181b] text-neutral-900 dark:text-neutral-100 font-semibold shadow-2xs'
                : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200'
            )}
          >
            Syllabus & Revision
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {isContentLoading ? (
        <LoadingSkeleton count={3} label="Loading exam assignments…" />
      ) : filteredExamItems.length > 0 ? (
        <div className="space-y-8">
          {Object.entries(groupedBySubject).map(([subjectName, items]) => (
            <section key={subjectName} className="space-y-3">
              <div className="flex items-center justify-between pb-1 border-b border-neutral-200/60 dark:border-neutral-800/60">
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-neutral-900 dark:bg-neutral-100" />
                  <span>{subjectName}</span>
                </h3>
                <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                  {items.length} {items.length === 1 ? 'task' : 'tasks'}
                </span>
              </div>

              <div className="space-y-4">
                {items.map(({ entry, detection }) => (
                  <div key={entry.id || entry.homework} className="relative">
                    {/* Badge showing detection reason */}
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                        Keyword match: "{detection.matchedKeyword}"
                      </span>
                    </div>

                    <HomeworkCard
                      item={entry}
                      isCompleted={completedMap[entry.id || ''] ?? entry.completed}
                      onToggleCompleted={
                        entry.id ? () => onToggleCompleted(entry.id!) : undefined
                      }
                      onUpdateNote={onUpdateNote}
                      onOpenPreview={onOpenPreview}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          type="exams"
          title="No exam-related assignments found"
          description="Assignments mentioning exams, syllabus, or revision will automatically appear here."
        />
      )}
    </div>
  );
};
