import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
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
function useVisualViewportBottomOffset() {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const sync = () => {
      const next = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      setOffset((prev) => (prev === next ? prev : next));
    };

    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  return offset;
}

const dockSpring = { type: 'spring' as const, stiffness: 520, damping: 38, mass: 0.6 };
export const MobileNavigation: React.FC<MobileNavigationProps> = ({
  activeView,
  onViewChange,
  role,
  messagesUnread = 0,
  openRequests = 0,
}) => {
  const viewportBottomOffset = useVisualViewportBottomOffset();
  const [mounted, setMounted] = useState(false);
  const prefersReducedMotion = useReducedMotion();

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
    { id: 'messages', label: 'Messages', iconName: 'message-square', badge: messagesUnread > 0 ? messagesUnread : undefined },
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
        <LayoutGroup id="mobile-floating-dock">
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
                  'relative h-10 flex items-center justify-center rounded-full',
                  'cursor-pointer touch-manipulation transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
                  isActive ? 'px-3.5' : 'w-10'
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="dock-active-pill"
                    transition={prefersReducedMotion ? { duration: 0 } : dockSpring}
                    style={{ borderRadius: 9999 }}
                    aria-hidden
                    className="absolute inset-0 bg-white shadow-xs pointer-events-none"
                  />
                )}

                <div className="relative z-[1] flex items-center gap-1.5">
                  <Reicon
                    name={item.iconName}
                    size={19}
                    className={cn(
                      'shrink-0 transition-colors duration-150',
                      isActive
                        ? 'text-neutral-950'
                        : 'text-neutral-400 hover:text-neutral-200'
                    )}
                  />

                  {item.badge !== undefined && (
                    <span
                      className={cn(
                        'absolute -top-1.5 -right-2 min-w-[14px] h-3.5 px-1 rounded-full text-[9px] font-bold tabular-nums flex items-center justify-center leading-none shadow-xs',
                        isActive
                          ? 'bg-neutral-950 text-white'
                          : 'bg-rose-500 text-white'
                      )}
                    >
                      {item.badge > 9 ? '9+' : item.badge}
                    </span>
                  )}

                  {isActive && (
                    <motion.span
                      initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.15, ease: 'easeOut' }}
                      className="text-xs font-semibold text-neutral-950 tracking-tight whitespace-nowrap"
                    >
                      {item.label}
                    </motion.span>
                  )}
                </div>
              </button>
            );
          })}
        </LayoutGroup>
      </div>
    </nav>
  );
  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(nav, document.body);
};
