import React, { useRef, useState, useMemo, useEffect } from 'react';
import { HomeworkEntry, ClassworkEntry, SectionRequest } from '../types/homework';
import { formatToISODate } from '../utils/dateUtils';
import { detectSubject } from '../utils/subjectDetector';
import { usePagination } from '../hooks/usePagination';
import { classworkService, requestService } from '../services/api';
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
import { Handshake, Upload } from 'lucide-react';
import { cn } from '../utils/cn';

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
  userSection?: string;
  onNavigate?: (view: string) => void;
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
  userSection,
  onNavigate,
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [selectedSubject, setSelectedSubject] = useState<string>('All');
  const [classwork, setClasswork] = useState<ClassworkEntry[]>([]);
  const [requests, setRequests] = useState<SectionRequest[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cw, reqs] = await Promise.all([
          classworkService.getClasswork(userSection),
          requestService.getRequests(userSection),
        ]);
        if (!cancelled) {
          setClasswork(cw as ClassworkEntry[]);
          setRequests(reqs as SectionRequest[]);
        }
      } catch {
        // Search extras are best-effort.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userSection]);

  const validHomework = useMemo(() => (Array.isArray(homework) ? homework.filter(Boolean) : []), [homework]);

  const availableSubjects = useMemo(() => {
    return Array.from(new Set(validHomework.map((item) => detectSubject(item?.homework || '').name)));
  }, [validHomework]);

  const q = searchQuery.toLowerCase().trim();

  const filtered = useMemo(() => {
    let result = [...validHomework];

    if (selectedSubject !== 'All') {
      result = result.filter((item) => detectSubject(item?.homework || '').name === selectedSubject);
    }

    if (q) {
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
  }, [validHomework, selectedSubject, q, selectedDateFilter]);

  const matchedClasswork = useMemo(() => {
    if (!q) return [];
    return classwork.filter((item) => {
      const hay = [item.subject, item.title, item.originalFilename, item.filename, item.date, item.studentId]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [classwork, q]);

  const matchedRequests = useMemo(() => {
    if (!q) return [];
    return requests.filter((item) => {
      const hay = [item.title, item.content, item.category, item.studentId, item.status]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [requests, q]);

  const { displayedItems, hasMore, isLoadingMore, loadMore, visibleCount, totalCount } = usePagination(filtered, 25);

  const getEntryId = (item: HomeworkEntry) => {
    if (!item) return '';
    const d = item.date || '';
    const hw = item.homework || '';
    return item.id || `${d}_${detectSubject(hw).name}_${hw.slice(0, 30)}`;
  };

  const grouped: { date: string; entries: HomeworkEntry[] }[] = [];
  const map = new Map<string, { date: string; entries: HomeworkEntry[] }>();

  for (const item of displayedItems) {
    const d = item.date || 'School Diary';
    if (!map.has(d)) {
      const groupObj = { date: d, entries: [] as HomeworkEntry[] };
      map.set(d, groupObj);
      grouped.push(groupObj);
    }
    map.get(d)!.entries.push(item);
  }

  const hasAnyResults =
    grouped.length > 0 || matchedClasswork.length > 0 || matchedRequests.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Search"
        description="Find homework, classwork, and requests in one place"
        actions={<RefreshButton onRefresh={() => onRefresh(true)} isRefreshing={isLoading} />}
      />

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <SearchBar value={searchQuery} onChange={onSearchChange} inputRef={searchInputRef} />
        <DateFilter value={selectedDateFilter} onChange={onDateFilterChange} />
      </div>

      <SubjectFilterPills
        subjects={availableSubjects}
        selectedSubject={selectedSubject}
        onSelectSubject={setSelectedSubject}
      />

      {isLoading ? (
        <LoadingSkeleton />
      ) : !hasAnyResults ? (
        <EmptyState
          type="search"
          title={q ? 'Nothing matched' : 'No homework found'}
          subtitle={
            q
              ? 'Try another word — search covers homework, classwork, and requests.'
              : 'No homework entries match your filters.'
          }
        />
      ) : (
        <div className="space-y-8 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
          {grouped.length > 0 && (
            <div className="space-y-6">
              {q && (
                <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
                  Homework
                  <span className="tabular-nums normal-case tracking-normal font-medium">({filtered.length})</span>
                </h2>
              )}
              {grouped.map((group, gIdx) => (
                <section key={gIdx} className="space-y-3">
                  <DateHeader dateStr={group.date} count={group.entries.length} />
                  <div className="space-y-2.5">
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

              <LoadMoreButton
                hasMore={hasMore}
                isLoadingMore={isLoadingMore}
                onLoadMore={loadMore}
                visibleCount={visibleCount}
                totalCount={totalCount}
              />
            </div>
          )}

          {matchedClasswork.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
                <Upload className="w-3.5 h-3.5" /> Classwork
                <span className="tabular-nums normal-case tracking-normal font-medium">({matchedClasswork.length})</span>
              </h2>
              <div className="space-y-2">
                {matchedClasswork.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (item.fileUrl && onOpenPreview) onOpenPreview(item.fileUrl);
                      else onNavigate?.('classwork');
                    }}
                    className={cn(
                      'w-full text-left rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#141417] p-3.5',
                      'hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors cursor-pointer'
                    )}
                  >
                    <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">{item.subject}</p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 line-clamp-2">
                      {item.title || item.originalFilename || item.filename || 'Classwork file'}
                    </p>
                  </button>
                ))}
              </div>
            </section>
          )}

          {matchedRequests.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
                <Handshake className="w-3.5 h-3.5" /> Requests
                <span className="tabular-nums normal-case tracking-normal font-medium">({matchedRequests.length})</span>
              </h2>
              <div className="space-y-2">
                {matchedRequests.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onNavigate?.('requests')}
                    className={cn(
                      'w-full text-left rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#141417] p-3.5',
                      'hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors cursor-pointer'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50 truncate">{item.title}</p>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-400 shrink-0">
                        {item.status}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 line-clamp-2">{item.content}</p>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      <ScrollToTopButton />
    </div>
  );
};
