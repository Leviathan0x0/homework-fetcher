import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
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

const springSoft = { type: 'spring' as const, stiffness: 420, damping: 32, mass: 0.7 };
const springSnap = { type: 'spring' as const, stiffness: 520, damping: 36, mass: 0.55 };

export const MobileNavigation: React.FC<MobileNavigationProps> = ({
  activeView,
  onViewChange,
}) => {
  const [hoveredId, setHoveredId] = useState<ViewType | null>(null);
  const viewportBottomOffset = useVisualViewportBottomOffset();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
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
      className="md:hidden fixed inset-x-0 z-40 flex justify-center px-3 pointer-events-none"
      style={{
        bottom: viewportBottomOffset,
        paddingBottom: 'max(0.65rem, env(safe-area-inset-bottom, 0px))',
        transform: 'translateZ(0)',
      }}
    >
      <motion.div
        initial={{ y: 28, opacity: 0, scale: 0.96 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={springSoft}
        className={cn(
          'pointer-events-auto relative w-full max-w-[22.5rem]',
          'rounded-[1.35rem] px-1.5 py-1.5',
          'flex items-stretch justify-between gap-0.5',
          'bg-white/80 dark:bg-[#121215]/82',
          'backdrop-blur-2xl backdrop-saturate-150',
          'border border-white/70 dark:border-white/[0.08]',
          'shadow-[0_10px_40px_-12px_rgba(15,23,42,0.35),0_0_0_1px_rgba(15,23,42,0.04),inset_0_1px_0_rgba(255,255,255,0.65)]',
          'dark:shadow-[0_12px_40px_-10px_rgba(0,0,0,0.65),0_0_0_1px_rgba(255,255,255,0.04),inset_0_1px_0_rgba(255,255,255,0.06)]',
          'select-none'
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[1.35rem] bg-gradient-to-b from-white/50 to-transparent dark:from-white/[0.06] dark:to-transparent"
        />

        <LayoutGroup id="mobile-nav">
          {items.map((item) => {
            const IconComp = item.IconComponent;
            const isActive = activeView === item.id;
            const isHovered = hoveredId === item.id;

            return (
              <motion.button
                key={item.id}
                type="button"
                onClick={() => onViewChange(item.id)}
                onMouseEnter={() => setHoveredId(item.id)}
                onMouseLeave={() => setHoveredId(null)}
                aria-current={isActive ? 'page' : undefined}
                aria-label={item.label}
                whileTap={{ scale: 0.9 }}
                transition={springSnap}
                className={cn(
                  'relative z-[1] flex flex-1 flex-col items-center justify-center gap-0.5',
                  'min-w-0 h-[3.25rem] rounded-[1.05rem]',
                  'cursor-pointer touch-manipulation',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent'
                )}
              >
                {/* Sliding active pill */}
                <AnimatePresence>
                  {isActive && (
                    <motion.span
                      layoutId="mobile-nav-pill"
                      className="absolute inset-0 rounded-[1.05rem] bg-neutral-900/[0.07] dark:bg-white/[0.1]"
                      transition={springSoft}
                    />
                  )}
                </AnimatePresence>

                {/* Active top accent */}
                <AnimatePresence>
                  {isActive && (
                    <motion.span
                      layoutId="mobile-nav-accent"
                      initial={{ opacity: 0, scaleX: 0.4 }}
                      animate={{ opacity: 1, scaleX: 1 }}
                      exit={{ opacity: 0, scaleX: 0.4 }}
                      transition={springSnap}
                      aria-hidden
                      className="absolute inset-x-2 top-1 h-[2px] origin-center rounded-full bg-indigo-500 dark:bg-indigo-400"
                    />
                  )}
                </AnimatePresence>

                <motion.span
                  animate={{
                    scale: isActive ? 1.12 : 1,
                    y: isActive ? -0.5 : 0,
                  }}
                  transition={springSnap}
                  className={cn(
                    'relative z-[1] flex items-center justify-center',
                    isActive
                      ? 'text-indigo-600 dark:text-indigo-400'
                      : isHovered
                        ? 'text-neutral-700 dark:text-neutral-200'
                        : 'text-neutral-500 dark:text-neutral-400'
                  )}
                >
                  <IconComp
                    size={20}
                    isAnimated={isActive || isHovered}
                    className="shrink-0"
                  />
                </motion.span>

                <motion.span
                  animate={{
                    opacity: isActive ? 1 : 0.85,
                    y: isActive ? 0 : 1,
                  }}
                  transition={springSnap}
                  className={cn(
                    'relative z-[1] text-[8.5px] leading-none tracking-[-0.02em] truncate max-w-[3.4rem]',
                    isActive
                      ? 'font-semibold text-neutral-900 dark:text-white'
                      : 'font-medium text-neutral-500 dark:text-neutral-400'
                  )}
                >
                  {item.label}
                </motion.span>
              </motion.button>
            );
          })}
        </LayoutGroup>
      </motion.div>
    </nav>
  );

  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(nav, document.body);
};
