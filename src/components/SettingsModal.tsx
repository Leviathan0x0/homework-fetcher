import React from 'react';
import { ThemeMode, SessionStatus } from '../types/homework';
import { UserAccount } from '../hooks/useHomework';
import { X, User, LogOut, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { cn } from '../utils/cn';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserAccount | null;
  onLogout: () => void;
  sessionStatus: SessionStatus;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  user,
  onLogout,
  sessionStatus,
  theme,
  onThemeChange,
}) => {
  if (!isOpen) return null;

  const handleSignOut = () => {
    onLogout();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 dark:bg-black/70 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white dark:bg-[#18181b] border border-neutral-200 dark:border-neutral-800 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-neutral-100 dark:border-neutral-800/80 shrink-0">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Settings & account</h2>
          <button
            onClick={onClose}
            className="group/close p-2 sm:p-1 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors duration-150 touch-manipulation cursor-pointer active:scale-90"
          >
            <X className="w-5 h-5 sm:w-4 sm:h-4 transition-transform duration-200 group-hover/close:rotate-90" />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-6 overflow-y-auto flex-1 pb-safe">
          {/* Section 1: User Account & Session Status */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                School account
              </h3>
              <div className="flex items-center gap-1.5 text-xs">
                {sessionStatus === 'connected' ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Session active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5 animate-wiggle-subtle" /> Session expired
                  </span>
                )}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200/80 dark:border-neutral-800 flex items-center justify-between transition-colors duration-150 hover:border-neutral-300 dark:hover:border-neutral-700">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center text-neutral-700 dark:text-neutral-300 font-semibold text-xs">
                  <User className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs text-neutral-400 dark:text-neutral-500 font-medium">Student ID</div>
                  <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 font-mono">
                    {user?.studentId || 'Authenticated'}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSignOut}
                className="group/logout inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-rose-600 hover:text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors duration-150 cursor-pointer active:scale-95"
              >
                <LogOut className="w-3.5 h-3.5 transition-transform duration-200 group-hover/logout:-translate-x-0.5" />
                <span>Sign out</span>
              </button>
            </div>
          </div>

          {/* Section 2: Appearance Theme */}
          <div className="space-y-3 pt-4 border-t border-neutral-100 dark:border-neutral-800/80">
            <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
              Appearance
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {(['light', 'dark', 'system'] as ThemeMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onThemeChange(mode)}
                  className={cn(
                    'py-2 px-3 rounded-lg border text-xs font-medium capitalize transition-colors duration-150 cursor-pointer text-center active:scale-95',
                    theme === mode
                      ? 'border-neutral-900 dark:border-neutral-100 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 shadow-2xs font-semibold'
                      : 'border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-700'
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {/* Section 3: App Identity & Security Info */}
          <div className="pt-4 border-t border-neutral-100 dark:border-neutral-800/80 flex items-center justify-between text-xs text-neutral-400">
            <span className="flex items-center gap-1.5 group/sec">
              <ShieldCheck className="w-4 h-4 text-emerald-500 transition-transform duration-200 group-hover/sec:rotate-12" />
              <span>Secure HTTP-only session</span>
            </span>
            <span className="font-mono text-[11px]">v1.1.0</span>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end pt-4 border-t border-neutral-100 dark:border-neutral-800/80">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors duration-150 cursor-pointer touch-manipulation active:scale-95"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
