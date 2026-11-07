import React, { useMemo, useState } from 'react';
import { HomeworkEntry } from '../types/homework';
import { homeworkSubjectName as subjectOf } from '../utils/subjectDetector';
import { getHomeworkEntryId as getEntryId } from '../utils/homeworkEntryId';
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
  const attachmentEntries = useMemo(
    () => (Array.isArray(homework) ? homework : []).filter((item) => Boolean(item?.attachment)),
    [homework]
  );
  const isContentLoading = isLoading;

  const [selectedSubject, setSelectedSubject] = useState<string>('All');

  const availableSubjects = useMemo(
    () => Array.from(new Set(attachmentEntries.map(subjectOf))),
    [attachmentEntries]
  );

  // A stale selection (its subject vanished from the data) falls back to "All" instead of an empty, unfilterable list.
  const activeSubject = availableSubjects.includes(selectedSubject) ? selectedSubject : 'All';

  const visibleEntries = useMemo(
    () =>
      activeSubject === 'All'
        ? attachmentEntries
        : attachmentEntries.filter((item) => subjectOf(item) === activeSubject),
    [attachmentEntries, activeSubject]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attachments"
        description="Downloadable files and resources"
        actions={<RefreshButton onRefresh={() => onRefresh(true)} isRefreshing={isLoading || isRefreshing} />}
      />

      <SubjectFilterPills
        subjects={availableSubjects}
        selectedSubject={activeSubject}
        onSelectSubject={setSelectedSubject}
      />

      {isContentLoading ? (
        <LoadingSkeleton label="Loading attachments…" />
      ) : visibleEntries.length === 0 ? (
        activeSubject !== 'All' ? (
          <EmptyState
            type="attachments"
            title={`No ${activeSubject} attachments`}
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
