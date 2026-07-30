import React, { useState, useEffect, useCallback } from 'react';
import { classworkService } from '../services/api';
import { compressImage, isCompressibleImage, formatBytes } from '../utils/imageCompression';
import { MAX_UPLOAD_BYTES } from '../lib/api';
import { friendlyContentError } from '../utils/friendlyErrors';
import {
  UploadCloud,
  FileText,
  Image as ImageIcon,
  FileCode,
  FileSpreadsheet,
  Presentation,
  File,
  Download,
  Eye,
  Trash2,
  Plus,
  X,
  Loader2,
  UserCheck,
  Calendar as CalendarIcon,
  CheckCircle2,
  AlertCircle,
  FolderOpen
} from 'lucide-react';
import { ClassworkEntry, SubjectInfo } from '../types/homework';
import { detectSubject } from '../utils/subjectDetector';
import { cn } from '../utils/cn';
import { PageHeader } from './PageHeader';
import { AuthenticatedImage } from './AuthenticatedImage';

interface ClassworkViewProps {
  userSection?: string;
  onOpenPreview: (url: string, filename?: string) => void;
}

const COMMON_SUBJECTS = [
  'Mathematics',
  'Science',
  'English',
  'Social Science',
  'Hindi',
  'Computers',
  'Punjabi',
  'General Knowledge',
  'Art & Craft'
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string | null | undefined, filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (mimeType?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
    return <ImageIcon className="w-5 h-5 text-indigo-500" />;
  }
  if (mimeType === 'application/pdf' || ext === 'pdf') return <FileText className="w-5 h-5 text-rose-500" />;
  if (ext === 'doc' || ext === 'docx' || mimeType?.includes('word')) return <FileText className="w-5 h-5 text-blue-500" />;
  if (ext === 'xls' || ext === 'xlsx' || mimeType?.includes('sheet') || mimeType?.includes('excel')) return <FileSpreadsheet className="w-5 h-5 text-emerald-500" />;
  if (ext === 'ppt' || ext === 'pptx' || mimeType?.includes('presentation') || mimeType?.includes('powerpoint')) return <Presentation className="w-5 h-5 text-amber-500" />;
  if (ext === 'txt') return <FileCode className="w-5 h-5 text-neutral-500" />;
  return <File className="w-5 h-5 text-neutral-400" />;
}

export const ClassworkView: React.FC<ClassworkViewProps> = ({
  userSection = '',
  onOpenPreview
}) => {
  const [classwork, setClasswork] = useState<ClassworkEntry[]>([]);
  const [sectionName, setSectionName] = useState<string>(userSection);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<string>('All');
  const [selectedDateFilter, setSelectedDateFilter] = useState<'all' | 'today'>('all');

  // Modal State
  const [isUploadOpen, setIsUploadOpen] = useState<boolean>(false);
  const [uploadSubject, setUploadSubject] = useState<string>('Mathematics');
  const [customSubject, setCustomSubject] = useState<string>('');
  const [uploadTitle, setUploadTitle] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Fetch Classwork
  const fetchClasswork = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const list = await classworkService.getClasswork(userSection);
      setClasswork(list);
    } catch (err: any) {
      console.error('Fetch Classwork Error:', err);
      setErrorMessage(typeof err?.message === 'string' ? err.message : 'Unable to load classwork.');
    } finally {
      setIsLoading(false);
    }
  }, [userSection]);

  useEffect(() => {
    fetchClasswork();
  }, [fetchClasswork]);

  // Shrinks photos before upload and rejects anything still too large
  const acceptFile = async (file: File) => {
    setModalError(null);
    const ext = file.name.includes('.') ? `.${file.name.split('.').pop()!.toLowerCase()}` : '';
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
    if (!allowed.includes(ext)) {
      setModalError('Only homework PDFs and photos (JPG, PNG, or WebP) can be shared here.');
      return;
    }
    const prepared = isCompressibleImage(file) ? await compressImage(file) : file;
    if (prepared.size > MAX_UPLOAD_BYTES) {
      setModalError(
        `This file is ${formatBytes(prepared.size)}; the maximum upload size is ${formatBytes(MAX_UPLOAD_BYTES)}.`
      );
      return;
    }
    setSelectedFile(prepared);
  };

  // Handle File Selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      acceptFile(e.target.files[0]);
    }
  };

  // Drag & Drop
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      acceptFile(e.dataTransfer.files[0]);
    }
  };

  // Submit Upload Form
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    const finalSubject = uploadSubject === 'Other' ? customSubject.trim() : uploadSubject.trim();
    if (!finalSubject) {
      setModalError('Please select or specify a subject.');
      return;
    }
    if (!selectedFile) {
      setModalError('Please select a file to upload.');
      return;
    }

    setIsSubmitting(true);
    try {
      const newEntry = await classworkService.uploadClasswork(
        selectedFile,
        finalSubject,
        uploadTitle.trim() || undefined,
        userSection
      );

      setClasswork((prev) => [newEntry, ...prev]);
      setIsUploadOpen(false);
      setSelectedFile(null);
      setUploadTitle('');
      setCustomSubject('');
    } catch (err: any) {
      console.error('Upload Classwork Error:', err);
      setModalError(friendlyContentError(err, 'Upload failed. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete Own Upload
  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this classwork upload?')) return;
    setDeletingId(id);
    try {
      const itemToDelete = classwork.find((item) => item.id === id);
      await classworkService.deleteClasswork(id, itemToDelete?.fileId ?? undefined);
      setClasswork((prev) => prev.filter((item) => item.id !== id));
    } catch (err: any) {
      console.error('Delete Classwork Error:', err);
      alert(typeof err?.message === 'string' ? err.message : 'Failed to delete file.');
    } finally {
      setDeletingId(null);
    }
  };

  // Filter Logic
  const todayStr = new Date().toISOString().split('T')[0];
  const filteredClasswork = classwork.filter((item) => {
    if (selectedSubject !== 'All' && item.subject.toLowerCase() !== selectedSubject.toLowerCase()) {
      return false;
    }
    if (selectedDateFilter === 'today' && item.date !== todayStr) {
      return false;
    }
    return true;
  });

  // Extract unique subjects in current list
  const availableSubjects = Array.from(
    new Set(['All', ...COMMON_SUBJECTS, ...classwork.map((c) => c.subject)])
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Classwork Uploads"
        description="Access and share today's class notes, slides, and documents with classmates in your section."
        badge={
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/50 text-xs font-medium">
            <UserCheck className="w-3 h-3 text-indigo-500" />
            {sectionName}
          </span>
        }
      />

      {/* Error Banner */}
      {errorMessage && (
        <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-800/50 flex items-center justify-between gap-3 text-xs text-rose-700 dark:text-rose-300">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="leading-snug">{errorMessage}</span>
          </div>
          <button
            onClick={fetchClasswork}
            disabled={isLoading}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600 text-white text-[11px] font-semibold hover:bg-rose-700 disabled:opacity-60 cursor-pointer"
          >
            {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            Retry
          </button>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Subject Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full no-scrollbar">
          {availableSubjects.slice(0, 7).map((subj) => {
            const isActive = selectedSubject === subj;
            return (
              <button
                key={subj}
                onClick={() => setSelectedSubject(subj)}
                className={cn(
                  'px-3 py-1.5 rounded-xl text-xs font-medium transition-all duration-150 shrink-0 cursor-pointer active:scale-95',
                  isActive
                    ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-2xs font-semibold'
                    : 'bg-neutral-100/80 dark:bg-neutral-800/60 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/70 dark:hover:bg-neutral-800'
                )}
              >
                {subj}
              </button>
            );
          })}
        </div>

        {/* Date Filter Buttons */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-neutral-100 dark:bg-neutral-800/80 border border-neutral-200/60 dark:border-neutral-700/60 text-xs">
          <button
            onClick={() => setSelectedDateFilter('all')}
            className={cn(
              'px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer',
              selectedDateFilter === 'all'
                ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 shadow-2xs'
                : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200'
            )}
          >
            All Dates
          </button>
          <button
            onClick={() => setSelectedDateFilter('today')}
            className={cn(
              'px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer',
              selectedDateFilter === 'today'
                ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 shadow-2xs'
                : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200'
            )}
          >
            Today Only
          </button>
        </div>
      </div>

      {/* Classwork List / Loading / Empty State */}
      {isLoading && classwork.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" aria-busy="true" aria-label="Loading classwork">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#141417] p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="h-5 w-20 rounded-full bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
                <div className="h-4 w-14 rounded bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
              </div>
              <div className="space-y-2">
                <div className="h-4 w-3/4 rounded bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-xl bg-neutral-100 dark:bg-neutral-800 animate-pulse shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-full rounded bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
                    <div className="h-2.5 w-1/3 rounded bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
                  </div>
                </div>
              </div>
              <div className="h-28 w-full rounded-xl bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
              <div className="pt-3 border-t border-neutral-100 dark:border-neutral-800/80 flex justify-between">
                <div className="h-3 w-28 rounded bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
                <div className="h-6 w-16 rounded-lg bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredClasswork.length === 0 ? (
        <div className="py-16 px-4 rounded-3xl border border-dashed border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-[#141417]/50 flex flex-col items-center justify-center text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-400 dark:text-neutral-500 shadow-2xs">
            <FolderOpen className="w-6 h-6" />
          </div>
          <div className="space-y-1 max-w-sm">
            <h3 className="text-base font-semibold text-neutral-800 dark:text-neutral-200">
              No classwork uploaded yet
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {selectedSubject !== 'All'
                ? `No classwork found for ${selectedSubject}.`
                : selectedDateFilter === 'today'
                ? 'No classwork uploaded for today yet.'
                : `Be the first to upload classwork notes for ${sectionName}!`}
            </p>
          </div>
          <button
            onClick={() => setIsUploadOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-xs font-medium hover:bg-neutral-800 transition-colors shadow-2xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Upload Today's Classwork</span>
          </button>
        </div>
      ) : (
        <div className={cn(
          'grid grid-cols-1 md:grid-cols-2 gap-4 transition-opacity',
          isLoading && classwork.length > 0 && 'opacity-60'
        )}>
          {filteredClasswork.map((item) => {
            const subjInfo: SubjectInfo = detectSubject(item.subject);
            const isImage =
              Boolean(item.mimeType?.startsWith('image/')) ||
              Boolean(item.originalFilename?.match(/\.(jpe?g|png|webp|gif)$/i));
            const isPdf =
              item.mimeType === 'application/pdf' ||
              Boolean(item.originalFilename?.match(/\.pdf$/i));

            return (
              <div
                key={item.id}
                className="group relative rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#141417] p-4 flex flex-col justify-between transition-all duration-200 hover:shadow-xs hover:border-neutral-300 dark:hover:border-neutral-700"
              >
                <div className="space-y-3">
                  {/* Card Header: Subject Pill & Date */}
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        'px-2.5 py-0.5 rounded-full text-[11px] font-semibold border',
                        subjInfo.badgeClass
                      )}
                    >
                      {item.subject}
                    </span>
                    <span className="text-[11px] text-neutral-400 dark:text-neutral-500 font-medium flex items-center gap-1">
                      <CalendarIcon className="w-3 h-3" />
                      {item.date === todayStr ? 'Today' : item.date}
                    </span>
                  </div>

                  {/* Title & Filename */}
                  <div>
                    {item.title && (
                      <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 leading-snug line-clamp-2">
                        {item.title}
                      </h4>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <div className="p-1.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 shrink-0">
                        {getFileIcon(item.mimeType, item.originalFilename || item.filename || '')}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300 truncate">
                          {item.originalFilename}
                        </p>
                        <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
                          {formatFileSize(item.fileSize)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Image Preview Thumbnail if applicable */}
                {isImage && (
                  <div
                    onClick={() => onOpenPreview(item.fileUrl, item.originalFilename)}
                    className="mt-3 relative h-32 w-full rounded-xl overflow-hidden bg-neutral-100 dark:bg-neutral-900 border border-neutral-200/60 dark:border-neutral-800 cursor-pointer group/img"
                  >
                    <AuthenticatedImage
                      src={item.fileUrl}
                      alt={`Preview of ${item.originalFilename}`}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover/img:scale-105"
                    />
                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-medium gap-1.5">
                      <Eye className="w-4 h-4" />
                      <span>Preview</span>
                    </div>
                  </div>
                )}

                {/* Card Footer: Uploader info & Actions */}
                <div className="mt-4 pt-3 border-t border-neutral-100 dark:border-neutral-800/80 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5 text-neutral-400 dark:text-neutral-500 text-[11px]">
                    <span className="font-medium text-neutral-600 dark:text-neutral-400">
                      Uploaded by <span className="font-semibold text-neutral-800 dark:text-neutral-200">{item.studentId}</span>
                    </span>
                    {item.isOwner && (
                      <span className="px-1.5 py-0.2 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-500">
                        You
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    {(isImage || isPdf) && (
                      <button
                        onClick={() => onOpenPreview(item.fileUrl, item.originalFilename)}
                        className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                        title="Preview File"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <a
                      href={item.fileUrl}
                      download={item.originalFilename}
                      className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                      title="Download File"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>

                    {item.isOwner && (
                      <button
                        onClick={() => handleDelete(item.id)}
                        disabled={deletingId === item.id}
                        className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer disabled:opacity-50"
                        title="Delete Upload"
                      >
                        {deletingId === item.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Add Classwork Card */}
          <button
            type="button"
            onClick={() => setIsUploadOpen(true)}
            className="group relative rounded-2xl border-2 border-dashed border-neutral-300 dark:border-neutral-700/80 hover:border-neutral-400 dark:hover:border-neutral-500 bg-neutral-50/50 dark:bg-[#141417]/50 p-6 flex flex-col items-center justify-center text-center gap-3 transition-all duration-200 cursor-pointer min-h-[180px] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
          >
            <div className="w-10 h-10 rounded-2xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-600 dark:text-neutral-300 shadow-2xs group-hover:scale-110 group-hover:bg-neutral-900 group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-neutral-900 transition-all duration-200">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs font-semibold text-neutral-800 dark:text-neutral-200 block">
                Upload Classwork
              </span>
              <span className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5 block">
                Share notes or files with your section
              </span>
            </div>
          </button>
        </div>
      )}

      {/* Upload Classwork Modal */}
      {isUploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-[#141417] border border-neutral-200 dark:border-neutral-800 shadow-2xl p-6 space-y-6 relative overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-2 border-b border-neutral-100 dark:border-neutral-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
                  <UploadCloud className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
                    Upload Classwork
                  </h3>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    Sharing with <span className="font-semibold text-neutral-700 dark:text-neutral-300">{sectionName}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsUploadOpen(false)}
                className="p-1.5 rounded-full text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Error */}
            {modalError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200 font-medium leading-relaxed flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                <span>{modalError}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleUploadSubmit} className="space-y-4">
              {/* Subject Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                  Subject *
                </label>
                <select
                  value={uploadSubject}
                  onChange={(e) => setUploadSubject(e.target.value)}
                  className="w-full text-xs sm:text-sm h-11 px-3 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400/20"
                >
                  {COMMON_SUBJECTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  <option value="Other">Other / Custom Subject</option>
                </select>
              </div>

              {/* Custom Subject Input if 'Other' */}
              {uploadSubject === 'Other' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                    Custom Subject Name *
                  </label>
                  <input
                    type="text"
                    value={customSubject}
                    onChange={(e) => setCustomSubject(e.target.value)}
                    placeholder="e.g. Economics, French, Robotics"
                    className="w-full text-xs sm:text-sm h-11 px-3.5 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400/20"
                  />
                </div>
              )}

              {/* Title / Note Optional */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                  Title or Topic <span className="font-normal text-neutral-400">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  placeholder="e.g. Chapter 4 Class Notes & Handout"
                  className="w-full text-xs sm:text-sm h-11 px-3.5 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400/20"
                />
              </div>

              {/* File Dropzone */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                  Select File *
                </label>
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  className={cn(
                    'border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center text-center transition-colors cursor-pointer relative',
                    selectedFile
                      ? 'border-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/20'
                      : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-900/50'
                  )}
                >
                  <input
                    type="file"
                    onChange={handleFileChange}
                    accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />

                  {selectedFile ? (
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-300">
                        <CheckCircle2 className="w-5 h-5" />
                      </div>
                      <div className="text-left">
                        <p className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 max-w-[200px] truncate">
                          {selectedFile.name}
                        </p>
                        <span className="text-[10px] text-neutral-400">
                          {formatFileSize(selectedFile.size)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="w-10 h-10 rounded-2xl bg-neutral-100 dark:bg-neutral-800 mx-auto flex items-center justify-center text-neutral-400">
                        <UploadCloud className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                          Click to choose a file or drag & drop here
                        </p>
                        <p className="text-[10px] text-neutral-400 mt-0.5">
                          Images, PDFs, Word, Excel, PowerPoint, Text (photos are compressed automatically)
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 flex items-center justify-end gap-2 border-t border-neutral-100 dark:border-neutral-800">
                <button
                  type="button"
                  onClick={() => setIsUploadOpen(false)}
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !selectedFile}
                  className="px-5 py-2 rounded-2xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-xs font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Uploading...</span>
                    </>
                  ) : (
                    <>
                      <UploadCloud className="w-3.5 h-3.5" />
                      <span>Upload</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
