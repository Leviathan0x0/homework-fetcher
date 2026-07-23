import React, { useRef, useState } from 'react';
import { HomeworkEntry } from '../types/homework';
import { formatToISODate } from '../utils/dateUtils';
import { detectSubject } from '../utils/subjectDetector';
import { HomeworkCard } from './HomeworkCard';
import { DateHeader } from './DateHeader';
import { SearchBar } from './SearchBar';
import { DateFilter } from './DateFilter';
import { SubjectFilterPills } from './SubjectFilterPills';
import { EmptyState } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';
import { RefreshCw } from 'lucide-react';

interface AllHomeworkViewProps {
  homework: HomeworkEntry[];
  isLoading: boolean;
  onRefresh: (force?: boolean) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedDateFilter: string;
  onDateFilterChange: (d: string) => void;
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

  // Extract unique subjects
  const availableSubjects = Array.from(
    new Set(homework.map((item) => detectSubject(item.homework).name))
  );

  // Apply filters
  let filtered = [...homework];

  if (selectedSubject !== 'All') {
    filtered = filtered.filter((item) => detectSubject(item.homework).name === selectedSubject);
  }

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    filtered = filtered.filter((item) => {
      const subject = detectSubject(item.homework).name.toLowerCase();
      const noteStr = (item.note || '').toLowerCase();
      return (
        item.homework.toLowerCase().includes(q) ||
        subject.includes(q) ||
        item.date.toLowerCase().includes(q) ||
        noteStr.includes(q) ||
        (item.type && item.type.toLowerCase().includes(q))
      );
    });
  }

  if (selectedDateFilter) {
    filtered = filtered.filter((item) => formatToISODate(item.date) === selectedDateFilter);
  }

  const getEntryId = (item: HomeworkEntry) =>
    item.id || `${item.date}_${detectSubject(item.homework).name}_${item.homework.slice(0, 30)}`;

  // Group chronologically by date
  const grouped: { date: string; entries: HomeworkEntry[] }[] = [];
  const map = new Map<string, { date: string; entries: HomeworkEntry[] }>();

  for (const item of filtered) {
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
      {/* Header */}
      <div className="flex items-end justify-between border-b border-neutral-200/60 dark:border-neutral-800/60 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50 tracking-tight">
            All homework
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 font-medium">
            Search and filter all assignments
          </p>
        </div>

        <button
          onClick={() => onRefresh(true)}
          disabled={isLoading}
          className="group/ref inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#141417] text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors duration-150 shadow-2xs cursor-pointer active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 transition-transform duration-300 ${isLoading ? 'animate-spin' : 'group-hover/ref:rotate-180'}`} />
          <span>Refresh</span>
        </button>
      </div>

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
        </div>
      )}
    </div>
  );
};
