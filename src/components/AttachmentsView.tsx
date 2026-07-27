import React from 'react';
import { HomeworkEntry } from '../types/homework';
import { detectSubject } from '../utils/subjectDetector';
import { HomeworkCard } from './HomeworkCard';
import { EmptyState } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';
import { PageHeader } from './PageHeader';
import { RefreshButton } from './RefreshButton';

interface AttachmentsViewProps {
  homework: HomeworkEntry[];
  isLoading: boolean;
  onRefresh: (force?: boolean) => void;
  completedMap: Record<string, boolean>;
  onToggleCompleted: (id: string) => void;
  onUpdateNote?: (id: string, note: string | null) => void;
  onOpenPreview?: (url: string) => void;
}

export const AttachmentsView: React.FC<AttachmentsViewProps> = ({
  homework,
  isLoading,
  onRefresh,
  completedMap,
  onToggleCompleted,
  onUpdateNote,
  onOpenPreview,
}) => {
  const validHomework = Array.isArray(homework) ? homework.filter(Boolean) : [];
  const attachmentEntries = validHomework.filter((item) => Boolean(item?.attachment));

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
        actions={<RefreshButton onRefresh={() => onRefresh(true)} isRefreshing={isLoading} />}
      />

      {isLoading ? (
        <LoadingSkeleton />
      ) : attachmentEntries.length === 0 ? (
        <EmptyState type="attachments" />
      ) : (
        <div className="space-y-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
          {attachmentEntries.map((item, idx) => {
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
