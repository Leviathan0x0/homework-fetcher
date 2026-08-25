import React from 'react';
import { Reillustration, type ReillustrationName, type ReillustrationSize } from './ui/reicon';
import { AnimatedIcon } from './ui/animated-icon';

export interface EmptyStateProps {
  type?: 'today' | 'recent' | 'all' | 'attachments' | 'search' | 'completed' | 'notices' | 'exams';
  illustration?: ReillustrationName;
  illustrationSize?: ReillustrationSize;
  title?: string;
  subtitle?: string;
  /** Alias for `subtitle`, kept for call sites that describe the empty result. */
  description?: string;
  /** Overrides the illustration with a small icon badge. */
  icon?: React.ComponentType<{ size?: number | string; className?: string; strokeWidth?: number | string }>;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  type = 'today',
  illustration,
  illustrationSize = 'md',
  title,
  subtitle,
  description,
  icon,
  action,
  className,
}) => {
  let defaultTitle = 'No homework found';
  let defaultSubtitle = 'There are no assignments matching your filter criteria.';
  let defaultIllustration: ReillustrationName = 'empty-assignments';

  if (type === 'today') {
    defaultTitle = 'No homework posted today';
    defaultSubtitle = 'Nothing has been sent yet. Check back later.';
    defaultIllustration = 'empty-today';
  } else if (type === 'attachments') {
    defaultTitle = 'No attachments found';
    defaultSubtitle = 'None of your homework entries contain attached files.';
    defaultIllustration = 'empty-attachments';
  } else if (type === 'search') {
    defaultTitle = 'No matching homework';
    defaultSubtitle = 'Try a different search term or clear your filters.';
    defaultIllustration = 'empty-search';
  } else if (type === 'completed') {
    defaultTitle = 'No completed homework';
    defaultSubtitle = 'Check off tasks on your dashboard to see them listed here.';
    defaultIllustration = 'empty-completed';
  } else if (type === 'notices') {
    defaultTitle = 'No notices found';
    defaultSubtitle = 'There are no active school notices or circulars.';
    defaultIllustration = 'empty-notices';
  } else if (type === 'exams') {
    defaultTitle = 'No exam assignments found';
    defaultSubtitle = 'Assignments mentioning exams, syllabus, or revision will appear here.';
    defaultIllustration = 'exam-prep';
  }

  const activeIllustration = illustration || defaultIllustration;

  return (
    <div
      className={
        className ||
        'flex flex-col items-center justify-center text-center px-6 py-12 sm:py-14 bg-white/60 dark:bg-[#18181b]/50 border border-dashed border-neutral-200 dark:border-neutral-800 rounded-3xl'
      }
    >
      {icon ? (
        <div className="w-12 h-12 rounded-2xl bg-neutral-100 dark:bg-neutral-800/80 flex items-center justify-center text-neutral-500 dark:text-neutral-400 mb-4 shadow-2xs">
          <AnimatedIcon icon={icon} preset="bounce" size={22} className="stroke-[1.5]" />
        </div>
      ) : (
        <div className="mb-4">
          <Reillustration name={activeIllustration} size={illustrationSize} interactive />
        </div>
      )}
      <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        {title || defaultTitle}
      </h3>
      <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400 max-w-xs mt-1.5">
        {subtitle || description || defaultSubtitle}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
};
