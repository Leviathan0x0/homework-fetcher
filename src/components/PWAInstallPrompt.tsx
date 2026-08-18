import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallPrompt: React.FC<{ variant?: 'banner' | 'button' }> = ({ variant = 'banner' }) => {
  const { canInstall, isInstalled, install } = usePWAInstall();
  const [isInstalling, setIsInstalling] = useState(false);

  const handleInstallClick = async () => {
    setIsInstalling(true);
    try {
      await install();
    } catch (error) {
      console.error('[PWA] Native install prompt failed:', error);
    } finally {
      setIsInstalling(false);
    }
  };

  // Browsers that expose a native one-click install flow provide
  // beforeinstallprompt. Do not replace it with an imitation dialog.
  if (variant !== 'button' || isInstalled || !canInstall) return null;

  return (
    <button
      type="button"
      onClick={handleInstallClick}
      disabled={isInstalling}
      className="inline-flex shrink-0 touch-manipulation items-center gap-1.5 whitespace-nowrap rounded-xl border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-xs font-semibold text-white shadow-2xs transition-opacity hover:opacity-90 active:opacity-80 disabled:cursor-wait disabled:opacity-60 dark:border-neutral-200 dark:bg-white dark:text-neutral-900 sm:px-3"
      title="Install MMSS Mohali App"
      aria-label="Install MMSS Mohali App"
      aria-busy={isInstalling}
    >
      <Download className="w-3.5 h-3.5 shrink-0" />
      <span className="whitespace-nowrap max-[350px]:sr-only">
        {isInstalling ? 'Opening…' : 'Install'}
      </span>
    </button>
  );
};
