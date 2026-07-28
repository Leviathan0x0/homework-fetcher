import React, { useState } from 'react';
import { HomeworkEntry } from '../types/homework';
import { isTodayDate, formatContextualDate, getTimeGreeting } from '../utils/dateUtils';
import { detectSubject } from '../utils/subjectDetector';
import { HomeworkCard } from './HomeworkCard';
import { SubjectFilterPills } from './SubjectFilterPills';
import { EmptyState } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';
import { RefreshButton } from './RefreshButton';
import { ScrollToTopButton } from './ScrollToTopButton';
import { cn } from '../utils/cn';

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
  displayName?: string | null;
  studentId?: string | null;
}

function firstNameFrom(displayName?: string | null, studentId?: string | null): string {
  const raw = (displayName || studentId || '').trim();
  if (!raw) return 'there';
  const token = raw.split(/[\s@._-]+/).filter(Boolean)[0] || raw;
  return token.charAt(0).toUpperCase() + token.slice(1);
}

function progressEncouragement(done: number, total: number): string {
  if (total === 0) return 'Nothing due today — enjoy the quiet.';
  if (done === 0) return 'Start with one — momentum builds fast.';
  if (done >= total) return 'All done for today. Nice work.';
  if (done / total >= 0.66) return 'Almost there — keep going.';
  return 'Keep going — you are making progress.';
}

export const TodayView: React.FC<TodayViewProps> = ({
  homework,
  isLoading,
  isRefreshing,
  onRefresh,
  completedMap,
  onToggleCompleted,
  onUpdateNote,
  onOpenPreview,
  displayName,
  studentId,
}) => {
  const [selectedSubject, setSelectedSubject] = useState<string>('All');

  const validHomework = Array.isArray(homework) ? homework.filter(Boolean) : [];
  const todayAllEntries = validHomework.filter((item) => isTodayDate(item?.date));

  const availableSubjects = Array.from(
    new Set(todayAllEntries.map((item) => detectSubject(item?.homework || '').name))
  );

  const todayEntries =
    selectedSubject === 'All'
      ? todayAllEntries
      : todayAllEntries.filter((item) => detectSubject(item?.homework || '').name === selectedSubject);

  const getEntryId = (item: HomeworkEntry) => {
    if (!item) return '';
    const d = item.date || '';
    const hw = item.homework || '';
    return item.id || `${d}_${detectSubject(hw).name}_${hw.slice(0, 30)}`;
  };

  const isEntryDone = (item: HomeworkEntry) => {
    const entryId = getEntryId(item);
    return Boolean(completedMap[entryId]) || item.completed === true;
  };

  const doneCount = todayAllEntries.filter(isEntryDone).length;
  const totalCount = todayAllEntries.length;
  const progressPct = totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100);

  const greeting = getTimeGreeting();
  const name = firstNameFrom(displayName, studentId);
  const dateStr = formatContextualDate();
  const pendingCount = Math.max(totalCount - doneCount, 0);

  return (
    <div className="space-y-6">
      {/* Personal greeting */}
      <div className="flex flex-col gap-3 pb-5 border-b border-neutral-200/70 dark:border-neutral-800/70 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">{dateStr}</p>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
            <span aria-hidden className="mr-1.5">👋</span>
            {greeting}, {name}
          </h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1.5 leading-relaxed">
            {isLoading
              ? 'Loading today’s homework…'
              : totalCount === 0
                ? 'No homework assigned for today.'
                : pendingCount === 0
                  ? `You finished all ${totalCount} homework task${totalCount === 1 ? '' : 's'} for today.`
                  : `You have ${pendingCount} homework task${pendingCount === 1 ? '' : 's'} left today.`}
          </p>
        </div>
        <div className="shrink-0 sm:pt-0.5">
          <RefreshButton onRefresh={() => onRefresh(true)} isRefreshing={isLoading || isRefreshing} />
        </div>
      </div>

      {/* Today's progress */}
      {!isLoading && totalCount > 0 && (
        <section
          className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800/80 bg-white dark:bg-[#141417] p-4 sm:p-5 shadow-2xs animate-in fade-in-0 duration-300"
          aria-label="Today's progress"
        >
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 tracking-tight">
              Today’s Progress
            </h2>
            <p className="text-xs font-semibold tabular-nums text-neutral-600 dark:text-neutral-300">
              {doneCount}/{totalCount} Done
            </p>
          </div>
          <div
            className="h-2.5 w-full rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden"
            role="progressbar"
            aria-valuenow={doneCount}
            aria-valuemin={0}
            aria-valuemax={totalCount}
          >
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-500 ease-out',
                doneCount >= totalCount
                  ? 'bg-emerald-500'
                  : 'bg-neutral-900 dark:bg-neutral-100'
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="mt-2.5 text-xs text-neutral-500 dark:text-neutral-400">
            {progressEncouragement(doneCount, totalCount)}
            {doneCount > 0 && doneCount < totalCount ? ' 💪' : doneCount >= totalCount ? ' ✨' : ''}
          </p>
        </section>
      )}

      <SubjectFilterPills
        subjects={availableSubjects}
        selectedSubject={selectedSubject}
        onSelectSubject={setSelectedSubject}
      />

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
                isCompleted={isEntryDone(item)}
                onToggleCompleted={() => onToggleCompleted(entryId)}
                onUpdateNote={onUpdateNote}
                onOpenPreview={onOpenPreview}
              />
            );
          })}
        </div>
      )}
      <ScrollToTopButton />
    </div>
  );
};
