import React, { useCallback, useEffect, useState } from 'react';
import { X, Download, FileText, Image as ImageIcon, File, ZoomIn, ZoomOut, RefreshCw } from 'lucide-react';
import { AuthenticatedImage } from './AuthenticatedImage';
import { DocxPreview } from './DocxPreview';
import { ExternalLinkIcon } from './ui/external-link';
import { cn } from '../utils/cn';

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
  const [hoveredAction, setHoveredAction] = useState<string | null>(null);

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
  const isDocx = fileExt === 'docx';
  const handlePreviewLoaded = useCallback(() => setLoading(false), []);

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
                <ImageIcon className="w-4.5 h-4.5 text-neutral-900 dark:text-neutral-100" />
              ) : isPdf || isDocx ? (
                <FileText className="w-4.5 h-4.5 text-neutral-900 dark:text-neutral-100" />
              ) : (
                <File className="w-4.5 h-4.5 text-neutral-900 dark:text-neutral-100" />
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
                Attachment File
              </p>
            </div>
          </div>

          <div className="grid shrink-0 grid-flow-col auto-cols-[2.25rem] items-center gap-1">
            {isImage && (
              <>
                <button
                  onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                  className="flex size-9 items-center justify-center rounded-xl text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                  title="Zoom Out"
                  aria-label="Zoom out"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}
                  className="flex size-9 items-center justify-center rounded-xl text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                  title="Zoom In"
                  aria-label="Zoom in"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
              </>
            )}

            {isPdf && (
              <a
                href={fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                onMouseEnter={() => setHoveredAction('open')}
                onMouseLeave={() => setHoveredAction(null)}
                onFocus={() => setHoveredAction('open')}
                onBlur={() => setHoveredAction(null)}
                className="flex size-9 items-center justify-center rounded-xl text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                title="Open full PDF"
                aria-label="Open full PDF in a new tab"
              >
                <ExternalLinkIcon size={16} isAnimated={hoveredAction === 'open'} aria-hidden />
              </a>
            )}

            <a
              href={fileUrl}
              download={fileName}
              className="flex size-9 items-center justify-center rounded-xl text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
              title="Download file"
              aria-label="Download file"
            >
              <Download className="w-4 h-4" />
            </a>

            <button
              onClick={onClose}
              className="flex size-9 items-center justify-center rounded-xl text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
              title="Close preview"
              aria-label="Close preview"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* Content Viewer Area */}
        <div
          className={cn(
            'relative flex min-h-0 flex-1 flex-col bg-neutral-50/40 dark:bg-neutral-950/40',
            isImage && 'items-center justify-center overflow-auto p-4 sm:p-6',
            isPdf && 'overflow-hidden p-3 sm:p-4',
            isDocx && 'overflow-y-auto p-3 sm:p-5',
            !isImage && !isPdf && !isDocx && 'items-center justify-center overflow-y-auto p-4 sm:p-6'
          )}
        >
          {loading && (isImage || isPdf || isDocx) && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/60 dark:bg-[#141417]/60 backdrop-blur-xs">
              <RefreshCw className="w-6 h-6 animate-spin text-neutral-500" />
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
            <div className="relative min-h-0 w-full flex-1 overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-2xs dark:border-neutral-800">
              <iframe
                src={fileUrl}
                title={fileName}
                onLoad={handlePreviewLoaded}
                className="absolute inset-0 size-full border-0"
              />
            </div>
          ) : isDocx ? (
            <DocxPreview fileUrl={fileUrl} fileName={fileName} onLoadEnd={handlePreviewLoaded} />
          ) : (
            <div className="w-full max-w-md p-8 rounded-3xl bg-white/80 dark:bg-[#18181c]/80 border border-white/60 dark:border-white/10 backdrop-blur-xl text-center space-y-4 shadow-lg my-auto">
              <div className="w-14 h-14 rounded-3xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-600 dark:text-neutral-300 mx-auto">
                <FileText className="w-7 h-7 text-neutral-500 dark:text-neutral-400" />
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
                  <ExternalLinkIcon size={14} />
                  <span>Open file</span>
                </a>
                <a
                  href={fileUrl}
                  download={fileName}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-transparent text-neutral-700 dark:text-neutral-300 text-xs font-semibold"
                >
                  <Download className="w-3.5 h-3.5" />
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
