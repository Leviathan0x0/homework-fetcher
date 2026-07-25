import React, { useState } from 'react';
import { HomeworkEntry } from '../types/homework';
import { isTodayDate, formatContextualDate } from '../utils/dateUtils';
import { detectSubject } from '../utils/subjectDetector';
import { HomeworkCard } from './HomeworkCard';
import { SubjectFilterPills } from './SubjectFilterPills';
import { EmptyState } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';
import { PageHeader } from './PageHeader';
import { RefreshButton } from './RefreshButton';

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
}

export const TodayView: React.FC<TodayViewProps> = ({
  homework,
  isLoading,
  isRefreshing,
  onRefresh,
  lastUpdated,
  completedMap,
  onToggleCompleted,
  onUpdateNote,
  onOpenPreview,
}) => {
  const [selectedSubject, setSelectedSubject] = useState<string>('All');

  const todayAllEntries = homework.filter((item) => isTodayDate(item.date));

  // Extract unique subjects for subject filter pills
  const availableSubjects = Array.from(
    new Set(todayAllEntries.map((item) => detectSubject(item.homework).name))
  );

  // Apply Subject Filter
  const todayEntries = selectedSubject === 'All'
    ? todayAllEntries
    : todayAllEntries.filter((item) => detectSubject(item.homework).name === selectedSubject);

  const getEntryId = (item: HomeworkEntry) =>
    item.id || `${item.date}_${detectSubject(item.homework).name}_${item.homework.slice(0, 30)}`;

  const dateStr = formatContextualDate();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Today's homework"
        description={dateStr}
        actions={
          <RefreshButton
            onRefresh={() => onRefresh(true)}
            isRefreshing={isLoading || isRefreshing}
          />
        }
      />

      {/* Subject Filter Pills */}
      <SubjectFilterPills
        subjects={availableSubjects}
        selectedSubject={selectedSubject}
        onSelectSubject={setSelectedSubject}
      />

      {/* Main Content List */}
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
                isCompleted={Boolean(completedMap[entryId]) || item.completed === true}
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
