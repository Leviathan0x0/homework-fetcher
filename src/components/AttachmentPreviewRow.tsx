import React from 'react';
import { cn } from '../utils/cn';
import { Reicon } from './ui/reicon';
import { FolderIcon } from './FolderIcon';

interface AttachmentPreviewRowProps {
  url: string;
  name: string;
  onOpenPreview: (url: string, filename?: string) => void;
  actionClassName?: string;
  iconColorClassName?: string;
  iconPrimaryColor?: string;
  iconSecondaryColor?: string;
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

const FOLDER_PALETTES: Record<string, readonly [string, string]> = {
  sky: ['#4fb6e5', '#3ea1d4'],
  emerald: ['#10b981', '#2dc992'],
  amber: ['#f59e0b', '#eaa718'],
  rose: ['#f43f5e', '#ef5e72'],
  indigo: ['#6366f1', '#7d8cf2'],
  violet: ['#8b5cf6', '#a294f7'],
  purple: ['#a855f7', '#b892f8'],
  orange: ['#f97316', '#f59652'],
  lime: ['#84cc16', '#a0d846'],
  teal: ['#14b8a6', '#3cd1b7'],
  blue: ['#3b82f6', '#6ea5f6'],
  green: ['#22c55e', '#5fd98b'],
  cyan: ['#06b6d4', '#3fcbe6'],
  red: ['#ef4444', '#ea7d7d'],
  fuchsia: ['#d946ef', '#d486f0'],
  pink: ['#ec4899', '#e585b8'],
  slate: ['#64748b', '#94a3b0'],
};

function folderPalette(iconColorClassName?: string) {
  const paletteName = Object.keys(FOLDER_PALETTES).find((name) =>
    iconColorClassName?.includes(`${name}-`)
  );
  return FOLDER_PALETTES[paletteName || 'sky'];
}

export const AttachmentPreviewRow: React.FC<AttachmentPreviewRowProps> = ({
  url,
  name,
  onOpenPreview,
  actionClassName,
  iconColorClassName,
  iconPrimaryColor,
  iconSecondaryColor,
  fallbackDetail = 'Attachment file',
}) => {
  const detail = attachmentDetails(name, url, fallbackDetail);
  const [defaultPrimaryColor, defaultSecondaryColor] = folderPalette(iconColorClassName);

  return (
    <button
      type="button"
      onClick={() => onOpenPreview(url, name)}
      aria-label={`Open attachment: ${name}`}
      className="group/file flex w-full min-w-0 cursor-pointer items-center gap-2.5 py-2 text-left transition-colors duration-200 hover:text-neutral-950 dark:hover:text-white"
    >
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300',
          iconColorClassName
        )}
      >
        <FolderIcon
          className="size-6"
          primaryColor={iconPrimaryColor || defaultPrimaryColor}
          secondaryColor={iconSecondaryColor || defaultSecondaryColor}
        />
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
