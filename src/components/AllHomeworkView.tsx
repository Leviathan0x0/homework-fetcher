import React, { useRef, useState, useMemo } from 'react';
import { HomeworkEntry } from '../types/homework';
import { formatToISODate } from '../utils/dateUtils';
import { detectSubject } from '../utils/subjectDetector';
import { usePagination } from '../hooks/usePagination';
import { HomeworkCard } from './HomeworkCard';
import { DateHeader } from './DateHeader';
import { SearchBar } from './SearchBar';
import { DateFilter } from './DateFilter';
import { SubjectFilterPills } from './SubjectFilterPills';
import { EmptyState } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';
import { PageHeader } from './PageHeader';
import { RefreshButton } from './RefreshButton';
import { LoadMoreButton } from './LoadMoreButton';
import { ScrollToTopButton } from './ScrollToTopButton';

interface AllHomeworkViewProps {
  homework: HomeworkEntry[];
  isLoading: boolean;
  onRefresh: (force?: boolean) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedDateFilter: string;
  onDateFilterChange: (date: string) => void;
  completedMap: Record<string, boolean>;
  onToggleCompleted: (id: string) => void;
  onUpdateNote?: (id: string, note: string | null) => void;
  onOpenPreview?: (url: string) => void;
}

export const AllHomeworkView: React.FC<AllHomeworkViewProps> = ({
  homework,
  isLoading,
  onRefresh,
  searchQuery,
  onSearchChange,
  selectedDateFilter,
  onDateFilterChange,
  completedMap,
  onToggleCompleted,
  onUpdateNote,
  onOpenPreview,
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [selectedSubject, setSelectedSubject] = useState<string>('All');

  const validHomework = useMemo(() => (Array.isArray(homework) ? homework.filter(Boolean) : []), [homework]);

  // Extract unique subjects
  const availableSubjects = useMemo(() => {
    return Array.from(new Set(validHomework.map((item) => detectSubject(item?.homework || '').name)));
  }, [validHomework]);

  // Apply filters
  const filtered = useMemo(() => {
    let result = [...validHomework];

    if (selectedSubject !== 'All') {
      result = result.filter((item) => detectSubject(item?.homework || '').name === selectedSubject);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((item) => {
        const hwText = item?.homework || '';
        const dateText = item?.date || '';
        const subject = detectSubject(hwText).name.toLowerCase();
        const noteStr = (item?.note || '').toLowerCase();
        return (
          hwText.toLowerCase().includes(q) ||
          subject.includes(q) ||
          dateText.toLowerCase().includes(q) ||
          noteStr.includes(q) ||
          (item?.type && item.type.toLowerCase().includes(q))
        );
      });
    }

    if (selectedDateFilter) {
      result = result.filter((item) => formatToISODate(item?.date) === selectedDateFilter);
    }

    return result;
  }, [validHomework, selectedSubject, searchQuery, selectedDateFilter]);

  // Batch loading (25 items per batch)
  const { displayedItems, hasMore, isLoadingMore, loadMore, visibleCount, totalCount } = usePagination(filtered, 25);

  const getEntryId = (item: HomeworkEntry) => {
    if (!item) return '';
    const d = item.date || '';
    const hw = item.homework || '';
    return item.id || `${d}_${detectSubject(hw).name}_${hw.slice(0, 30)}`;
  };

  // Group chronologically by date for displayed batch
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
        title="All homework"
        description="Search and filter all assignments"
        actions={<RefreshButton onRefresh={() => onRefresh(true)} isRefreshing={isLoading} />}
      />

      {/* Controls Bar: Search & Date Filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <SearchBar value={searchQuery} onChange={onSearchChange} inputRef={searchInputRef} />
        <DateFilter value={selectedDateFilter} onChange={onDateFilterChange} />
      </div>

      {/* Subject Filter Pills */}
      <SubjectFilterPills
        subjects={availableSubjects}
        selectedSubject={selectedSubject}
        onSelectSubject={setSelectedSubject}
      />

      {isLoading ? (
        <LoadingSkeleton />
      ) : grouped.length === 0 ? (
        <EmptyState type="search" title="No homework found" subtitle="No homework entries match your search or filters." />
      ) : (
        <div className="space-y-8 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
          {grouped.map((group, gIdx) => (
            <section key={gIdx} className="space-y-3">
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
