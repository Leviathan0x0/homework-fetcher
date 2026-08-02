import React, { useState, useEffect, useRef } from 'react';
import { notificationService } from '../services/api';
import { AppNotification } from '../types/homework';
import {
  BookOpenCheck,
  CheckCheck,
  ClipboardCheck,
  FileUp,
  Flag,
  Inbox,
  Loader2,
  Megaphone,
  ShieldCheck,
  UserCog,
} from 'lucide-react';
import { BellIcon } from '@/components/ui/bell';
import { HeartHandshakeIcon } from '@/components/ui/heart-handshake';
import { MessageSquareIcon } from '@/components/ui/message-square';
import { cn } from '../utils/cn';
import { formatChatListTime } from '../utils/dateUtils';
import { messagePreviewText } from '../utils/pendingMessageOpen';

interface NotificationPopoverProps {
  role: 'student' | 'teacher' | 'admin';
  unreadCount: number;
  onNavigate: (view: string) => void;
  onCountChange: (count: number) => void;
}

function getNotifIcon(type: string) {
  switch (type) {
    case 'new_classwork':
      return <FileUp className="size-4" />;
    case 'new_request':
      return <HeartHandshakeIcon size={16} />;
    case 'new_message':
      return <MessageSquareIcon size={16} />;
    case 'teacher_assignment':
    case 'new_homework':
    case 'homework_updated':
      return <BookOpenCheck className="size-4" />;
    case 'teacher_announcement':
      return <Megaphone className="size-4" />;
    case 'new_submission':
    case 'submission_updated':
      return <ClipboardCheck className="size-4" />;
    case 'new_report':
    case 'moderation_event':
      return <Flag className="size-4" />;
    case 'account_activity':
    case 'role_updated':
      return <UserCog className="size-4" />;
    default:
      return <Inbox className="size-4" />;
  }
}

const roleCopy = {
  student: {
    heading: 'Student updates',
    emptyTitle: "You're all caught up",
    emptyBody: 'Homework, announcements, uploads, help requests, and school notices will appear here.',
    EmptyIcon: BookOpenCheck,
  },
  teacher: {
    heading: 'Teacher updates',
    emptyTitle: 'No teacher updates',
    emptyBody: 'Help requests, submissions, class activity, and staff notices will appear here.',
    EmptyIcon: ClipboardCheck,
  },
  admin: {
    heading: 'Administrator updates',
    emptyTitle: 'No administrator alerts',
    emptyBody: 'Reports, account changes, moderation events, and platform notices will appear here.',
    EmptyIcon: ShieldCheck,
  },
} as const;

function resolveNavigateTarget(n: AppNotification): string | null {
  if (n.type === 'new_message') {
    const fromLink =
      typeof n.link === 'string' && n.link.startsWith('messages:')
        ? n.link.slice('messages:'.length).trim()
        : '';
    const convId = fromLink || n.referenceId || '';
    return convId ? `messages:${convId}` : 'messages';
  }
  if (n.link) return n.link;
  if (n.type === 'new_classwork') return 'classwork';
  if (n.type === 'new_request') return 'requests';
  return null;
}

export const NotificationPopover: React.FC<NotificationPopoverProps> = ({
  role,
  unreadCount,
  onNavigate,
  onCountChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);
    notificationService
      .getNotifications()
      .then((list) => setNotifications(list))
      .catch(() => setNotifications([]))
      .finally(() => setIsLoading(false));
  }, [isOpen]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const handleMarkRead = async (id: string) => {
    try {
      await notificationService.markAsRead(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: 1 } : n)));
      onCountChange(Math.max(0, unreadCount - 1));
    } catch {
      // best-effort
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationService.markAllAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: 1 })));
      onCountChange(0);
    } catch {
      // best-effort
    }
  };

  const handleClick = (n: AppNotification) => {
    if (!n.isRead) handleMarkRead(n.id);
    const target = resolveNavigateTarget(n);
    if (target) onNavigate(target);
    setIsOpen(false);
  };

  const unread = notifications.filter((n) => !n.isRead).length;
  const copy = roleCopy[role];
  const EmptyIcon = copy.EmptyIcon;

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
        title="Notifications"
        aria-label="Notifications"
      >
        <BellIcon size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-rose-500 text-white text-[9px] font-bold">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#141417] shadow-2xl z-50 overflow-hidden animate-in fade-in-0 zoom-in-95 duration-200">
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200/80 dark:border-neutral-800/80">
            <h3 className="text-xs font-bold text-neutral-900 dark:text-neutral-100">{copy.heading}</h3>
            {unread > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-[11px] font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors cursor-pointer flex items-center gap-1"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Mark all read</span>
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-5 py-6 text-center">
                <div className="mb-2 flex size-8 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                  <EmptyIcon className="size-4" />
                </div>
                <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{copy.emptyTitle}</p>
                <p className="text-[11px] text-neutral-400 mt-1 max-w-[17rem] leading-relaxed">
                  {copy.emptyBody}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
                {notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={cn(
                      'w-full text-left px-4 py-3 flex items-start gap-3 transition-colors cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900/50',
                      !n.isRead && 'bg-neutral-50/60 dark:bg-neutral-900/30'
                    )}
                  >
                    <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                      {getNotifIcon(n.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p
                          className={cn(
                            'text-xs truncate',
                            !n.isRead
                              ? 'font-semibold text-neutral-900 dark:text-neutral-100'
                              : 'font-medium text-neutral-600 dark:text-neutral-400'
                          )}
                        >
                          {messagePreviewText(n.title, 'Notification')}
                        </p>
                        {!n.isRead && (
                          <span className="w-2 h-2 rounded-full bg-neutral-900 dark:bg-white shrink-0" />
                        )}
                      </div>
                      {n.body && (
                        <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 line-clamp-2">
                          {messagePreviewText(n.body, 'Open this notification for details')}
                        </p>
                      )}
                      <p className="text-[10px] text-neutral-400 mt-1">
                        {formatChatListTime(n.createdAt)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
