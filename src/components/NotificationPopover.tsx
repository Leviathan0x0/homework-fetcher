import React, { useState, useEffect, useRef } from 'react';
import { notificationService, authService } from '../services/appwriteServices';
import { AppNotification } from '../types/homework';
import { Bell, X, CheckCheck, Loader2, UploadCloud, Handshake, MessageCircle, RefreshCw } from 'lucide-react';
import { cn } from '../utils/cn';

interface NotificationPopoverProps {
  unreadCount: number;
  onNavigate: (view: string) => void;
  onCountChange: (count: number) => void;
}

function getNotifIcon(type: string) {
  switch (type) {
    case 'new_classwork': return <UploadCloud className="w-4 h-4 text-indigo-500" />;
    case 'new_request': return <Handshake className="w-4 h-4 text-amber-500" />;
    case 'new_message': return <MessageCircle className="w-4 h-4 text-emerald-500" />;
    default: return <Bell className="w-4 h-4 text-neutral-500" />;
  }
}

export const NotificationPopover: React.FC<NotificationPopoverProps> = ({ unreadCount, onNavigate, onCountChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);
    authService.getCurrentUser().then((user) => {
      if (!user) {
        setNotifications([]);
        setIsLoading(false);
        return;
      }
      notificationService.getNotifications(user.id)
        .then((list) => setNotifications(list))
        .catch(() => setNotifications([]))
        .finally(() => setIsLoading(false));
    });
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
    } catch {}
  };

  const handleMarkAllRead = async () => {
    try {
      const user = await authService.getCurrentUser();
      if (user) {
        await notificationService.markAllAsRead(user.id);
      }
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: 1 })));
      onCountChange(0);
    } catch {}
  };

  const handleClick = (n: AppNotification) => {
    if (!n.isRead) handleMarkRead(n.id);
    if (n.link) {
      onNavigate(n.link);
      setIsOpen(false);
    }
  };

  const unread = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="relative" ref={popoverRef}>
      <button onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
        title="Notifications">
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-rose-500 text-white text-[9px] font-bold">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#141417] shadow-2xl z-50 overflow-hidden animate-in fade-in-0 zoom-in-95 duration-200">
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200/80 dark:border-neutral-800/80">
            <h3 className="text-xs font-bold text-neutral-900 dark:text-neutral-100">Notifications</h3>
            {unread > 0 && (
              <button onClick={handleMarkAllRead}
                className="text-[11px] font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors cursor-pointer flex items-center gap-1">
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
              <div className="flex flex-col items-center justify-center py-8 text-center px-4">
                <Bell className="w-8 h-8 text-neutral-300 dark:text-neutral-600 mb-2" />
                <p className="text-xs text-neutral-500">No notifications yet</p>
              </div>
            ) : (
              <div className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
                {notifications.map((n) => (
                  <button key={n.id} onClick={() => handleClick(n)}
                    className={cn(
                      'w-full text-left px-4 py-3 flex items-start gap-3 transition-colors cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900/50',
                      !n.isRead && 'bg-neutral-50/60 dark:bg-neutral-900/30'
                    )}>
                    <div className="mt-0.5 shrink-0">{getNotifIcon(n.type)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn('text-xs', !n.isRead ? 'font-semibold text-neutral-900 dark:text-neutral-100' : 'font-medium text-neutral-600 dark:text-neutral-400')}>
                          {n.title}
                        </p>
                        {!n.isRead && <span className="w-2 h-2 rounded-full bg-neutral-900 dark:bg-white shrink-0" />}
                      </div>
                      {n.body && (
                        <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 line-clamp-2">{n.body}</p>
                      )}
                      <p className="text-[10px] text-neutral-400 mt-1">
                        {new Date(n.createdAt).toLocaleDateString()} {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
