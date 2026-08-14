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
    itemLabel: 'Circular',
    badgeClass: 'bg-sky-100/80 text-sky-800 dark:bg-sky-400/10 dark:text-sky-200',
    markerClass: 'bg-sky-500 dark:bg-sky-400',
    fileIconClass: 'bg-sky-50 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300',
    actionClass: 'text-sky-700 dark:text-sky-300',
  },
  important: {
    title: 'Important',
    description: 'Priority school messages, kept separate from your personal chats.',
    emptyTitle: 'No important updates',
    emptyDescription: 'Important school updates will appear here when they are sent.',
    itemLabel: 'Important',
    badgeClass: 'bg-amber-100/80 text-amber-900 dark:bg-amber-400/10 dark:text-amber-200',
    markerClass: 'bg-amber-500 dark:bg-amber-400',
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

// The school uses many casing and punctuation variants for the same greeting.
// This compact pattern covers those combinations without maintaining a brittle
// list of every capitalization, space, and hyphen permutation.
const NOTICE_GREETING = /^(\s*)(?:\*+\s*)?((?:dear\s+(?:students?|parents?|guardians?|families|teachers?|staff|members|everyone|all(?:\s+(?:students?|parents?|guardians?|members))?|students?\s+and\s+parents?|parents?\s+and\s+students?)|team\s+manav\s+mangal\s*(?:[-–—]\s*)?64)\s*[,;:!]*)/i;

function NoticeContent({ content }: { content: string }) {
  let canHighlightGreeting = true;
  const lines = content.split('\n');

  return (
    <>
      {lines.map((line, index) => {
        const match = canHighlightGreeting ? line.match(NOTICE_GREETING) : null;
        if (line.trim()) canHighlightGreeting = false;

        if (!match) {
          return (
            <React.Fragment key={index}>
              {line}
              {index < lines.length - 1 && '\n'}
            </React.Fragment>
          );
        }

        const greeting = match[2];
        const remainder = line.slice(match[0].length);
        return (
          <React.Fragment key={index}>
            {match[1]}
            <strong className="font-bold text-neutral-950 dark:text-white">{greeting}</strong>
            {remainder}
            {index < lines.length - 1 && '\n'}
          </React.Fragment>
        );
      })}
    </>
  );
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
          <h2 className="mt-2.5 text-sm font-semibold leading-snug tracking-tight text-neutral-950 dark:text-neutral-50 sm:text-[15px]">
            {notice.title}
          </h2>
        )}
        <p
          className={cn(
            'max-w-3xl whitespace-pre-wrap break-words text-xs leading-relaxed text-neutral-800 dark:text-neutral-100 sm:text-[13px]',
            notice.title ? 'mt-1' : 'mt-2.5'
          )}
        >
          <NoticeContent content={notice.content} />
        </p>
      </div>

      {attachments.length > 0 && (
        <div className="border-t border-neutral-100 bg-neutral-50/60 px-3.5 py-3 dark:border-neutral-800/80 dark:bg-neutral-950/20 sm:px-4">
          <div className="mb-2 flex items-center justify-between gap-3">
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
                  className="group/file flex min-w-0 items-center gap-2.5 rounded-lg border border-neutral-200/90 bg-white p-2.5 text-left transition-[border-color,background-color] hover:border-neutral-300 hover:bg-neutral-50 active:bg-neutral-100 dark:border-neutral-800 dark:bg-[#141417] dark:hover:border-neutral-700 dark:hover:bg-neutral-800/60"
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
