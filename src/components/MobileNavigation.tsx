import React from 'react';
import { ViewType } from '../types/homework';
import { Calendar, UploadCloud, Handshake, MessageCircle, Layers, Settings } from 'lucide-react';
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
    { id: 'classwork', label: 'Classwork', icon: UploadCloud },
    { id: 'requests', label: 'Requests', icon: Handshake },
    { id: 'messages', label: 'Messages', icon: MessageCircle },
    { id: 'all', label: 'All', icon: Layers },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 h-[calc(3.5rem+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] bg-neutral-100/95 dark:bg-[#121215]/95 border-t border-neutral-200/80 dark:border-neutral-800/80 backdrop-blur-md z-30 flex items-center justify-around px-1 select-none">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = activeView === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onViewChange(item.id)}
            className={cn(
              'group/mnav flex flex-col items-center justify-center gap-1 flex-1 h-full py-1 text-[10px] font-medium transition-all duration-200 cursor-pointer touch-manipulation active:scale-90',
              isActive
                ? 'text-neutral-900 dark:text-neutral-100 font-semibold'
                : 'text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
            )}
          >
            <Icon className={cn('w-4.5 h-4.5 transition-transform duration-200 group-hover/mnav:-rotate-6', isActive ? 'stroke-[2.3] scale-105' : 'stroke-[1.7]')} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
