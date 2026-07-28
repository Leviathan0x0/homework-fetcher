import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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

  const items: { id: ViewType; label: string; IconComponent: React.ComponentType<{ size?: number; className?: string; isAnimated?: boolean }> }[] = [
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
        // Pin to the visual viewport bottom, then add home-indicator / margin gap.
        bottom: viewportBottomOffset,
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))',
        // Promote to its own layer so iOS scroll rubber-banding doesn’t jitter it.
        transform: 'translateZ(0)',
      }}
    >
      <div className="pointer-events-auto w-full max-w-md h-16 rounded-3xl bg-white/95 dark:bg-[#141417]/95 border border-neutral-200 dark:border-neutral-800 shadow-lg text-neutral-900 dark:text-white px-2 flex items-center justify-around select-none">
        {items.map((item) => {
          const IconComp = item.IconComponent;
          const isActive = activeView === item.id;
          const isHovered = hoveredId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onViewChange(item.id)}
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId(null)}
              aria-current={isActive ? 'page' : undefined}
              className="flex flex-col items-center justify-center flex-1 h-full py-1 rounded-2xl cursor-pointer touch-manipulation group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40 dark:focus-visible:ring-neutral-500/50"
            >
              <div
                className={cn(
                  'flex items-center justify-center transition-all duration-200',
                  isActive
                    ? 'text-neutral-900 dark:text-white scale-105'
                    : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
                )}
              >
                <IconComp size={22} isAnimated={isActive || isHovered} className="shrink-0" />
              </div>
              <span
                className={cn(
                  'text-[9px] leading-tight tracking-tight mt-1 truncate max-w-[56px] transition-colors',
                  isActive
                    ? 'text-neutral-900 dark:text-white font-semibold'
                    : 'text-neutral-500 dark:text-neutral-400'
                )}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );

  // Render on document.body so no parent transform/overflow can re-root `fixed`.
  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(nav, document.body);
};
