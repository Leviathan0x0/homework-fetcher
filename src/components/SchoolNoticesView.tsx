import React from 'react';
import {
  AlertCircle,
  BellRing,
  FileText,
  Paperclip,
  ScrollText,
} from 'lucide-react';
import { EmptyState } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';
import { PageHeader } from './PageHeader';
import { RefreshButton } from './RefreshButton';
import { useSchoolNotices } from '../hooks/useSchoolNotices';
import { SchoolNotice, SchoolNoticeKind } from '../types/homework';
import { cn } from '../utils/cn';

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
    Icon: ScrollText,
    iconClass: 'bg-sky-500/10 text-sky-600 dark:bg-sky-400/10 dark:text-sky-300',
    badgeClass: 'bg-sky-500/10 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300',
    accentClass: 'bg-sky-500 dark:bg-sky-400',
  },
  important: {
    title: 'Important',
    description: 'Important school messages, kept separate from your personal chats.',
    emptyTitle: 'No important messages',
    emptyDescription: 'Important school updates will appear here when they are sent.',
    Icon: BellRing,
    iconClass: 'bg-amber-500/12 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300',
    badgeClass: 'bg-amber-500/12 text-amber-800 dark:bg-amber-400/10 dark:text-amber-200',
    accentClass: 'bg-amber-500 dark:bg-amber-400',
  },
} as const;

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
  const Icon = config.Icon;

  return (
    <article className="group relative overflow-hidden rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-2xs transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md dark:border-neutral-800/80 dark:bg-[#141417] dark:hover:border-neutral-700 sm:p-5">
      <span className={cn('absolute inset-y-0 left-0 w-1', config.accentClass)} aria-hidden />
      <div className="flex items-start gap-3.5">
        <div className={cn('hidden size-9 shrink-0 items-center justify-center rounded-xl sm:flex', config.iconClass)}>
          <Icon className="size-4.5" aria-hidden />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <span className={cn('inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold', config.badgeClass)}>
              {notice.type || config.title}
            </span>
            {notice.date && (
              <time className="text-[11px] font-medium tabular-nums text-neutral-400 dark:text-neutral-500">
                {notice.date}
              </time>
            )}
          </div>

          {notice.title && (
            <h2 className="mt-3 text-sm font-semibold tracking-[-0.01em] text-neutral-950 dark:text-neutral-50">
              {notice.title}
            </h2>
          )}
          <p
            className={cn(
              'whitespace-pre-wrap break-words text-[13px] leading-6 text-neutral-700 dark:text-neutral-300',
              notice.title ? 'mt-1.5' : 'mt-3'
            )}
          >
            {notice.content}
          </p>

          {notice.attachment && (
            <div className="mt-4 border-t border-neutral-100 pt-3 dark:border-neutral-800/80">
              <button
                type="button"
                onClick={() =>
                  onOpenPreview(
                    notice.attachment!,
                    notice.attachmentName || undefined
                  )
                }
                className="inline-flex max-w-full items-center gap-2 rounded-xl bg-neutral-100 px-3 py-2 text-[11px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-200 hover:text-neutral-950 active:scale-[0.98] dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-white"
              >
                <Paperclip className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">
                  {notice.attachmentName || 'View attachment'}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export const SchoolNoticesView: React.FC<SchoolNoticesViewProps> = ({
  kind,
  onOpenPreview,
}) => {
  const config = VIEW_CONFIG[kind];
  const { notices, isLoading, error, reload } = useSchoolNotices(kind);

  return (
    <div className="space-y-5">
      <PageHeader
        title={config.title}
        description={config.description}
        badge={
          notices.length > 0 ? (
            <span className={cn('rounded-full px-2.5 py-1 text-[10px] font-semibold tabular-nums', config.badgeClass)}>
              {notices.length} {notices.length === 1 ? 'update' : 'updates'}
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
        <div className="space-y-3" aria-live="polite">
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
