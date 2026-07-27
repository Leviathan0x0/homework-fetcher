import React from 'react';
import { ViewType } from '../types/homework';
import { Calendar, UploadSimple, Handshake, ChatCircleDots, Stack, Gear } from '@phosphor-icons/react';
import LiquidGlass from 'liquid-glass-react';
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
    <div className="md:hidden fixed left-3 right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] max-w-md mx-auto z-40">
      <LiquidGlass
        blurAmount={0.08}
        displacementScale={50}
        saturation={140}
        aberrationIntensity={1.5}
        elasticity={0.25}
        cornerRadius={24}
        padding="0px"
        className="w-full"
      >
        <nav className="h-16 px-2 flex items-center justify-around select-none">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onViewChange(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className="flex flex-col items-center justify-center flex-1 h-full py-1 rounded-2xl cursor-pointer touch-manipulation group focus-visible:outline-none"
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
      </LiquidGlass>
    </div>
  );
};
