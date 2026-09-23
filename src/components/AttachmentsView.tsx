import React, { useState } from 'react';
import { HomeworkEntry } from '../types/homework';
import { detectSubject } from '../utils/subjectDetector';
import { HomeworkCard } from './HomeworkCard';
import { EmptyState } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';
import { PageHeader } from './PageHeader';
import { RefreshButton } from './RefreshButton';
import { SubjectFilterPills } from './SubjectFilterPills';

interface AttachmentsViewProps {
  homework: HomeworkEntry[];
  isLoading: boolean;
  isRefreshing?: boolean;
  onRefresh: (force?: boolean) => void;
  completedMap: Record<string, boolean>;
  onToggleCompleted: (id: string) => void;
  onUpdateNote?: (id: string, note: string | null) => void;
  onOpenPreview?: (url: string, filename?: string) => void;
}

export const AttachmentsView: React.FC<AttachmentsViewProps> = ({
  homework,
  isLoading,
  isRefreshing,
  onRefresh,
  completedMap,
  onToggleCompleted,
  onUpdateNote,
  onOpenPreview,
}) => {
  const validHomework = Array.isArray(homework) ? homework.filter(Boolean) : [];
  const attachmentEntries = validHomework.filter((item) => Boolean(item?.attachment));
  const isContentLoading = isLoading;

  const [selectedSubject, setSelectedSubject] = useState<string>('All');

  const subjectOf = (item: HomeworkEntry) =>
    detectSubject(item?.homework || '', item?.subject, item?.type).name;

  const availableSubjects = Array.from(new Set(attachmentEntries.map(subjectOf)));

  const visibleEntries =
    selectedSubject === 'All'
      ? attachmentEntries
      : attachmentEntries.filter((item) => subjectOf(item) === selectedSubject);

  const getEntryId = (item: HomeworkEntry) => {
    if (!item) return '';
    const d = item.date || '';
    const hw = item.homework || '';
    return item.id || `${d}_${detectSubject(hw).name}_${hw.slice(0, 30)}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attachments"
        description="Downloadable files and resources"
        actions={<RefreshButton onRefresh={() => onRefresh(true)} isRefreshing={isLoading || isRefreshing} />}
      />

      <SubjectFilterPills
        subjects={availableSubjects}
        selectedSubject={selectedSubject}
        onSelectSubject={setSelectedSubject}
      />

      {isContentLoading ? (
        <LoadingSkeleton label="Loading attachments…" />
      ) : visibleEntries.length === 0 ? (
        selectedSubject !== 'All' ? (
          <EmptyState
            type="attachments"
            title={`No ${selectedSubject} attachments`}
            subtitle="Try another subject or clear the filter."
          />
        ) : (
          <EmptyState type="attachments" />
        )
      ) : (
        <div className="space-y-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
          {visibleEntries.map((item, idx) => {
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
      )}
    </div>
  );
};
