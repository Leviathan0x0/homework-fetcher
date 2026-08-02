import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { cn } from '../utils/cn';

/**
 * Soft notice when the browser is offline - homework already loaded stays usable.
 */
export const OfflineBanner: React.FC<{ className?: string }> = ({ className }) => {
  const [offline, setOffline] = useState(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-amber-200/70 dark:border-amber-900/40 bg-amber-50/90 dark:bg-amber-950/40 text-xs text-amber-900 dark:text-amber-200 shadow-sm backdrop-blur-sm',
        className
      )}
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" aria-hidden />
      <div className="min-w-0 leading-relaxed">
        <p className="font-medium">You’re offline</p>
        <p className="text-amber-800/80 dark:text-amber-300/70 mt-0.5">
          Cached homework still works. Sync resumes when you’re back online.
        </p>
      </div>
    </div>
  );
};
