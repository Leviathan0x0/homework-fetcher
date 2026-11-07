import React, { useMemo, useState } from 'react';
import { HomeworkEntry } from '../types/homework';
import { homeworkSubjectName } from '../utils/subjectDetector';
import { getHomeworkEntryId as getEntryId } from '../utils/homeworkEntryId';
import { usePagination } from '../hooks/usePagination';
import { HomeworkCard } from './HomeworkCard';
import { SubjectFilterPills } from './SubjectFilterPills';
import { EmptyState } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';
import { PageHeader } from './PageHeader';
import { RefreshButton } from './RefreshButton';
import { LoadMoreButton } from './LoadMoreButton';

interface CompletedViewProps {
  homework: HomeworkEntry[];
  isLoading: boolean;
  isRefreshing?: boolean;
  onRefresh: () => void;
  completedMap: Record<string, boolean>;
  onToggleCompleted: (id: string) => void;
  onUpdateNote?: (id: string, note: string | null) => void;
  onOpenPreview?: (url: string) => void;
}

export const CompletedView: React.FC<CompletedViewProps> = ({
  homework,
  isLoading,
  isRefreshing,
  onRefresh,
  completedMap,
  onToggleCompleted,
  onUpdateNote,
  onOpenPreview,
}) => {
  const [selectedSubject, setSelectedSubject] = useState<string>('All');

  const completedEntries = useMemo(
    () =>
      (Array.isArray(homework) ? homework : []).filter(
        (item) => Boolean(item) && (Boolean(completedMap[getEntryId(item)]) || item.completed === true)
      ),
    [homework, completedMap]
  );

  const availableSubjects = useMemo(
    () => Array.from(new Set(completedEntries.map((item) => homeworkSubjectName(item)))),
    [completedEntries]
  );

  // A stale selection (its subject vanished from the data) falls back to "All" instead of an empty, unfilterable list.
  const activeSubject = availableSubjects.includes(selectedSubject) ? selectedSubject : 'All';

  const filteredEntries = useMemo(
    () =>
      activeSubject === 'All'
        ? completedEntries
        : completedEntries.filter((item) => homeworkSubjectName(item) === activeSubject),
    [completedEntries, activeSubject]
  );
  const isContentLoading = isLoading;

  const { displayedItems, hasMore, loadMore, visibleCount, totalCount } = usePagination(filteredEntries, 25);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Completed homework"
        description="Assignments you have marked as complete"
        actions={<RefreshButton onRefresh={() => onRefresh()} isRefreshing={isLoading || isRefreshing} />}
      />

      {/* Subject Filter Pills */}
      <SubjectFilterPills
        subjects={availableSubjects}
        selectedSubject={activeSubject}
        onSelectSubject={setSelectedSubject}
      />

      {isContentLoading ? (
        <LoadingSkeleton label="Loading completed homework…" />
      ) : filteredEntries.length === 0 ? (
        <EmptyState
          type="completed"
          title="No completed homework"
          subtitle="Check off tasks on your dashboard to see them listed here."
        />
      ) : (
        <div className="space-y-3.5 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
          {displayedItems.map((item, index) => {
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

          {/* Pagination / Batch load trigger */}
          <LoadMoreButton
            hasMore={hasMore}
            onLoadMore={loadMore}
            visibleCount={visibleCount}
            totalCount={totalCount}
          />
        </div>
      )}
    </div>
  );
};
