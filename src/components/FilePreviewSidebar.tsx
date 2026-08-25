import React, { useEffect, useState } from 'react';
import { AuthenticatedImage } from './AuthenticatedImage';
import { Reicon } from './ui/reicon';
import { WanderingEyes } from "@/components/loading-ui/wandering-eyes";

interface FilePreviewSidebarProps {
  fileUrl: string | null;
  onClose: () => void;
  originalFilename?: string | null;
}

const isValidUrl = (url: string | null | undefined): boolean => {
  if (!url) return false;
  if (url.startsWith('/')) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

export const FilePreviewSidebar: React.FC<FilePreviewSidebarProps> = ({ fileUrl, onClose, originalFilename }) => {
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const handlePreviewLoaded = () => setLoading(false);

  useEffect(() => {
    setZoom(1);
    setLoading(true);
  }, [fileUrl]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!fileUrl) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [fileUrl]);

  if (!fileUrl || !isValidUrl(fileUrl)) return null;

  const getFileName = (url: string, fallback?: string | null) => {
    if (fallback) return fallback;
    try {
      const parsed = new URL(url, window.location.origin);
      const pathname = parsed.pathname;
      const filename = pathname.substring(pathname.lastIndexOf('/') + 1);
      return filename ? decodeURIComponent(filename) : 'Attachment File';
    } catch {
      return 'Attachment File';
    }
  };

  const fileName = getFileName(fileUrl, originalFilename);
  const extMatch = fileName.match(/\.([a-zA-Z0-9]+)$/);
  const fileExt = extMatch ? extMatch[1].toLowerCase() : '';

  const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(fileExt);
  const isPdf = fileExt === 'pdf';
  const isWordDocument = ['doc', 'docx'].includes(fileExt);
  const absoluteFileUrl = new URL(fileUrl, window.location.origin).href;
  const officeViewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(absoluteFileUrl)}`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      {/* Backdrop Click */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Slide-over Sidebar */}
      <aside className="relative z-10 flex h-full w-full max-w-2xl flex-col border-l border-neutral-200 bg-white pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-2xl animate-in slide-in-from-right duration-300 dark:border-neutral-800 dark:bg-[#141417] sm:rounded-l-3xl lg:max-w-3xl">
        {/* Sidebar Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200/60 dark:border-neutral-800/60 shrink-0 gap-3 bg-white/40 dark:bg-white/5 backdrop-blur-md">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-white/80 dark:bg-neutral-800/80 border border-white/50 dark:border-white/10 flex items-center justify-center text-neutral-700 dark:text-neutral-300 shrink-0 shadow-2xs">
              {isImage ? (
                <Reicon name="image" size={18} className="text-neutral-900 dark:text-neutral-100" />
              ) : isPdf || isWordDocument ? (
                <Reicon name="file-text" size={18} className="text-neutral-900 dark:text-neutral-100" />
              ) : (
                <Reicon name="file-text" size={18} className="text-neutral-900 dark:text-neutral-100" />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                  {fileName}
                </h3>
                {fileExt && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-neutral-900/10 dark:bg-white/10 text-neutral-700 dark:text-neutral-300 border border-neutral-200/60 dark:border-white/10 shrink-0">
                    {fileExt.toLowerCase()}
                  </span>
                )}
              </div>
              <p className="text-xs text-neutral-400 font-medium truncate mt-0.5">
                {isWordDocument ? 'Word Document' : isPdf ? 'PDF Document' : 'Attachment File'}
              </p>
            </div>
          </div>

          <div className="grid shrink-0 grid-flow-col auto-cols-[2.25rem] items-center gap-1">
            {isImage && (
              <>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                  className="flex size-9 items-center justify-center rounded-xl text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 cursor-pointer"
                  title="Zoom Out"
                  aria-label="Zoom out"
                >
                  <Reicon name="zoom-out" size={16} preset="scale" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}
                  className="flex size-9 items-center justify-center rounded-xl text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 cursor-pointer"
                  title="Zoom In"
                  aria-label="Zoom in"
                >
                  <Reicon name="zoom-in" size={16} preset="scale" />
                </button>
              </>
            )}

            {isPdf && (
              <a
                href={fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open full PDF in a new tab"
                className="flex size-9 items-center justify-center rounded-xl text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 cursor-pointer"
                title="Open full PDF"
              >
                <Reicon name="external-link" size={16} preset="lift" />
              </a>
            )}

            <a
              href={fileUrl}
              download={fileName}
              className="flex size-9 items-center justify-center rounded-xl text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 cursor-pointer"
              title="Download file"
              aria-label="Download file"
            >
              <Reicon name="download" size={16} preset="bounce" />
            </a>

            <button
              type="button"
              onClick={onClose}
              className="flex size-9 items-center justify-center rounded-xl text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 cursor-pointer"
              title="Close preview"
              aria-label="Close preview"
            >
              <Reicon name="x" size={18} preset="scale" />
            </button>
          </div>
        </div>

        {/* Content Viewer Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-neutral-50/40 dark:bg-neutral-950/40 relative flex flex-col items-center justify-center min-h-0">
          {loading && (isImage || isPdf || isWordDocument) && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/60 dark:bg-[#141417]/60 backdrop-blur-xs">
              <WanderingEyes className="h-12 text-neutral-500" />
            </div>
          )}

          {isImage ? (
            <div className="w-full h-full flex items-center justify-center overflow-auto">
              <AuthenticatedImage
                src={fileUrl}
                alt={`Preview of ${fileName}`}
                onReady={handlePreviewLoaded}
                onFail={handlePreviewLoaded}
                style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
                className="max-w-full max-h-full object-contain rounded-2xl shadow-md transition-transform duration-200"
                fallbackClassName="min-h-[40vh] rounded-2xl"
              />
            </div>
          ) : isPdf ? (
            <div className="flex min-h-0 w-full flex-1">
              <div className="h-full min-h-0 w-full overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-2xs dark:border-neutral-800">
                <iframe
                  src={fileUrl}
                  title={fileName}
                  onLoad={() => setLoading(false)}
                  className="h-full min-h-0 w-full border-0"
                />
              </div>
            </div>
          ) : isWordDocument ? (
            <div className="flex min-h-0 w-full flex-1">
              <div className="h-full min-h-0 w-full overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-2xs dark:border-neutral-800 dark:bg-neutral-950">
                <iframe
                  src={officeViewerUrl}
                  title={`Preview of ${fileName}`}
                  onLoad={() => setLoading(false)}
                  className="h-full min-h-0 w-full border-0"
                />
              </div>
            </div>
          ) : (
            <div className="w-full max-w-md p-8 rounded-3xl bg-white/80 dark:bg-[#18181c]/80 border border-white/60 dark:border-white/10 backdrop-blur-xl text-center space-y-4 shadow-lg my-auto">
              <div className="w-14 h-14 rounded-3xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-600 dark:text-neutral-300 mx-auto">
                <Reicon name="file-text" size={28} className="text-neutral-500 dark:text-neutral-400" />
              </div>
              <div className="space-y-1">
                <h4 className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">{fileName}</h4>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  This document type is ready to download or open in an external viewer.
                </p>
              </div>
              <div className="pt-2 flex items-center justify-center gap-3">
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-semibold shadow-2xs"
                >
                  <Reicon name="external-link" size={14} preset="lift" />
                  <span>Open file</span>
                </a>
                <a
                  href={fileUrl}
                  download={fileName}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-transparent text-neutral-700 dark:text-neutral-300 text-xs font-semibold"
                >
                  <Reicon name="download" size={14} preset="bounce" />
                  <span>Download</span>
                </a>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};
