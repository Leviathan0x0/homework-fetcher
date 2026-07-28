import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LayoutGroup, motion } from 'motion/react';
import { ViewType } from '../types/homework';
import { CalendarCheckIcon } from '@/components/ui/calendar-check';
import { UploadIcon } from '@/components/ui/upload';
import { HeartHandshakeIcon } from '@/components/ui/heart-handshake';
import { MessageSquareIcon } from '@/components/ui/message-square';
import { LayersIcon } from '@/components/ui/layers';
import { SettingsIcon } from '@/components/ui/settings';
import { cn } from '../utils/cn';

interface MobileNavigationProps {
  activeView: ViewType;
  onViewChange: (view: ViewType) => void;
}

/**
 * Keeps the floating tab bar glued to the *visible* bottom of the screen.
 * Mobile Safari/Chrome shrink the visual viewport when the URL bar / toolbar
 * shows (~40–50px). A plain `position: fixed; bottom: …` then sits too high
 * with a gap underneath — most noticeable on tall scroll pages like
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
}) => {
  const viewportBottomOffset = useVisualViewportBottomOffset();
  const [mounted, setMounted] = useState(false);

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

  const items: {
    id: ViewType;
    label: string;
    IconComponent: React.ComponentType<{ size?: number; className?: string; isAnimated?: boolean }>;
  }[] = [
    { id: 'today', label: 'Today', IconComponent: CalendarCheckIcon },
    { id: 'classwork', label: 'Classwork', IconComponent: UploadIcon },
    { id: 'requests', label: 'Requests', IconComponent: HeartHandshakeIcon },
    { id: 'messages', label: 'Messages', IconComponent: MessageSquareIcon },
    { id: 'all', label: 'All', IconComponent: LayersIcon },
    { id: 'settings', label: 'Settings', IconComponent: SettingsIcon },
  ];

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
                    transition={indicatorSpring}
                    aria-hidden
                    className="absolute inset-0 rounded-[0.8rem] bg-neutral-900 dark:bg-white"
                  />
                )}

                <motion.span
                  whileTap={{ scale: 0.88 }}
                  transition={pressSpring}
                  className={cn(
                    'relative z-[1] flex items-center justify-center transition-colors duration-150',
                    isActive
                      ? 'text-white dark:text-neutral-900'
                      : 'text-neutral-400 dark:text-neutral-500'
                  )}
                >
                  <IconComp size={19} isAnimated={isActive} className="shrink-0" />
                </motion.span>

                <span
                  className={cn(
                    'relative z-[1] text-[10px] leading-none tracking-tight truncate max-w-[3.6rem] transition-colors duration-150',
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
