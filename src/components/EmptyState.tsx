import React from 'react';
import { CalendarCheck2, Inbox, Paperclip, SearchX } from 'lucide-react';

interface EmptyStateProps {
  type?: 'today' | 'recent' | 'all' | 'attachments' | 'search';
  title?: string;
  subtitle?: string;
  /** Alias for `subtitle`, kept for call sites that describe the empty result. */
  description?: string;
  /** Overrides the icon inferred from `type`. */
  icon?: React.ElementType;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  type = 'today',
  title,
  subtitle,
  description,
  icon,
  action,
}) => {
  let defaultTitle = 'No homework found';
  let defaultSubtitle = 'There are no assignments matching your filter criteria.';
  let defaultIcon: React.ElementType = Inbox;

  if (type === 'today') {
    defaultTitle = 'No homework for today';
    defaultSubtitle = 'Enjoy the free time.';
    defaultIcon = CalendarCheck2;
  } else if (type === 'attachments') {
    defaultTitle = 'No attachments found';
    defaultSubtitle = 'None of your homework entries contain attached files.';
    defaultIcon = Paperclip;
  } else if (type === 'search') {
    defaultTitle = 'No matching homework';
    defaultSubtitle = 'Try a different search term or clear your filters.';
    defaultIcon = SearchX;
  }

  const Icon = icon || defaultIcon;

  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-14 sm:py-16 bg-white/60 dark:bg-[#18181b]/50 border border-dashed border-neutral-200 dark:border-neutral-800 rounded-3xl">
      <div className="w-11 h-11 rounded-full bg-neutral-100 dark:bg-neutral-800/80 flex items-center justify-center text-neutral-400 dark:text-neutral-500 mb-4">
        <Icon className="w-5 h-5 stroke-[1.5]" />
      </div>
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
