import React, { useEffect, useState } from 'react';
import { X, ExternalLink, Download, FileText, Image as ImageIcon, File, ZoomIn, ZoomOut, RefreshCw } from 'lucide-react';
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 dark:bg-black/70 backdrop-blur-xs animate-in fade-in duration-200">
      {/* Backdrop Click */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Slide-over Sidebar */}
      <aside className="relative z-10 w-full max-w-2xl lg:max-w-3xl h-full bg-white dark:bg-[#141417] border-l border-neutral-200 dark:border-neutral-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        {/* Sidebar Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200/80 dark:border-neutral-800/80 shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-700 dark:text-neutral-300 shrink-0 transition-transform duration-300 hover:rotate-6 shadow-2xs">
              {isImage ? (
                <ImageIcon className="w-4.5 h-4.5 text-indigo-500" />
              ) : isPdf ? (
                <FileText className="w-4.5 h-4.5 text-rose-500" />
              ) : (
                <File className="w-4.5 h-4.5 text-amber-500" />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                  {fileName}
                </h3>
                {fileExt && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border border-neutral-200/60 dark:border-neutral-700/60 shrink-0">
                    {fileExt}
                  </span>
                )}
              </div>
              <p className="text-xs text-neutral-400 font-medium truncate mt-0.5">
                Attachment File
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {isImage && (
              <>
                <button
                  onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                  className="group/zout p-2 rounded-xl text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors duration-200 cursor-pointer active:scale-90"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}
                  className="group/zin p-2 rounded-xl text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors duration-200 cursor-pointer active:scale-90"
                  title="Zoom In"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
              </>
            )}

            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group/ext p-2 rounded-xl text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors duration-200 cursor-pointer active:scale-90"
              title="Open in new tab"
            >
              <ExternalLink className="w-4 h-4 transition-transform duration-200 group-hover/ext:-translate-y-0.5 group-hover/ext:translate-x-0.5" />
            </a>

            <a
              href={fileUrl}
              download={fileName}
              className="group/dl p-2 rounded-xl text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors duration-200 cursor-pointer active:scale-90"
              title="Download file"
            >
              <Download className="w-4 h-4 transition-transform duration-200 group-hover/dl:translate-y-0.5" />
            </a>

            <button
              onClick={onClose}
              className="group/close p-2 rounded-xl text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors duration-200 cursor-pointer ml-1 active:scale-90"
              title="Close preview"
            >
              <X className="w-5 h-5 transition-transform duration-200 group-hover/close:rotate-90" />
            </button>
          </div>
        </div>

        {/* Content Viewer Area */}
        <div className="flex-1 overflow-auto p-4 sm:p-6 bg-neutral-50/50 dark:bg-neutral-950/40 relative flex items-center justify-center">
          {loading && (isImage || isPdf) && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/60 dark:bg-[#141417]/60 backdrop-blur-xs">
              <RefreshCw className="w-6 h-6 animate-spin text-neutral-500" />
            </div>
          )}

          {isImage ? (
            <div className="w-full h-full flex items-center justify-center overflow-auto">
              <img
                src={fileUrl}
                alt={fileName}
                onLoad={() => setLoading(false)}
                onError={() => setLoading(false)}
                style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
                className="max-w-full max-h-full object-contain rounded-2xl shadow-md transition-transform duration-200"
              />
            </div>
          ) : isPdf ? (
            <iframe
              src={fileUrl}
              title={fileName}
              onLoad={() => setLoading(false)}
              className="w-full h-full rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white shadow-2xs"
            />
          ) : (
            <div className="w-full max-w-md p-8 rounded-3xl bg-white dark:bg-[#18181c] border border-neutral-200/80 dark:border-neutral-800 text-center space-y-4 shadow-sm my-auto">
              <div className="w-14 h-14 rounded-3xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-600 dark:text-neutral-300 mx-auto transition-transform duration-300 hover:rotate-6">
                <FileText className="w-7 h-7 text-amber-500" />
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
                  className="group/oopen inline-flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors duration-200 shadow-2xs active:scale-95"
                >
                  <ExternalLink className="w-3.5 h-3.5 transition-transform duration-200 group-hover/oopen:-translate-y-0.5 group-hover/oopen:translate-x-0.5" />
                  <span>Open file</span>
                </a>
                <a
                  href={fileUrl}
                  download={fileName}
                  className="group/ddl inline-flex items-center gap-1.5 px-4 py-2 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-transparent text-neutral-700 dark:text-neutral-300 text-xs font-semibold hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors duration-200 active:scale-95"
                >
                  <Download className="w-3.5 h-3.5 transition-transform duration-200 group-hover/ddl:translate-y-0.5" />
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
