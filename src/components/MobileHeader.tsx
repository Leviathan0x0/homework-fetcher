import React from 'react';
import { ThemeMode } from '../types/homework';
import { Sun, Moon, Settings } from 'lucide-react';
import { PWAInstallPrompt } from './PWAInstallPrompt';

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
    <header className="md:hidden flex items-center justify-between gap-2 h-[calc(3.5rem+env(safe-area-inset-top))] px-4 bg-neutral-50/90 dark:bg-[#09090b]/90 border-b border-neutral-200/80 dark:border-neutral-800/80 sticky top-0 z-30 backdrop-blur-md pt-[env(safe-area-inset-top)] overflow-hidden">
      <div className="flex items-center gap-2 group/brand min-w-0 shrink">
        <div className="w-7 h-7 rounded-xl bg-white flex items-center justify-center shrink-0 shadow-2xs transition-transform duration-300 group-hover/brand:scale-105 p-0.5 border border-neutral-200/60 dark:border-neutral-800/60 overflow-hidden">
          <img src="/logo.png" alt="MMSS Mohali Logo" className="w-full h-full object-contain" />
        </div>
        <span className="font-semibold text-sm tracking-tight text-neutral-900 dark:text-neutral-100 truncate">
          MMSS Mohali
        </span>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <PWAInstallPrompt variant="button" />

        <button
          onClick={onToggleTheme}
          className="group/theme p-2 rounded-xl text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 active:bg-neutral-200/60 dark:active:bg-neutral-800/60 transition-all duration-200 touch-manipulation cursor-pointer active:scale-90"
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
          className="group/set p-2 rounded-xl text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 active:bg-neutral-200/60 dark:active:bg-neutral-800/60 transition-all duration-200 touch-manipulation cursor-pointer active:scale-90"
          title="Settings"
        >
          <Settings className="w-4 h-4 transition-transform duration-300 group-hover/set:rotate-90" />
        </button>
      </div>
    </header>
  );
};
