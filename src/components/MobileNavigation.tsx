import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import {
  Flag,
  LayoutDashboard,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { ViewType } from '../types/homework';
import { CalendarCheckIcon } from '@/components/ui/calendar-check';
import { UploadIcon } from '@/components/ui/upload';
import { HeartHandshakeIcon } from '@/components/ui/heart-handshake';
import { MessageSquareIcon } from '@/components/ui/message-square';
import { SearchIcon } from '@/components/ui/search';
import { SettingsIcon } from '@/components/ui/settings';
import { AttachFileIcon } from '@/components/ui/attach-file';
import { BellIcon } from '@/components/ui/bell';
import { GraduationCapIcon } from '@/components/ui/graduation-cap';
import { AnimatedIcon, type AnimationPreset } from '@/components/ui/animated-icon';
import { cn } from '../utils/cn';

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

// A single, restrained spring reused everywhere so every motion in the bar
// feels like one mechanism, not several competing effects.
const indicatorSpring = { type: 'spring' as const, stiffness: 520, damping: 42, mass: 0.6 };
const pressSpring = { type: 'spring' as const, stiffness: 700, damping: 30 };

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
    // Keep page content clear of the fixed dock (bar + gap + home-indicator).
    document.documentElement.style.setProperty(
      '--mobile-nav-clearance',
      'calc(5.75rem + max(0.6rem, env(safe-area-inset-bottom, 0px)))'
    );
    return () => {
      document.documentElement.style.removeProperty('--mobile-nav-clearance');
    };
  }, []);

  type NavItem = {
    id: ViewType;
    label: string;
    IconComponent?: React.ComponentType<{ size?: number; className?: string; isAnimated?: boolean }>;
    icon?: LucideIcon;
    preset?: AnimationPreset;
    badge?: number;
  };

  const studentItems: NavItem[] = [
    { id: 'today', label: 'Today', IconComponent: CalendarCheckIcon },
    { id: 'classwork', label: 'Uploads', IconComponent: UploadIcon },
    { id: 'requests', label: 'Requests', IconComponent: HeartHandshakeIcon, badge: openRequests > 0 ? openRequests : undefined },
    { id: 'messages', label: 'Messages', IconComponent: MessageSquareIcon, badge: messagesUnread > 0 ? messagesUnread : undefined },
    { id: 'all', label: 'Search', IconComponent: SearchIcon },
    { id: 'settings', label: 'Settings', IconComponent: SettingsIcon },
  ];
  const teacherItems: NavItem[] = [
    { id: 'teacher-overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'teacher-assignments', label: 'Tasks', IconComponent: AttachFileIcon },
    { id: 'teacher-attendance', label: 'Roll', IconComponent: CalendarCheckIcon },
    { id: 'teacher-announcements', label: 'Updates', IconComponent: BellIcon },
    { id: 'teacher-students', label: 'Students', icon: Users },
    { id: 'settings', label: 'Settings', IconComponent: SettingsIcon },
  ];
  const adminItems: NavItem[] = [
    { id: 'admin-overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'admin-students', label: 'Students', icon: Users },
    { id: 'admin-teachers', label: 'Staff', IconComponent: GraduationCapIcon },
    { id: 'admin-reports', label: 'Reports', icon: Flag, preset: 'lift' },
    { id: 'admin-alerts', label: 'Alerts', IconComponent: BellIcon },
    { id: 'settings', label: 'Settings', IconComponent: SettingsIcon },
  ];
  const items = role === 'admin' ? adminItems : role === 'teacher' ? teacherItems : studentItems;

  const nav = (
    <nav
      aria-label="Primary"
      className="md:hidden fixed inset-x-0 z-40 flex justify-center px-4 pointer-events-none"
      style={{
        bottom: viewportBottomOffset,
        paddingBottom: 'max(0.6rem, env(safe-area-inset-bottom, 0px))',
        transform: 'translateZ(0)',
      }}
    >
      <div
        className={cn(
          'pointer-events-auto w-full max-w-[23rem]',
          'rounded-[1.15rem] p-1',
          'flex items-stretch justify-between',
          // A near-opaque surface with a hairline border reads as a real native
          // control rather than a generic frosted-glass overlay.
          'bg-[#fbfbfb]/[0.98] dark:bg-[#151517]/[0.98]',
          'border border-neutral-200/70 dark:border-white/[0.07]',
          'shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-14px_rgba(15,23,42,0.28)]',
          'dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_12px_28px_-14px_rgba(0,0,0,0.55)]',
          'select-none'
        )}
      >
        <LayoutGroup id="mobile-nav">
          {items.map((item) => {
            const IconComp = item.IconComponent;
            const isActive = activeView === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onViewChange(item.id)}
                aria-current={isActive ? 'page' : undefined}
                aria-label={item.label}
                className={cn(
                  'relative flex flex-1 flex-col items-center justify-center gap-[3px]',
                  'min-w-0 h-[3.1rem] rounded-[0.8rem]',
                  'cursor-pointer touch-manipulation',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20 dark:focus-visible:ring-white/25'
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="mobile-nav-indicator"
                    transition={prefersReducedMotion ? { duration: 0 } : indicatorSpring}
                    aria-hidden
                    className="absolute inset-0 rounded-[0.8rem] bg-neutral-900 dark:bg-white"
                  />
                )}

                <motion.span
                  whileTap={prefersReducedMotion ? undefined : { scale: 0.88 }}
                  transition={prefersReducedMotion ? { duration: 0 } : pressSpring}
                  className={cn(
                    'relative z-[1] flex items-center justify-center transition-colors duration-150',
                    isActive
                      ? 'text-white dark:text-neutral-900'
                      : 'text-neutral-400 dark:text-neutral-500'
                  )}
                >
                  {IconComp ? (
                    <IconComp size={19} isAnimated={isActive} className="shrink-0" />
                  ) : item.icon ? (
                    <AnimatedIcon
                      icon={item.icon}
                      preset={item.preset || 'scale'}
                      isActive={isActive}
                      size={19}
                      className="shrink-0"
                    />
                  ) : null}
                  {item.badge !== undefined && (
                    <span
                      className={cn(
                        'absolute -top-1.5 -right-2.5 min-w-[1rem] h-4 px-1 rounded-full text-[9px] font-bold tabular-nums flex items-center justify-center leading-none',
                        isActive
                          ? 'bg-white text-neutral-900 dark:bg-neutral-900 dark:text-white'
                          : 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                      )}
                    >
                      {item.badge > 9 ? '9+' : item.badge}
                    </span>
                  )}
                </motion.span>

                <span
                  className={cn(
                    'relative z-[1] max-w-[3.6rem] truncate text-[10px] leading-none tracking-tight transition-colors duration-150 max-[359px]:sr-only',
                    isActive
                      ? 'font-medium text-white dark:text-neutral-900'
                      : 'font-medium text-neutral-400 dark:text-neutral-500'
                  )}
                >
                  {item.label}
                </span>
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
