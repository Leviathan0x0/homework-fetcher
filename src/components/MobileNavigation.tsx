import React from 'react';
import { ViewType } from '../types/homework';
import { Calendar, UploadSimple, Handshake, ChatCircleDots, Stack, Gear } from '@phosphor-icons/react';
import { cn } from '../utils/cn';

interface MobileNavigationProps {
  activeView: ViewType;
  onViewChange: (view: ViewType) => void;
}

export const MobileNavigation: React.FC<MobileNavigationProps> = ({
  activeView,
  onViewChange,
}) => {
  const items: { id: ViewType; label: string; icon: React.ElementType }[] = [
    { id: 'today', label: 'Today', icon: Calendar },
    { id: 'classwork', label: 'Classwork', icon: UploadSimple },
    { id: 'requests', label: 'Requests', icon: Handshake },
    { id: 'messages', label: 'Messages', icon: ChatCircleDots },
    { id: 'all', label: 'All', icon: Stack },
    { id: 'settings', label: 'Settings', icon: Gear },
  ];

  return (
    <nav className="md:hidden fixed left-3 right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] max-w-md mx-auto h-16 rounded-3xl bg-white/95 dark:bg-[#141417]/95 border border-neutral-200 dark:border-neutral-800 shadow-lg text-neutral-900 dark:text-white z-40 px-2 flex items-center justify-around select-none">
      {items.map((item) => {
        const Icon = item.icon;
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
              <Icon size={22} weight={isActive ? "fill" : "regular"} />
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
