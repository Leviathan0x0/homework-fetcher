import React, { useState } from 'react';
import { HomeworkEntry } from '../types/homework';
import { detectSubject } from '../utils/subjectDetector';
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

  const { displayedItems, hasMore, loadMore, visibleCount, totalCount } = usePagination(filteredEntries, 25);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Completed homework"
        description="Assignments you have marked as complete"
        actions={<RefreshButton onRefresh={() => onRefresh()} isRefreshing={isLoading} />}
      />

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
