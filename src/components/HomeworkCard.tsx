import React, { useState } from 'react';
import type { HomeworkEntry } from '../types/homework';
import { detectSubject } from '../utils/subjectDetector';
import { parseHomeworkContent, splitTaskHierarchy } from '../utils/contentParser';
import { cn } from '../utils/cn';
import { AttachmentPreviewRow } from './AttachmentPreviewRow';
import { Reicon } from './ui/reicon';

interface HomeworkCardProps {
  item: HomeworkEntry;
  isCompleted?: boolean;
  onToggleCompleted?: () => void;
  onUpdateNote?: (id: string, note: string | null) => void;
  onOpenPreview?: (url: string, filename?: string) => void;
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
  const hasAttachment = Boolean(item.attachment && isValidUrl(item.attachment));
  const workTypeLabel = /^(?:home\s*work|homework)$/i.test(item.type)
    ? 'HW'
    : /^(?:class\s*work|classwork)$/i.test(item.type)
      ? 'CW'
      : item.type;

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

  const noteArea = isEditingNote ? (
    <div className="relative animate-in fade-in-0 slide-in-from-top-1 rounded-xl border border-neutral-300 bg-white p-2.5 shadow-2xs transition-[border-color,box-shadow] duration-200 focus-within:ring-1 focus-within:ring-neutral-400 dark:border-neutral-700/80 dark:bg-[#121215] dark:focus-within:ring-neutral-600">
      <textarea
        value={noteText}
        onChange={(e) => setNoteText(e.target.value)}
        placeholder="Add a personal note (e.g. Need to complete questions 1-5 before Friday)..."
        rows={2}
        autoFocus
        className="w-full resize-none bg-transparent text-xs text-neutral-900 placeholder:text-neutral-400 focus:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-500"
      />

      <div className="mt-1 flex items-center justify-between border-t border-neutral-100 pt-2 dark:border-neutral-800/80">
        {item.note ? (
          <button
            type="button"
            onClick={handleDeleteNote}
            className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-rose-600 transition-colors duration-200 hover:text-rose-700 hover:underline dark:text-rose-400 dark:hover:text-rose-300"
          >
            <Reicon name="trash-2" size={12} />
            <span>Delete</span>
          </button>
        ) : (
          <div />
        )}

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCancelNote}
            className="cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium text-neutral-500 transition-colors duration-200 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveNote}
            className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-neutral-900 px-2.5 py-1 text-[11px] font-semibold text-white shadow-2xs transition-colors duration-200 hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            <Reicon name="check" size={12} />
            <span>Save Note</span>
          </button>
        </div>
      </div>
    </div>
  ) : (
    <div className="flex items-center justify-between text-xs">
      {item.note ? (
        <div className="group/note relative flex w-full items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-2 text-neutral-800 shadow-2xs transition-colors duration-200 hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900/70 dark:text-neutral-200 dark:hover:border-neutral-700">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Reicon name="notebook-pen" size={14} className="shrink-0 text-neutral-500 dark:text-neutral-400" />
            <p className="flex-1 whitespace-pre-wrap break-words text-[11px] font-medium leading-relaxed text-neutral-800 dark:text-neutral-200">
              {item.note}
            </p>
          </div>

          {onUpdateNote && item.id && (
            <div className="flex shrink-0 items-center gap-0.5 opacity-80 transition-opacity group-hover/note:opacity-100">
              <button
                type="button"
                onClick={() => {
                  setNoteText(item.note || '');
                  setIsEditingNote(true);
                }}
                className="cursor-pointer rounded-md p-1 text-neutral-500 transition-colors duration-200 hover:bg-neutral-200/70 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                title="Edit note"
                aria-label="Edit note"
              >
                <Reicon name="pencil" size={12} />
              </button>
              <button
                type="button"
                onClick={handleDeleteNote}
                className="cursor-pointer rounded-md p-1 text-neutral-400 transition-colors duration-200 hover:bg-rose-100/60 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                title="Delete note"
                aria-label="Delete note"
              >
                <Reicon name="trash-2" size={12} />
              </button>
            </div>
          )}
        </div>
      ) : (
        onUpdateNote && item.id && (
          <button
            type="button"
            onClick={() => setIsEditingNote(true)}
            className="inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-neutral-400 transition-colors duration-200 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-300"
          >
            <Reicon name="plus" size={12} />
            <span>Add note</span>
          </button>
        )
      )}
    </div>
  );

  return (
    <article
      className={cn(
        'group relative overflow-hidden bg-white dark:bg-[#141417] border border-neutral-200/80 dark:border-neutral-800/80 rounded-2xl shadow-2xs hover:shadow-md hover:border-neutral-300 dark:hover:border-neutral-700 transition-shadow duration-200',
        isCompleted && 'opacity-65 bg-neutral-50/60 dark:bg-[#101012]/60 border-neutral-200/40 dark:border-neutral-800/40 shadow-none'
      )}
    >
      <div className="p-3.5 sm:p-4">
        {/* Top: checkbox + subject */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 mb-2.5">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            {onToggleCompleted && (
              <button
                type="button"
                onClick={onToggleCompleted}
                className={cn(
                  'w-5 h-5 rounded-lg border flex items-center justify-center transition-colors duration-200 cursor-pointer shrink-0 touch-manipulation',
                  isCompleted
                    ? 'bg-neutral-900 border-neutral-900 text-white dark:bg-white dark:border-white dark:text-neutral-900 shadow-2xs'
                    : 'border-neutral-300 dark:border-neutral-700 hover:border-neutral-400 dark:hover:border-neutral-500 bg-transparent'
                )}
                title={isCompleted ? 'Mark as pending' : 'Mark as done'}
              >
                <Reicon
                  name="check"
                  size={13}
                  strokeWidth={2.5}
                  className={cn(
                    'stroke-[2.5] transition-opacity duration-200',
                    isCompleted ? 'opacity-100' : 'opacity-0'
                  )}
                />
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
              <span
                className="bg-neutral-100 dark:bg-neutral-800/80 text-neutral-600 dark:text-neutral-400 px-2 py-0.5 rounded-full"
                title={item.type}
              >
                {workTypeLabel}
              </span>
            )}
            {item.date && <span>{item.date}</span>}
          </div>
        </div>

        {/* Compact homework and classwork labels */}
        <div className={cn('space-y-1.5', isCompleted && 'opacity-80')}>
          {parsed.homeWork && (
            <div className="flex items-start gap-2">
              <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-md text-[9px] font-semibold text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 shrink-0 select-none mt-0.5">
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
              <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-md text-[9px] font-semibold text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 shrink-0 select-none mt-0.5">
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

        {!hasAttachment && (
          <div className="mt-2.5 border-t border-neutral-100 pt-2 dark:border-neutral-800/60">
            {noteArea}
          </div>
        )}
      </div>

      {hasAttachment && item.attachment && (
        <div className="border-t border-neutral-100 px-3.5 py-2 dark:border-neutral-800/80 sm:px-4">
          <div className="space-y-1">
            {noteArea}
            <AttachmentPreviewRow
              url={item.attachment}
              name={attachmentLabel}
              onOpenPreview={onOpenPreview || (() => undefined)}
              fallbackDetail="Homework attachment"
            />
          </div>
        </div>
      )}
    </article>
  );
};
