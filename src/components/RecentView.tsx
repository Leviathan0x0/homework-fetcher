import React, { useState, useMemo } from 'react';
import { HomeworkEntry } from '../types/homework';
import { selectHomeworkFromLastDays } from '../utils/dateUtils';
import { homeworkSubjectName } from '../utils/subjectDetector';
import { getHomeworkEntryId as getEntryId } from '../utils/homeworkEntryId';
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
  isRefreshing?: boolean;
  onRefresh: (force?: boolean) => void;
  completedMap: Record<string, boolean>;
  onToggleCompleted: (id: string) => void;
  onUpdateNote: (id: string, note: string | null) => void;
  onOpenPreview: (url: string, filename?: string) => void;
}

export const RecentView: React.FC<RecentViewProps> = ({
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

  const validHomework = useMemo(() => (Array.isArray(homework) ? homework.filter(Boolean) : []), [homework]);

  const recentAllEntries = useMemo(() => {
    return selectHomeworkFromLastDays(validHomework);
  }, [validHomework]);

  // Extract unique subjects
  const availableSubjects = useMemo(() => {
    return Array.from(new Set(recentAllEntries.map((item) => homeworkSubjectName(item))));
  }, [recentAllEntries]);

  // A stale selection (its subject vanished from the data) falls back to "All" instead of an empty, unfilterable list.
  const activeSubject = availableSubjects.includes(selectedSubject) ? selectedSubject : 'All';

  const filteredEntries = useMemo(() => {
    return activeSubject === 'All'
      ? recentAllEntries
      : recentAllEntries.filter((item) => homeworkSubjectName(item) === activeSubject);
  }, [recentAllEntries, activeSubject]);

  const { displayedItems, hasMore, isLoadingMore, loadMore, visibleCount, totalCount } = usePagination(filteredEntries, 25);

  // Group chronologically by date
  const grouped = useMemo(() => {
    const groups: { date: string; entries: HomeworkEntry[] }[] = [];
    const map = new Map<string, { date: string; entries: HomeworkEntry[] }>();
    for (const item of displayedItems) {
      const d = item.date || 'School Diary';
      let group = map.get(d);
      if (!group) {
        group = { date: d, entries: [] };
        map.set(d, group);
        groups.push(group);
      }
      group.entries.push(item);
    }
    return groups;
  }, [displayedItems]);
  const isContentLoading = isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recent homework"
        description="Homework from the last 7 days"
        actions={<RefreshButton onRefresh={() => onRefresh(true)} isRefreshing={isLoading || isRefreshing} />}
      />

      {/* Subject Filter Pills */}
      <SubjectFilterPills
        subjects={availableSubjects}
        selectedSubject={activeSubject}
        onSelectSubject={setSelectedSubject}
      />

      {isContentLoading ? (
        <LoadingSkeleton label="Loading recent homework…" />
      ) : grouped.length === 0 ? (
        <EmptyState type="recent" title="No recent homework" subtitle="There are no homework assignments matching your filter in the last 7 days." />
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
