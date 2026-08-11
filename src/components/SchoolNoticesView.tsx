import React from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  BellRing,
  CalendarDays,
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
    title: 'Announcements',
    description: 'Official announcements and circulars shared by the school through EduSecure.',
    emptyTitle: 'No announcements available',
    emptyDescription: 'New school announcements will appear here when they are published.',
    itemLabel: 'Announcement',
    Icon: ScrollText,
    iconClass: 'bg-sky-100/90 text-sky-700 ring-sky-200/80 dark:bg-sky-400/10 dark:text-sky-300 dark:ring-sky-400/15',
    badgeClass: 'bg-sky-100/80 text-sky-800 dark:bg-sky-400/10 dark:text-sky-200',
    markerClass: 'bg-sky-500 dark:bg-sky-400',
    glowClass: 'from-sky-100/65 via-sky-50/25 dark:from-sky-500/10 dark:via-sky-500/[0.03]',
    fileIconClass: 'bg-sky-50 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300',
    actionClass: 'text-sky-700 dark:text-sky-300',
  },
  important: {
    title: 'Important Messages',
    description: 'Priority school messages, kept separate from your personal chats.',
    emptyTitle: 'No important messages',
    emptyDescription: 'Important school updates will appear here when they are sent.',
    itemLabel: 'Important message',
    Icon: BellRing,
    iconClass: 'bg-amber-100/90 text-amber-800 ring-amber-200/80 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/15',
    badgeClass: 'bg-amber-100/80 text-amber-900 dark:bg-amber-400/10 dark:text-amber-200',
    markerClass: 'bg-amber-500 dark:bg-amber-400',
    glowClass: 'from-amber-100/70 via-amber-50/25 dark:from-amber-500/10 dark:via-amber-500/[0.03]',
    fileIconClass: 'bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300',
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
    <article className="group/card relative isolate overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-[0_10px_30px_rgba(0,0,0,0.07)] motion-reduce:transform-none dark:border-neutral-800/80 dark:bg-[#141417] dark:hover:border-neutral-700 dark:hover:shadow-black/20">
      <span className={cn('absolute inset-y-0 left-0 w-1', config.markerClass)} aria-hidden />
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-br to-transparent opacity-80',
          config.glowClass
        )}
        aria-hidden
      />

      <div className="relative p-4 pl-5 sm:p-5 sm:pl-6">
        <div className="flex items-start gap-3.5">
          <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-2xl ring-1', config.iconClass)}>
            <Icon className="size-5" strokeWidth={1.8} aria-hidden />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide', config.badgeClass)}>
                <span className={cn('size-1.5 rounded-full', config.markerClass)} aria-hidden />
                {notice.type || config.itemLabel}
              </span>
              {notice.date && (
                <time className="inline-flex items-center gap-1.5 text-[11px] font-medium tabular-nums text-neutral-500 dark:text-neutral-400">
                  <CalendarDays className="size-3.5 text-neutral-400 dark:text-neutral-500" aria-hidden />
                  {notice.date}
                </time>
              )}
            </div>

            {notice.title && (
              <h2 className="mt-3 text-base font-semibold leading-snug tracking-[-0.018em] text-neutral-950 dark:text-neutral-50 sm:text-[17px]">
                {notice.title}
              </h2>
            )}
            <p
              className={cn(
                'max-w-3xl whitespace-pre-wrap break-words text-[13px] leading-6 text-neutral-600 dark:text-neutral-300',
                notice.title ? 'mt-1.5' : 'mt-3'
              )}
            >
              {notice.content}
            </p>
          </div>
        </div>
      </div>

      {attachments.length > 0 && (
        <div className="relative border-t border-neutral-100 bg-neutral-50/65 px-4 py-3.5 pl-5 dark:border-neutral-800 dark:bg-neutral-950/25 sm:px-5 sm:pl-6">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.11em] text-neutral-500 dark:text-neutral-400">
              <Paperclip className="size-3" aria-hidden />
              {attachments.length === 1 ? 'File included' : `${attachments.length} files included`}
            </div>
            <span className="text-[10px] text-neutral-400 dark:text-neutral-500">Tap to preview</span>
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
                  className="group/file flex min-w-0 items-center gap-3 rounded-xl border border-neutral-200/90 bg-white p-2.5 text-left shadow-2xs transition-[border-color,background-color,box-shadow] hover:border-neutral-300 hover:bg-neutral-50 hover:shadow-sm active:bg-neutral-100 dark:border-neutral-800 dark:bg-[#141417] dark:hover:border-neutral-700 dark:hover:bg-neutral-800/60"
                >
                  <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', config.fileIconClass)}>
                    <AttachmentIcon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                      {name}
                    </span>
                    <span className="mt-0.5 block text-[10px] font-medium text-neutral-400 dark:text-neutral-500">
                      {extension === 'FILE' ? 'School attachment' : `${extension} file`}
                    </span>
                  </span>
                  <span className={cn('inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold', config.actionClass)}>
                    Open
                    <ArrowUpRight className="size-3.5 transition-transform group-hover/file:-translate-y-0.5 group-hover/file:translate-x-0.5" aria-hidden />
                  </span>
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
