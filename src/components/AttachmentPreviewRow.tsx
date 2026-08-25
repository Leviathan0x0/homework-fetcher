import React from 'react';
import { cn } from '../utils/cn';
import { Reicon } from './ui/reicon';

interface AttachmentPreviewRowProps {
  url: string;
  name: string;
  onOpenPreview: (url: string, filename?: string) => void;
  actionClassName?: string;
  fallbackDetail?: string;
}

function attachmentDetails(name: string, url: string, fallbackDetail: string) {
  let searchable = `${name} ${url}`;
  try {
    searchable = decodeURIComponent(searchable);
  } catch {}

  const extension = searchable.match(/\.([a-z0-9]{1,8})(?:$|[?#\s])/i)?.[1]?.toUpperCase() || 'FILE';
  if (/^(?:PNG|JPG|JPEG|WEBP|GIF)$/.test(extension)) {
    return `${extension} image`;
  }
  return extension === 'FILE' ? fallbackDetail : `${extension} file`;
}

export const AttachmentPreviewRow: React.FC<AttachmentPreviewRowProps> = ({
  url,
  name,
  onOpenPreview,
  actionClassName,
  fallbackDetail = 'Attachment file',
}) => {
  const detail = attachmentDetails(name, url, fallbackDetail);

  return (
    <button
      type="button"
      onClick={() => onOpenPreview(url, name)}
      aria-label={`Open attachment: ${name}`}
      className="group/file flex w-full min-w-0 cursor-pointer items-center gap-2.5 py-2 text-left transition-colors duration-200 hover:text-neutral-950 dark:hover:text-white"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300">
        <Reicon name="paperclip" size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-neutral-800 dark:text-neutral-200">
          {name}
        </span>
        <span className="mt-0.5 block text-[10px] font-medium text-neutral-400 dark:text-neutral-500">
          {detail}
        </span>
      </span>
      <span
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-semibold text-neutral-700 transition-colors duration-200 group-hover/file:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:group-hover/file:bg-neutral-700',
          actionClassName
        )}
      >
        <span>Preview</span>
        <Reicon name="eye" size={12} preset="scale" className="opacity-70 group-hover/file:opacity-100" />
      </span>
    </button>
  );
};
