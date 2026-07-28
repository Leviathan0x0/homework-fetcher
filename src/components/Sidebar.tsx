import React, { useState } from 'react';
import { ViewType, SessionStatus } from '../types/homework';
import { CalendarCheckIcon } from '@/components/ui/calendar-check';
import { ClockIcon } from '@/components/ui/clock';
import { LayersIcon } from '@/components/ui/layers';
import { AttachFileIcon } from '@/components/ui/attach-file';
import { SettingsIcon } from '@/components/ui/settings';
import { cn } from '../utils/cn';

interface SidebarProps {
  activeView: ViewType;
  onViewChange: (view: ViewType) => void;
  sessionStatus: SessionStatus;
  todayCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeView,
  onViewChange,
  sessionStatus,
  todayCount,
}) => {
  const [hoveredId, setHoveredId] = useState<ViewType | null>(null);

  const navItems: { id: ViewType; label: string; IconComponent: React.ComponentType<{ size?: number; className?: string; isAnimated?: boolean }>; badge?: number }[] = [
    { id: 'today', label: 'Today', IconComponent: CalendarCheckIcon, badge: todayCount > 0 ? todayCount : undefined },
    { id: 'recent', label: 'Recent', IconComponent: ClockIcon },
    { id: 'all', label: 'All Homework', IconComponent: LayersIcon },
    { id: 'attachments', label: 'Attachments', IconComponent: AttachFileIcon },
  ];

  return (
    <aside className="hidden md:flex flex-col justify-between w-60 bg-neutral-100/70 dark:bg-[#121215] border-r border-neutral-200/80 dark:border-neutral-800/80 p-4 shrink-0 h-screen sticky top-0">
      <div className="space-y-6">
        {/* Wordmark Header */}
        <div className="flex items-center gap-2 px-2 py-1 group/brand">
          <div className="w-7 h-7 rounded-lg bg-white flex items-center justify-center shrink-0 transition-transform duration-300 group-hover/brand:scale-105 shadow-2xs p-0.5 border border-neutral-200/60 dark:border-neutral-800/60 overflow-hidden">
            <img src="/logo.png" alt="Homework Logo" className="w-full h-full object-contain" />
          </div>
          <span className="font-semibold text-sm tracking-tight text-neutral-900 dark:text-neutral-100">
            Homework
          </span>
        </div>

        {/* Navigation List */}
        <nav className="space-y-1">
          {navItems.map((item) => {
            const IconComp = item.IconComponent;
            const isActive = activeView === item.id;
            const isHovered = hoveredId === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onViewChange(item.id)}
                onMouseEnter={() => setHoveredId(item.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={cn(
                  'group/nav w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium transition-colors duration-150 cursor-pointer active:scale-[0.98]',
                  isActive
                    ? 'bg-white dark:bg-[#1f1f23] text-neutral-900 dark:text-neutral-100 shadow-2xs font-semibold'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'
                )}
              >
                <div className="flex items-center gap-2.5">
                  <IconComp size={16} isAnimated={isActive || isHovered} className={cn('shrink-0', isActive ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-400')} />
                  <span>{item.label}</span>
                </div>

                {item.badge !== undefined && (
                  <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-neutral-200 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Sidebar Footer: Settings & Status Indicator */}
      <div className="space-y-2 pt-4 border-t border-neutral-200/60 dark:border-neutral-800/60">
        <button
          onClick={() => onViewChange('settings')}
          onMouseEnter={() => setHoveredId('settings')}
          onMouseLeave={() => setHoveredId(null)}
          className={cn(
            'group/set w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors duration-150 cursor-pointer active:scale-[0.98]',
            activeView === 'settings'
              ? 'bg-white dark:bg-[#1f1f23] text-neutral-900 dark:text-neutral-100 shadow-2xs font-semibold'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'
          )}
        >
          <SettingsIcon size={16} isAnimated={activeView === 'settings' || hoveredId === 'settings'} className="text-neutral-400 shrink-0" />
          <span>Settings</span>
        </button>

        {/* Session Status Dot */}
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-neutral-200/40 dark:bg-neutral-800/40 text-[11px] text-neutral-500 dark:text-neutral-400 border border-neutral-200/40 dark:border-neutral-800/40">
          <span
            className={cn(
              'w-2 h-2 rounded-full shrink-0 animate-pulse-glow',
              sessionStatus === 'connected' && 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]',
              sessionStatus === 'expired' && 'bg-amber-500',
              sessionStatus === 'disconnected' && 'bg-rose-500'
            )}
          />
          <span className="truncate capitalize font-medium">
            {sessionStatus === 'connected' ? 'Session Active' : sessionStatus === 'expired' ? 'Session Expired' : 'No Cookies'}
          </span>
        </div>
      </div>
    </aside>
  );
};
