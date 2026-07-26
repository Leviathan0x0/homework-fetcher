import React from 'react';
import { ThemeMode } from '../types/homework';
import { Sun, Moon, Settings } from 'lucide-react';

interface MobileHeaderProps {
  theme: ThemeMode;
  onToggleTheme: () => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  isLoading: boolean;
}

export const MobileHeader: React.FC<MobileHeaderProps> = ({
  theme,
  onToggleTheme,
  onOpenSettings,
}) => {
  return (
    <header className="md:hidden flex items-center justify-between h-[calc(3.5rem+env(safe-area-inset-top))] px-4 bg-neutral-50/90 dark:bg-[#09090b]/90 border-b border-neutral-200/80 dark:border-neutral-800/80 sticky top-0 z-30 backdrop-blur-md pt-[env(safe-area-inset-top)]">
      <div className="flex items-center gap-2">
        <img src="/logo.svg" alt="MMSS Mohali" className="w-7 h-7 rounded-xl object-contain shadow-2xs" />
        <span className="font-semibold text-sm tracking-tight text-neutral-900 dark:text-neutral-100">
          MMSS Mohali
        </span>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={onToggleTheme}
          className="group/theme p-2.5 rounded-xl text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 active:bg-neutral-200/60 dark:active:bg-neutral-800/60 transition-all duration-200 touch-manipulation cursor-pointer active:scale-90"
          title="Toggle Theme"
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 transition-transform duration-300 group-hover/theme:rotate-45" />
          ) : (
            <Moon className="w-4 h-4 transition-transform duration-300 group-hover/theme:-rotate-12" />
          )}
        </button>

        <button
          onClick={onOpenSettings}
          className="group/set p-2.5 rounded-xl text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 active:bg-neutral-200/60 dark:active:bg-neutral-800/60 transition-all duration-200 touch-manipulation cursor-pointer active:scale-90"
          title="Settings"
        >
          <Settings className="w-4 h-4 transition-transform duration-300 group-hover/set:rotate-90" />
        </button>
      </div>
    </header>
  );
};
