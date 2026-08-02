import React, { useState } from 'react';
import { HomeworkEntry } from '../types/homework';
import { detectSubject } from '../utils/subjectDetector';
import { parseHomeworkContent, splitTaskHierarchy } from '../utils/contentParser';
import { Check, Download, Eye, Pencil, Trash2, NotebookPen } from 'lucide-react';
import { AnimatedPaperclip, AnimatedIcon } from './ui/animated-icon';
import { cn } from '../utils/cn';

interface HomeworkCardProps {
  item: HomeworkEntry;
  isCompleted?: boolean;
  onToggleCompleted?: () => void;
  onUpdateNote?: (id: string, note: string | null) => void;
  onOpenPreview?: (url: string) => void;
}

const isValidUrl = (url: string | null | undefined): boolean => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

export const HomeworkCard: React.FC<HomeworkCardProps> = ({
  item,
  isCompleted = false,
  onToggleCompleted,
  onUpdateNote,
  onOpenPreview,
}) => {
  const subjectInfo = detectSubject(item.homework, item.subject, item.type);
  const parsed = parseHomeworkContent(item.homework, subjectInfo.name);
  const hwHierarchy = splitTaskHierarchy(parsed.homeWork || '');

  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteText, setNoteText] = useState(item.note || '');

  const getAttachmentLabel = (url: string) => {
    try {
      const parsedUrl = new URL(url);
      const pathname = parsedUrl.pathname;
      const filename = pathname.substring(pathname.lastIndexOf('/') + 1);
      return filename ? decodeURIComponent(filename) : 'Attachment File';
    } catch {
      return 'Attachment File';
    }
  };
  const attachmentLabel = item.attachment ? getAttachmentLabel(item.attachment) : '';
  const isWordDocument = /\.(?:doc|docx)(?:$|[?#])/i.test(attachmentLabel) ||
    /\.(?:doc|docx)(?:$|[?#])/i.test(item.attachment || '');

  const handleAttachmentClick = (e: React.MouseEvent) => {
    if (onOpenPreview && item.attachment && isValidUrl(item.attachment)) {
      e.preventDefault();
      onOpenPreview(item.attachment);
    }
  };

  const handleSaveNote = () => {
    if (onUpdateNote && item.id) {
      onUpdateNote(item.id, noteText.trim() || null);
    }
    setIsEditingNote(false);
  };

  const handleDeleteNote = () => {
    if (onUpdateNote && item.id) {
      onUpdateNote(item.id, null);
    }
    setNoteText('');
    setIsEditingNote(false);
  };

  const handleCancelNote = () => {
    setNoteText(item.note || '');
    setIsEditingNote(false);
  };

  return (
    <article
      className={cn(
        'group relative bg-white dark:bg-[#141417] border border-neutral-200/80 dark:border-neutral-800/80 rounded-xl p-3.5 sm:p-4 shadow-2xs hover:shadow-md hover:border-neutral-300 dark:hover:border-neutral-700 transition-shadow duration-200',
        isCompleted && 'opacity-65 bg-neutral-50/60 dark:bg-[#101012]/60 border-neutral-200/40 dark:border-neutral-800/40 shadow-none'
      )}
    >
      {/* Top: checkbox + subject */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 mb-2.5">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {onToggleCompleted && (
            <button
              onClick={onToggleCompleted}
              className={cn(
                'w-5 h-5 rounded-lg border flex items-center justify-center transition-colors duration-200 cursor-pointer shrink-0 touch-manipulation active:scale-90',
                isCompleted
                  ? 'bg-neutral-900 border-neutral-900 text-white dark:bg-white dark:border-white dark:text-neutral-900 shadow-2xs'
                  : 'border-neutral-300 dark:border-neutral-700 hover:border-neutral-400 dark:hover:border-neutral-500 bg-transparent'
              )}
              title={isCompleted ? 'Mark as pending' : 'Mark as done'}
            >
              {isCompleted && <Check className="w-3 h-3 stroke-[3] animate-pop-bounce" />}
            </button>
          )}

          <span
            className={cn(
              'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border cursor-default',
              subjectInfo.badgeClass
            )}
          >
            {subjectInfo.name}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-medium text-neutral-500 dark:text-neutral-400 shrink-0">
          {item.type && (
            <span className="bg-neutral-100 dark:bg-neutral-800/80 text-neutral-600 dark:text-neutral-400 px-2 py-0.5 rounded-full">
              {item.type}
            </span>
          )}
          {item.date && <span>{item.date}</span>}
        </div>
      </div>

      {/* Hierarchy: compact HW / CW tags */}
      <div className={cn('space-y-1.5', isCompleted && 'opacity-80')}>
        {parsed.homeWork && (
          <div className="flex items-start gap-2">
            <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-md text-[9px] font-bold tracking-wider text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 shrink-0 select-none mt-0.5">
              HW
            </span>
            <div className={cn('flex-1 min-w-0', isCompleted && 'line-through decoration-neutral-400/80')}>
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50 leading-snug tracking-tight whitespace-pre-wrap break-words">
                {hwHierarchy.action}
              </p>
              {hwHierarchy.detail && (
                <p className="mt-0.5 text-[11px] sm:text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed whitespace-pre-wrap break-words">
                  {hwHierarchy.detail}
                </p>
              )}
            </div>
          </div>
        )}

        {parsed.classWork && (
          <div className="flex items-start gap-2">
            <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-md text-[9px] font-bold tracking-wider text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 shrink-0 select-none mt-0.5">
              CW
            </span>
            <span
              className={cn(
                'whitespace-pre-wrap break-words flex-1 text-[11px] sm:text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed',
                isCompleted && 'line-through'
              )}
            >
              {parsed.classWork}
            </span>
          </div>
        )}

        {!parsed.homeWork && !parsed.classWork && (
          <p
            className={cn(
              'whitespace-pre-wrap break-words text-sm font-normal leading-relaxed text-neutral-800 dark:text-neutral-200',
              isCompleted && 'line-through decoration-neutral-400/80 opacity-80'
            )}
          >
            {item.homework}
          </p>
        )}
      </div>

      {/* Personal note */}
      <div className="mt-2.5 pt-2 border-t border-neutral-100 dark:border-neutral-800/60">
        {isEditingNote ? (
          <div className="relative border border-neutral-300 dark:border-neutral-700/80 rounded-xl bg-white dark:bg-[#121215] p-2.5 focus-within:ring-1 focus-within:ring-neutral-400 dark:focus-within:ring-neutral-600 transition-all duration-200 shadow-2xs animate-in fade-in-0 zoom-in-95">
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add a personal note (e.g. Need to complete questions 1-5 before Friday)..."
              rows={2}
              autoFocus
              className="w-full text-xs bg-transparent text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:outline-none resize-none"
            />

            <div className="flex items-center justify-between pt-2 border-t border-neutral-100 dark:border-neutral-800/80 mt-1">
              {item.note ? (
                <button
                  type="button"
                  onClick={handleDeleteNote}
                  className="group/del inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:underline cursor-pointer active:scale-95 transition-transform duration-150"
                >
                  <Trash2 className="w-3 h-3 transition-transform duration-200 group-hover/del:rotate-12" />
                  <span>Delete</span>
                </button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCancelNote}
                  className="px-2 py-0.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 cursor-pointer active:scale-95 transition-transform duration-150"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveNote}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:opacity-90 transition-all duration-200 cursor-pointer shadow-2xs active:scale-95"
                >
                  <Check className="w-3 h-3" />
                  <span>Save Note</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between text-xs">
            {item.note ? (
              <div className="group/note relative flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-2 text-neutral-800 shadow-2xs transition-colors duration-200 hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900/70 dark:text-neutral-200 dark:hover:border-neutral-700 w-full">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <AnimatedIcon icon={NotebookPen} preset="shake" size={14} className="text-neutral-500 dark:text-neutral-400" />
                  <p className="text-[11px] font-medium text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap break-words leading-relaxed flex-1">
                    {item.note}
                  </p>
                </div>

                {onUpdateNote && item.id && (
                  <div className="flex items-center gap-0.5 shrink-0 opacity-80 group-hover/note:opacity-100 transition-opacity">
                    <button
                      onClick={() => {
                        setNoteText(item.note || '');
                        setIsEditingNote(true);
                      }}
                      className="group/pen p-1 rounded-md text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200/70 dark:hover:bg-neutral-800 transition-colors duration-200 cursor-pointer active:scale-90"
                      title="Edit note"
                    >
                      <Pencil className="w-3 h-3 transition-transform duration-200 group-hover/pen:rotate-12" />
                    </button>
                    <button
                      onClick={handleDeleteNote}
                      className="group/trash p-1 rounded-md text-neutral-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-100/60 dark:hover:bg-rose-950/40 transition-colors duration-200 cursor-pointer active:scale-90"
                      title="Delete note"
                    >
                      <Trash2 className="w-3 h-3 transition-transform duration-200 group-hover/trash:rotate-12" />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              onUpdateNote && item.id && (
                <button
                  onClick={() => setIsEditingNote(true)}
                  className="group/add inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 transition-colors duration-200 cursor-pointer active:scale-95"
                >
                  <AnimatedIcon icon={NotebookPen} preset="lift" size={12} className="text-neutral-400 dark:text-neutral-500" />
                  <span>Add note</span>
                </button>
              )
            )}
          </div>
        )}
      </div>

      {item.attachment && isValidUrl(item.attachment) && (
        <div className="mt-2 pt-2 border-t border-neutral-100 dark:border-neutral-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-600 dark:text-neutral-400 truncate max-w-full sm:max-w-[65%]">
            <AnimatedPaperclip size={12} className="text-neutral-400 shrink-0" />
            <span className="truncate">{attachmentLabel}</span>
          </div>

          {isWordDocument ? (
            <a
              href={item.attachment}
              download={attachmentLabel}
              className="inline-flex items-center justify-center gap-1 text-[11px] font-semibold text-neutral-900 dark:text-neutral-100 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors duration-200 py-1 px-2.5 rounded-full bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 cursor-pointer active:scale-95"
            >
              <span>Download document</span>
              <AnimatedIcon icon={Download} preset="lift" size={12} />
            </a>
          ) : (
            <button
              onClick={handleAttachmentClick}
              className="inline-flex items-center justify-center gap-1 text-[11px] font-semibold text-neutral-900 dark:text-neutral-100 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors duration-200 py-1 px-2.5 rounded-full bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 cursor-pointer active:scale-95"
            >
              <span>Preview attachment</span>
              <AnimatedIcon icon={Eye} preset="zoom" size={12} />
            </button>
          )}
        </div>
      )}
    </article>
  );
};
