import React from 'react';
import { AlertCircle, RefreshCw, KeyRound } from 'lucide-react';

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
  onOpenSettings?: () => void;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ message, onRetry, onOpenSettings }) => {
  const isSessionError = message.toLowerCase().includes('session') || message.toLowerCase().includes('cookie') || message.toLowerCase().includes('expire');

  return (
    <div className="bg-amber-500/10 border border-amber-500/20 text-amber-900 dark:text-amber-200 rounded-xl p-4 mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs leading-relaxed animate-in fade-in duration-200 animate-shake-subtle">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 animate-pop-bounce" />
        <div>
          <p className="font-semibold">{isSessionError ? 'Your school session needs to be updated.' : 'Couldn\'t refresh your homework.'}</p>
          <p className="text-neutral-600 dark:text-neutral-400 text-[11px] mt-0.5">{message}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
        {isSessionError && onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="group/sec inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium text-xs transition-colors duration-150 shadow-2xs cursor-pointer active:scale-95"
          >
            <KeyRound className="w-3.5 h-3.5 transition-transform duration-200 group-hover/sec:rotate-12" />
            <span>Update session</span>
          </button>
        )}

        {onRetry && (
          <button
            onClick={onRetry}
            className="group/retry inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 hover:bg-neutral-800 dark:hover:bg-neutral-200 text-neutral-100 dark:text-neutral-900 font-medium text-xs transition-colors duration-150 cursor-pointer active:scale-95"
          >
            <RefreshCw className="w-3 h-3 transition-transform duration-300 group-hover/retry:rotate-180" />
            <span>Try again</span>
          </button>
        )}
      </div>
    </div>
  );
};
