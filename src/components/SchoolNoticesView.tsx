import React from 'react';
import {
  AlertCircle,
  BellRing,
  FileText,
} from 'lucide-react';
import { EmptyState } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';
import { PageHeader } from './PageHeader';
import { RefreshButton } from './RefreshButton';
import { useSchoolNotices } from '../hooks/useSchoolNotices';
import { SchoolNotice, SchoolNoticeKind } from '../types/homework';
import { cn } from '../utils/cn';
import { MarkdownRenderer } from './MarkdownRenderer';
import { CalendarDaysIcon } from './ui/calendar-days';
import { formatNoticeContent } from '../utils/noticeFormatting';
import { AttachmentPreviewRow } from './AttachmentPreviewRow';

interface SchoolNoticesViewProps {
  kind: SchoolNoticeKind;
  onOpenPreview: (url: string, filename?: string) => void;
}

const VIEW_CONFIG = {
  circulars: {
    title: 'Circulars',
    description: 'Official circulars shared by the school through EduSecure.',
    emptyTitle: 'No circulars available',
    emptyDescription: 'New school circulars will appear here when they are published.',
    itemLabel: 'Circular',
    badgeClass: 'bg-sky-100/80 text-sky-800 dark:bg-sky-400/10 dark:text-sky-200',
    actionClass: 'text-sky-700 dark:text-sky-300',
  },
  important: {
    title: 'Important',
    description: 'Priority school messages, kept separate from your personal chats.',
    emptyTitle: 'No important updates',
    emptyDescription: 'Important school updates will appear here when they are sent.',
    itemLabel: 'Important',
    badgeClass: 'bg-amber-100/80 text-amber-900 dark:bg-amber-400/10 dark:text-amber-200',
    actionClass: 'text-amber-800 dark:text-amber-300',
  },
} as const;

function attachmentList(notice: SchoolNotice) {
  if (Array.isArray(notice.attachments) && notice.attachments.length > 0) {
    return notice.attachments.filter((item) => Boolean(item?.url));
  }
  return notice.attachment
    ? [{ url: notice.attachment, name: notice.attachmentName || null }]
    : [];
}

function NoticeCard({
  notice,
  kind,
  onOpenPreview,
}: {
  notice: SchoolNotice;
  kind: SchoolNoticeKind;
  onOpenPreview: (url: string, filename?: string) => void;
}) {
  const config = VIEW_CONFIG[kind];
  const attachments = attachmentList(notice);

  return (
    <article className="group/card overflow-hidden rounded-xl border border-neutral-200/80 bg-white shadow-2xs transition-[border-color,box-shadow] duration-200 hover:border-neutral-300 hover:shadow-md dark:border-neutral-800/80 dark:bg-[#141417] dark:hover:border-neutral-700">
      <div className="p-3.5 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold', config.badgeClass)}>
            {notice.type || config.itemLabel}
          </span>
          {notice.date && (
            <time className="inline-flex items-center gap-1.5 text-[11px] font-medium tabular-nums text-neutral-500 dark:text-neutral-400">
              <CalendarDaysIcon size={14} className="text-neutral-400 dark:text-neutral-500" aria-hidden />
              {notice.date}
            </time>
          )}
        </div>

        {notice.title && (
          <h2 className="mt-2.5 text-sm font-semibold leading-snug tracking-tight text-neutral-950 dark:text-neutral-50 sm:text-[15px]">
            {notice.title}
          </h2>
        )}
        <MarkdownRenderer
          content={formatNoticeContent(notice.content)}
          className={cn(
            'max-w-3xl whitespace-pre-wrap break-words text-xs leading-relaxed text-neutral-900 dark:text-neutral-100 sm:text-[13px]',
            notice.title ? 'mt-1' : 'mt-2.5'
          )}
        />
      </div>

      {attachments.length > 0 && (
        <div className="border-t border-neutral-100 px-3.5 py-2 dark:border-neutral-800/80 sm:px-4">
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800/80">
            {attachments.map((attachment, index) => {
              const name = attachment.name || `Attachment ${index + 1}`;
              return (
                <AttachmentPreviewRow
                  key={`${attachment.url}-${index}`}
                  url={attachment.url}
                  name={name}
                  onOpenPreview={onOpenPreview}
                  actionClassName={config.actionClass}
                  fallbackDetail="School attachment"
                />
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
}

export const SchoolNoticesView: React.FC<SchoolNoticesViewProps> = ({
  kind,
  onOpenPreview,
}) => {
  const config = VIEW_CONFIG[kind];
  const { notices, recentCount, isLoading, error, reload } = useSchoolNotices(kind);

  return (
    <div className="space-y-5">
      <PageHeader
        title={config.title}
        description={config.description}
        badge={
          recentCount > 0 ? (
            <span className={cn('rounded-full px-2.5 py-1 text-[10px] font-semibold tabular-nums', config.badgeClass)}>
              {recentCount} {recentCount === 1 ? 'update' : 'updates'}
            </span>
          ) : undefined
        }
        actions={
          <RefreshButton
            onRefresh={() => reload(true)}
            isRefreshing={isLoading}
            compact
            label="school updates"
          />
        }
      />

      {error && notices.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/80 px-3.5 py-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{error} The last loaded updates are still shown.</span>
        </div>
      )}

      {isLoading && notices.length === 0 ? (
        <LoadingSkeleton count={3} label={`Loading ${config.title.toLowerCase()}…`} />
      ) : error && notices.length === 0 ? (
        <EmptyState
          icon={AlertCircle}
          title={`Could not load ${config.title.toLowerCase()}`}
          description={error}
          action={
            <button
              type="button"
              onClick={() => reload(true)}
              className="rounded-xl bg-neutral-900 px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-85 dark:bg-white dark:text-neutral-900"
            >
              Try again
            </button>
          }
        />
      ) : notices.length === 0 ? (
        <EmptyState
          icon={kind === 'circulars' ? FileText : BellRing}
          title={config.emptyTitle}
          description={config.emptyDescription}
        />
      ) : (
        <div className="max-w-5xl space-y-3.5" aria-live="polite">
          {notices.map((notice) => (
            <NoticeCard
              key={notice.id}
              notice={notice}
              kind={kind}
              onOpenPreview={onOpenPreview}
            />
          ))}
        </div>
      )}
    </div>
  );
};
