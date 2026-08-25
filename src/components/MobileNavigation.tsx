import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Reicon, type ReiconName } from './ui/reicon';
import { cn } from '../utils/cn';
import type { ViewType } from '../types/homework';

interface MobileNavigationProps {
  activeView: ViewType;
  onViewChange: (view: ViewType) => void;
  role: 'student' | 'teacher' | 'admin';
  messagesUnread?: number;
  openRequests?: number;
}

/**
 * Keeps the floating tab bar glued to the *visible* bottom of the screen.
 * Mobile Safari/Chrome shrink the visual viewport when the URL bar / toolbar
 * shows (~40–50px). A plain `position: fixed; bottom: …` then sits too high
 * with a gap underneath - most noticeable on tall scroll pages like
 * Classwork and Requests.
 */
const VIEW_CHANGE_VIEWPORT_SETTLE_MS = 120;

function measureVisualViewportBottomOffset() {
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
}

function useVisualViewportBottomOffset(activeView: ViewType) {
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(0);
  const previousViewRef = useRef(activeView);
  const isViewSettlingRef = useRef(false);
  const settleTimerRef = useRef<number | null>(null);

  const commitOffset = useCallback((next: number) => {
    offsetRef.current = next;
    setOffset((prev) => (prev === next ? prev : next));
  }, []);

  const finishViewSettle = useCallback(() => {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
    }
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      isViewSettlingRef.current = false;
      commitOffset(measureVisualViewportBottomOffset());
    }, VIEW_CHANGE_VIEWPORT_SETTLE_MS);
  }, [commitOffset]);

  useLayoutEffect(() => {
    if (previousViewRef.current === activeView) return;
    previousViewRef.current = activeView;
    if (!window.visualViewport) return;
    isViewSettlingRef.current = true;
    finishViewSettle();
  }, [activeView, finishViewSettle]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const sync = () => {
      const next = measureVisualViewportBottomOffset();

      // Changing between a tall and a short tab can make mobile browsers emit
      // a transient zero offset while they clamp the old page's scroll
      // position. Applying that value drops the dock behind the browser
      // toolbar for a frame. Keep the last safe position until those viewport
      // events settle, but still move upward immediately if the visible
      // viewport actually becomes shorter.
      if (isViewSettlingRef.current && next <= offsetRef.current) {
        finishViewSettle();
        return;
      }

      commitOffset(next);
    };

    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    return () => {
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [commitOffset, finishViewSettle]);

  return offset;
}

export const MobileNavigation: React.FC<MobileNavigationProps> = ({
  activeView,
  onViewChange,
  role,
  messagesUnread = 0,
  openRequests = 0,
}) => {
  const viewportBottomOffset = useVisualViewportBottomOffset(activeView);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Keep page content clear of the floating dock bar.
    document.documentElement.style.setProperty(
      '--mobile-nav-clearance',
      'calc(5.25rem + max(0.65rem, env(safe-area-inset-bottom, 0px)))'
    );
    return () => {
      document.documentElement.style.removeProperty('--mobile-nav-clearance');
    };
  }, []);

  type NavItem = {
    id: ViewType;
    label: string;
    iconName: ReiconName;
    badge?: number;
  };

  const studentItems: NavItem[] = [
    { id: 'today', label: 'Today', iconName: 'calendar-check' },
    { id: 'classwork', label: 'Uploads', iconName: 'upload' },
    { id: 'requests', label: 'Requests', iconName: 'heart-handshake', badge: openRequests > 0 ? openRequests : undefined },
    { id: 'messages', label: 'Messages', iconName: 'chat-line', badge: messagesUnread > 0 ? messagesUnread : undefined },
    { id: 'all', label: 'Search', iconName: 'search' },
  ];

  const teacherItems: NavItem[] = [
    { id: 'teacher-overview', label: 'Overview', iconName: 'activity' },
    { id: 'teacher-assignments', label: 'Tasks', iconName: 'paperclip' },
    { id: 'teacher-attendance', label: 'Roll', iconName: 'calendar-check' },
    { id: 'teacher-announcements', label: 'Updates', iconName: 'bell' },
    { id: 'teacher-students', label: 'Students', iconName: 'users' },
  ];

  const adminItems: NavItem[] = [
    { id: 'admin-overview', label: 'Overview', iconName: 'activity' },
    { id: 'admin-students', label: 'Students', iconName: 'users' },
    { id: 'admin-teachers', label: 'Staff', iconName: 'graduation-cap' },
    { id: 'admin-reports', label: 'Reports', iconName: 'flag' },
    { id: 'admin-alerts', label: 'Alerts', iconName: 'bell' },
  ];

  const items = role === 'admin' ? adminItems : role === 'teacher' ? teacherItems : studentItems;

  const nav = (
    <nav
      aria-label="Mobile Navigation"
      className="md:hidden fixed inset-x-0 bottom-0 z-40 flex justify-center px-3.5 pointer-events-none"
      style={{
        bottom: viewportBottomOffset,
        paddingBottom: 'max(0.65rem, env(safe-area-inset-bottom, 0px))',
        transform: 'translateZ(0)',
      }}
    >
      <div
        className={cn(
          'pointer-events-auto flex items-center justify-between gap-1 p-1.5 rounded-full',
          'bg-[#121215]/95 dark:bg-[#151518]/95 backdrop-blur-2xl',
          'border border-neutral-800/80 dark:border-white/[0.08]',
          'shadow-[0_8px_32px_rgba(0,0,0,0.38),0_2px_6px_rgba(0,0,0,0.2)]',
          'select-none'
        )}
      >
        {items.map((item) => {
          const isActive = activeView === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onViewChange(item.id)}
              aria-current={isActive ? 'page' : undefined}
              aria-label={item.label}
              className={cn(
                'relative h-10 rounded-full flex items-center justify-center',
                'cursor-pointer touch-manipulation',
                'transition-[width,padding,background-color,color] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
                isActive
                  ? 'bg-white text-neutral-950 shadow-xs px-3.5'
                  : 'bg-transparent text-neutral-400 hover:text-neutral-200 w-10 p-0'
              )}
            >
              <div className="flex items-center gap-1.5 overflow-hidden">
                <Reicon
                  name={item.iconName}
                  size={19}
                  className={cn(
                    'shrink-0 transition-colors duration-200',
                    isActive ? 'text-neutral-950' : 'text-neutral-400 hover:text-neutral-200'
                  )}
                />

                {item.badge !== undefined && (
                  <span
                    className={cn(
                      'absolute -top-1.5 -right-2 min-w-[14px] h-3.5 px-1 rounded-full text-[9px] font-bold tabular-nums flex items-center justify-center leading-none shadow-xs transition-colors duration-200',
                      isActive ? 'bg-neutral-950 text-white' : 'bg-rose-500 text-white'
                    )}
                  >
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                )}

                <span
                  className={cn(
                    'text-xs font-semibold tracking-tight whitespace-nowrap overflow-hidden transition-[max-width,opacity] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]',
                    isActive
                      ? 'max-w-[90px] opacity-100 text-neutral-950 ml-0.5'
                      : 'max-w-0 opacity-0 pointer-events-none ml-0'
                  )}
                >
                  {item.label}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </nav>
  );
  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(nav, document.body);
};
