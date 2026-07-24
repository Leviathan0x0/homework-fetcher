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
    <nav className="md:hidden fixed bottom-3 left-3 right-3 max-w-md mx-auto h-16 rounded-3xl liquid-glass-nav text-neutral-900 dark:text-white z-40 px-2 flex items-center justify-around select-none">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = activeView === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onViewChange(item.id)}
            className="flex flex-col items-center justify-center flex-1 h-full py-1 cursor-pointer touch-manipulation group"
          >
            <div className={cn(
              'w-8 h-8 rounded-2xl flex items-center justify-center transition-all duration-200',
              isActive
                ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-sm'
                : 'bg-transparent text-neutral-500 dark:text-neutral-400'
            )}>
              <Icon size={18} weight={isActive ? "fill" : "regular"} />
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
