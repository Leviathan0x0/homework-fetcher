import React, { useState, useMemo } from 'react';
import { HomeworkEntry } from '../types/homework';
import { isWithinLast7Days } from '../utils/dateUtils';
import { detectSubject } from '../utils/subjectDetector';
import { usePagination } from '../hooks/usePagination';
import { HomeworkCard } from './HomeworkCard';
import { DateHeader } from './DateHeader';
import { SubjectFilterPills } from './SubjectFilterPills';
import { EmptyState } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';
import { PageHeader } from './PageHeader';
import { RefreshButton } from './RefreshButton';
import { LoadMoreButton } from './LoadMoreButton';
import { ScrollToTopButton } from './ScrollToTopButton';

interface RecentViewProps {
  homework: HomeworkEntry[];
  isLoading: boolean;
  onRefresh: (force?: boolean) => void;
  completedMap: Record<string, boolean>;
  onToggleCompleted: (id: string) => void;
  onUpdateNote: (id: string, note: string | null) => void;
  onOpenPreview: (url: string, filename?: string) => void;
}

export const RecentView: React.FC<RecentViewProps> = ({
  homework,
  isLoading,
  onRefresh,
  completedMap,
  onToggleCompleted,
  onUpdateNote,
  onOpenPreview,
}) => {
  const [selectedSubject, setSelectedSubject] = useState<string>('All');

  const validHomework = useMemo(() => (Array.isArray(homework) ? homework.filter(Boolean) : []), [homework]);

  const recentAllEntries = useMemo(() => {
    return validHomework.filter((item) => isWithinLast7Days(item?.date));
  }, [validHomework]);

  // Extract unique subjects
  const availableSubjects = useMemo(() => {
    return Array.from(new Set(recentAllEntries.map((item) => detectSubject(item?.homework || '').name)));
  }, [recentAllEntries]);

  const filteredEntries = useMemo(() => {
    return selectedSubject === 'All'
      ? recentAllEntries
      : recentAllEntries.filter((item) => detectSubject(item?.homework || '').name === selectedSubject);
  }, [recentAllEntries, selectedSubject]);

  const { displayedItems, hasMore, isLoadingMore, loadMore, visibleCount, totalCount } = usePagination(filteredEntries, 25);

  const getEntryId = (item: HomeworkEntry) => {
    if (!item) return '';
    const d = item.date || '';
    const hw = item.homework || '';
    return item.id || `${d}_${detectSubject(hw).name}_${hw.slice(0, 30)}`;
  };

  // Group chronologically by date
  const grouped: { date: string; entries: HomeworkEntry[] }[] = [];
  const map = new Map<string, { date: string; entries: HomeworkEntry[] }>();

  for (const item of displayedItems) {
    const d = item.date || 'School Diary';
    if (!map.has(d)) {
      const groupObj = { date: d, entries: [] };
      map.set(d, groupObj);
      grouped.push(groupObj);
    }
    map.get(d)!.entries.push(item);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recent homework"
        description="Assignments from the last 7 days"
        actions={<RefreshButton onRefresh={() => onRefresh(true)} isRefreshing={isLoading} />}
      />

      {/* Subject Filter Pills */}
      <SubjectFilterPills
        subjects={availableSubjects}
        selectedSubject={selectedSubject}
        onSelectSubject={setSelectedSubject}
      />

      {isLoading ? (
        <LoadingSkeleton />
      ) : grouped.length === 0 ? (
        <EmptyState type="recent" title="No recent homework" subtitle="There are no homework assignments matching your filter from the last 7 days." />
      ) : (
        <div className="space-y-8 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
          {grouped.map((group, gIdx) => (
            <section key={gIdx} className="space-y-3.5">
              <DateHeader dateStr={group.date} count={group.entries.length} />
              <div className="space-y-3">
                {group.entries.map((item, idx) => {
                  const entryId = getEntryId(item);
                  return (
                    <HomeworkCard
                      key={item.id || idx}
                      item={item}
                      isCompleted={Boolean(completedMap[entryId]) || item.completed === true}
                      onToggleCompleted={() => onToggleCompleted(entryId)}
                      onUpdateNote={onUpdateNote}
                      onOpenPreview={onOpenPreview}
                    />
                  );
                })}
              </div>
            </section>
          ))}

          {/* Pagination / Batch load trigger */}
          <LoadMoreButton
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={loadMore}
            visibleCount={visibleCount}
            totalCount={totalCount}
          />
        </div>
      )}
      <ScrollToTopButton />
    </div>
  );
};
