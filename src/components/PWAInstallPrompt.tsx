import React, { useEffect, useState } from 'react';
import { Download, Smartphone, X, Share } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_STORAGE_KEY = 'pwa_prompt_dismissed_v2';

export const PWAInstallPrompt: React.FC<{ variant?: 'banner' | 'button' }> = ({ variant = 'banner' }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check if user previously dismissed prompt
    if (localStorage.getItem(DISMISS_STORAGE_KEY) === 'true') {
      setDismissed(true);
    }

    // Detect if running in standalone mode (already installed PWA)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    if (isStandalone) {
      setIsInstalled(true);
      return;
    }

    // Detect iOS Safari
    const ua = window.navigator.userAgent;
    const iosDevice = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    setIsIOS(iosDevice);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissed(true);
    localStorage.setItem(DISMISS_STORAGE_KEY, 'true');
  };

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
    } else if (isIOS) {
      setShowIOSInstructions(true);
    } else {
      alert('To install, open Chrome menu (⋮ or ⋯) and select "Install Homework App" or "Add to Home Screen".');
    }
  };

  if (isInstalled || dismissed) return null;

  // Header Button Variant with Close (X) button
  if (variant === 'button') {
    return (
      <div className="inline-flex items-center rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-2xs border border-neutral-800 dark:border-neutral-200 overflow-hidden text-xs font-semibold">
        <button
          onClick={handleInstallClick}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-colors cursor-pointer"
          title="Install app to your home screen or search bar"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Install App</span>
        </button>
        <button
          onClick={handleDismiss}
          className="px-1.5 py-1.5 hover:bg-neutral-800 dark:hover:bg-neutral-200 text-neutral-300 dark:text-neutral-600 hover:text-white dark:hover:text-neutral-900 border-l border-neutral-800 dark:border-neutral-200 transition-colors cursor-pointer"
          title="Dismiss install button"
          aria-label="Close install prompt"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // Banner Variant
  return (
    <>
      <div className="relative group bg-neutral-100/90 dark:bg-neutral-900/90 backdrop-blur-md border border-neutral-200/80 dark:border-neutral-800/80 rounded-2xl p-4 shadow-sm text-neutral-900 dark:text-neutral-100 transition-all">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-neutral-200 dark:bg-neutral-800 border border-neutral-300/60 dark:border-neutral-700/60 flex items-center justify-center text-neutral-800 dark:text-neutral-200 shrink-0">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
                <span>Install Homework App</span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-neutral-200 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-300/60 dark:border-neutral-700/60">PWA</span>
              </h4>
              <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">
                Install on your Chrome/phone search bar for instant home screen access.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleInstallClick}
              className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-2xs active:scale-95 cursor-pointer flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Install</span>
            </button>
            <button
              onClick={handleDismiss}
              className="p-1.5 rounded-xl text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors cursor-pointer"
              title="Close install banner"
              aria-label="Close install banner"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* iOS Safari Installation Modal */}
      {showIOSInstructions && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-end sm:items-center justify-center p-4">
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-3xl p-6 max-w-sm w-full space-y-4 text-neutral-900 dark:text-white shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">Install on iPhone / iPad</h3>
              <button onClick={() => setShowIOSInstructions(false)} className="text-neutral-400 hover:text-neutral-900 dark:hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-neutral-600 dark:text-neutral-300">
              To install this app on your iOS home screen:
            </p>
            <ol className="text-xs text-neutral-600 dark:text-neutral-400 space-y-2.5 list-decimal list-inside pl-1">
              <li className="flex items-center gap-2">
                <span>Tap the</span>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 font-medium">
                  <Share className="w-3.5 h-3.5" /> Share
                </span>
                <span>button in Safari</span>
              </li>
              <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
              <li>Tap <strong>Add</strong> in the top right corner</li>
            </ol>
            <button
              onClick={() => setShowIOSInstructions(false)}
              className="w-full py-2.5 rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 font-bold text-xs hover:bg-neutral-800 dark:hover:bg-neutral-200"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
};
