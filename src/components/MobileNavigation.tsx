import React from 'react';
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

export const MobileNavigation: React.FC<MobileNavigationProps> = ({
  activeView,
  onViewChange,
}) => {
  const items: { id: ViewType; label: string; IconComponent: React.ComponentType<{ size?: number; className?: string }> }[] = [
    { id: 'today', label: 'Today', IconComponent: CalendarCheckIcon },
    { id: 'classwork', label: 'Classwork', IconComponent: UploadIcon },
    { id: 'requests', label: 'Requests', IconComponent: HeartHandshakeIcon },
    { id: 'messages', label: 'Messages', IconComponent: MessageSquareIcon },
    { id: 'all', label: 'All', IconComponent: LayersIcon },
    { id: 'settings', label: 'Settings', IconComponent: SettingsIcon },
  ];

  return (
    <nav className="md:hidden fixed left-3 right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] max-w-md mx-auto h-16 rounded-3xl bg-white/95 dark:bg-[#141417]/95 border border-neutral-200 dark:border-neutral-800 shadow-lg text-neutral-900 dark:text-white z-40 px-2 flex items-center justify-around select-none">
      {items.map((item) => {
        const IconComp = item.IconComponent;
        const isActive = activeView === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onViewChange(item.id)}
            aria-current={isActive ? 'page' : undefined}
            className="flex flex-col items-center justify-center flex-1 h-full py-1 rounded-2xl cursor-pointer touch-manipulation group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40 dark:focus-visible:ring-neutral-500/50"
          >
            <div className={cn(
              'flex items-center justify-center transition-all duration-200',
              isActive
                ? 'text-neutral-900 dark:text-white scale-105'
                : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
            )}>
              <IconComp size={22} className="shrink-0" />
            </div>
            <span className={cn(
              'text-[9px] leading-tight tracking-tight mt-0.5 truncate max-w-[56px] transition-colors',
              isActive ? 'text-neutral-900 dark:text-white font-semibold' : 'text-neutral-500 dark:text-neutral-400'
            )}>
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
