import React, { useState } from 'react';
import { Eye } from 'lucide-react';
import { cn } from '../utils/cn';
import { AnimatedIcon } from './ui/animated-icon';
import { AttachFileIcon } from './ui/attach-file';

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
  const [isAnimated, setIsAnimated] = useState(false);
  const detail = attachmentDetails(name, url, fallbackDetail);

  const replayAnimation = () => {
    setIsAnimated(false);
    requestAnimationFrame(() => setIsAnimated(true));
  };

  return (
    <button
      type="button"
      onClick={() => {
        replayAnimation();
        onOpenPreview(url, name);
      }}
      onMouseEnter={() => setIsAnimated(true)}
      onMouseLeave={() => setIsAnimated(false)}
      onFocus={() => setIsAnimated(true)}
      onBlur={() => setIsAnimated(false)}
      onPointerDown={replayAnimation}
      aria-label={`Open attachment: ${name}`}
      className="group/file flex w-full min-w-0 items-center gap-2.5 py-2 text-left transition-colors hover:text-neutral-950 active:bg-neutral-50 dark:hover:text-white dark:active:bg-neutral-900/40"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300">
        <AttachFileIcon size={15} isAnimated={isAnimated} aria-hidden />
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
          'inline-flex shrink-0 items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
          actionClassName
        )}
      >
        Preview
        <AnimatedIcon icon={Eye} preset="zoom" size={12} isActive={isAnimated} aria-hidden />
      </span>
    </button>
  );
};
