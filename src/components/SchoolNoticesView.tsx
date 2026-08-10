import React from 'react';
import {
  AlertCircle,
  BellRing,
  ChevronRight,
  File,
  FileArchive,
  FileImage,
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
    iconClass: 'bg-sky-50 text-sky-600 dark:bg-sky-400/10 dark:text-sky-300',
    badgeClass: 'bg-sky-50 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300',
    markerClass: 'bg-sky-500 dark:bg-sky-400',
  },
  important: {
    title: 'Important',
    description: 'Important school messages, kept separate from your personal chats.',
    emptyTitle: 'No important messages',
    emptyDescription: 'Important school updates will appear here when they are sent.',
    Icon: BellRing,
    iconClass: 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300',
    badgeClass: 'bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-200',
    markerClass: 'bg-amber-500 dark:bg-amber-400',
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

function attachmentDetails(name: string, url: string) {
  let searchable = `${name} ${url}`;
  try {
    searchable = decodeURIComponent(searchable);
  } catch {}
  const extension = searchable.match(/\.([a-z0-9]{1,8})(?:$|[?#\s])/i)?.[1]?.toUpperCase() || 'FILE';
  if (/^(?:PNG|JPG|JPEG|WEBP|GIF)$/.test(extension)) {
    return { extension, Icon: FileImage };
  }
  if (/^(?:ZIP|RAR|7Z)$/.test(extension)) {
    return { extension, Icon: FileArchive };
  }
  if (/^(?:PDF|DOC|DOCX|PPT|PPTX|XLS|XLSX|TXT)$/.test(extension)) {
    return { extension, Icon: FileText };
  }
  return { extension, Icon: File };
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
  const Icon = config.Icon;
  const attachments = attachmentList(notice);

  return (
    <article className="overflow-hidden rounded-2xl border border-neutral-200/80 bg-white transition-colors duration-150 hover:border-neutral-300 dark:border-neutral-800/80 dark:bg-[#141417] dark:hover:border-neutral-700">
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3.5">
          <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', config.iconClass)}>
            <Icon className="size-4.5" strokeWidth={1.8} aria-hidden />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold', config.badgeClass)}>
                <span className={cn('size-1.5 rounded-full', config.markerClass)} aria-hidden />
                {notice.type || config.title}
              </span>
              {notice.date && (
                <time className="text-[11px] font-medium tabular-nums text-neutral-400 dark:text-neutral-500">
                  {notice.date}
                </time>
              )}
            </div>

            {notice.title && (
              <h2 className="mt-3 text-[15px] font-semibold leading-snug tracking-[-0.015em] text-neutral-950 dark:text-neutral-50">
                {notice.title}
              </h2>
            )}
            <p
              className={cn(
                'whitespace-pre-wrap break-words text-[13px] leading-6 text-neutral-600 dark:text-neutral-300',
                notice.title ? 'mt-1.5' : 'mt-3'
              )}
            >
              {notice.content}
            </p>
          </div>
        </div>
      </div>

      {attachments.length > 0 && (
        <div className="border-t border-neutral-100 bg-neutral-50/70 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900/35 sm:px-5">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400 dark:text-neutral-500">
            <Paperclip className="size-3" aria-hidden />
            {attachments.length === 1 ? 'Attachment' : `${attachments.length} attachments`}
          </div>
          <div className={cn('grid gap-2', attachments.length > 1 && 'sm:grid-cols-2')}>
            {attachments.map((attachment, index) => {
              const name = attachment.name || `Attachment ${index + 1}`;
              const { extension, Icon: AttachmentIcon } = attachmentDetails(name, attachment.url);
              return (
                <button
                  key={`${attachment.url}-${index}`}
                  type="button"
                  onClick={() => onOpenPreview(attachment.url, name)}
                  aria-label={`Open attachment: ${name}`}
                  className="group/file flex min-w-0 items-center gap-3 rounded-xl border border-neutral-200/80 bg-white p-2.5 text-left transition-colors hover:border-neutral-300 hover:bg-neutral-50 active:bg-neutral-100 dark:border-neutral-800 dark:bg-[#141417] dark:hover:border-neutral-700 dark:hover:bg-neutral-800/60"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                    <AttachmentIcon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                      {name}
                    </span>
                    <span className="mt-0.5 block text-[10px] font-medium text-neutral-400 dark:text-neutral-500">
                      {extension} · Open preview
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-neutral-300 transition-transform group-hover/file:translate-x-0.5 group-hover/file:text-neutral-500 dark:text-neutral-600" aria-hidden />
                </button>
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
        <div className="max-w-4xl space-y-3" aria-live="polite">
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
