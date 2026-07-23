import React from 'react';
import { CalendarCheck2, Inbox, Paperclip } from 'lucide-react';

interface EmptyStateProps {
  type?: 'today' | 'recent' | 'all' | 'attachments' | 'search';
  title?: string;
  subtitle?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ type = 'today', title, subtitle }) => {
  let defaultTitle = 'No homework found';
  let defaultSubtitle = 'There are no assignments matching your filter criteria.';
  let Icon = Inbox;

  if (type === 'today') {
    defaultTitle = 'No homework for today';
    defaultSubtitle = 'Enjoy the free time.';
    Icon = CalendarCheck2;
  } else if (type === 'attachments') {
    defaultTitle = 'No attachments found';
    defaultSubtitle = 'None of your homework entries contain attached files.';
    Icon = Paperclip;
  }

  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-4 bg-white/50 dark:bg-[#18181b]/50 border border-dashed border-neutral-200 dark:border-neutral-800 rounded-2xl my-4">
      <div className="w-12 h-12 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-400 dark:text-neutral-500 mb-4 animate-float-subtle shadow-2xs group/empty">
        <Icon className="w-6 h-6 stroke-[1.5] transition-transform duration-300 group-hover/empty:rotate-12" />
      </div>
      <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
        {title || defaultTitle}
      </h3>
      <p className="text-xs text-neutral-500 dark:text-neutral-400 max-w-sm">
        {subtitle || defaultSubtitle}
      </p>
    </div>
  );
};
