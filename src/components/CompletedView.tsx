import React, { useState } from 'react';
import { HomeworkEntry } from '../types/homework';
import { detectSubject } from '../utils/subjectDetector';
import { HomeworkCard } from './HomeworkCard';
import { SubjectFilterPills } from './SubjectFilterPills';
import { EmptyState } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';
import { RefreshCw } from 'lucide-react';

interface CompletedViewProps {
  homework: HomeworkEntry[];
  isLoading: boolean;
  onRefresh: () => void;
  completedMap: Record<string, boolean>;
  onToggleCompleted: (id: string) => void;
  onUpdateNote?: (id: string, note: string | null) => void;
  onOpenPreview?: (url: string) => void;
}

export const CompletedView: React.FC<CompletedViewProps> = ({
  homework,
  isLoading,
  onRefresh,
  completedMap,
  onToggleCompleted,
  onUpdateNote,
  onOpenPreview,
}) => {
  const [selectedSubject, setSelectedSubject] = useState<string>('All');

  const getEntryId = (item: HomeworkEntry) =>
    item.id || `${item.date}_${detectSubject(item.homework).name}_${item.homework.slice(0, 30)}`;

  const completedEntries = homework.filter((item) => {
    const id = getEntryId(item);
    return Boolean(completedMap[id]) || item.completed === true;
  });

  const availableSubjects = Array.from(
    new Set(completedEntries.map((item) => detectSubject(item.homework).name))
  );

  const filteredEntries =
    selectedSubject === 'All'
      ? completedEntries
      : completedEntries.filter((item) => detectSubject(item.homework).name === selectedSubject);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-neutral-200/60 dark:border-neutral-800/60 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50 tracking-tight">
            Completed homework
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 font-medium">
            Assignments you have marked as complete
          </p>
        </div>

        <button
          onClick={() => onRefresh()}
          disabled={isLoading}
          className="group/ref inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#141417] text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors duration-150 shadow-2xs cursor-pointer active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 transition-transform duration-300 ${isLoading ? 'animate-spin' : 'group-hover/ref:rotate-180'}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Subject Filter Pills */}
      <SubjectFilterPills
        subjects={availableSubjects}
        selectedSubject={selectedSubject}
        onSelectSubject={setSelectedSubject}
      />

      {isLoading ? (
        <LoadingSkeleton />
      ) : filteredEntries.length === 0 ? (
        <EmptyState
          type="all"
          title="No completed homework"
          subtitle="Check off tasks on your dashboard to see them listed here."
        />
      ) : (
        <div className="space-y-3.5 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
          {filteredEntries.map((item, index) => {
            const entryId = getEntryId(item);
            return (
              <HomeworkCard
                key={item.id || index}
                item={item}
                isCompleted={true}
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
