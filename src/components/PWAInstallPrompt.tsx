import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Smartphone, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'pwa_prompt_dismissed_at_v6';
const INSTALLED_KEY = 'pwa_installed_v5';
const DELAY_START_KEY = 'pwa_banner_delay_started_at_v1';
/** Soft-dismiss: show again after 3 days. */
const DISMISS_TTL_MS = 3 * 24 * 60 * 60 * 1000;
/** Don’t interrupt the first glance — wait a bit after load. */
const BANNER_DELAY_MS = 12_000;

function wasDismissedRecently(): boolean {
  const raw = localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const at = Number(raw);
  if (!Number.isFinite(at)) return true;
  return Date.now() - at < DISMISS_TTL_MS;
}

export const PWAInstallPrompt: React.FC<{ variant?: 'banner' | 'button' }> = ({ variant = 'banner' }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [delayReady, setDelayReady] = useState(variant === 'button');

  useEffect(() => {
    if (localStorage.getItem(INSTALLED_KEY) === 'true' || wasDismissedRecently()) {
      setIsDismissed(true);
    }

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true ||
      document.referrer.includes('android-app://');

    if (isStandalone) {
      setIsInstalled(true);
      setIsDismissed(true);
      localStorage.setItem(INSTALLED_KEY, 'true');
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setIsDismissed(true);
      localStorage.setItem(INSTALLED_KEY, 'true');
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    if (variant !== 'banner') return;
    let started = Number(sessionStorage.getItem(DELAY_START_KEY));
    if (!Number.isFinite(started) || started <= 0) {
      started = Date.now();
      try {
        sessionStorage.setItem(DELAY_START_KEY, String(started));
      } catch {
        // ignore
      }
    }
    const remaining = Math.max(0, BANNER_DELAY_MS - (Date.now() - started));
    if (remaining === 0) {
      setDelayReady(true);
      return;
    }
    const t = window.setTimeout(() => setDelayReady(true), remaining);
    return () => window.clearTimeout(t);
  }, [variant]);

  const handleDismiss = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setIsDismissed(true);
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  };

  const handleCloseModal = () => {
    setShowHelpModal(false);
    setIsDismissed(true);
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  };

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          setIsInstalled(true);
          setIsDismissed(true);
          localStorage.setItem(INSTALLED_KEY, 'true');
          localStorage.setItem(DISMISS_KEY, String(Date.now()));
        }
        setDeferredPrompt(null);
      } catch {
        setShowHelpModal(true);
      }
    } else {
      setShowHelpModal(true);
    }
  };

  if (isInstalled || isDismissed) return null;
  if (variant === 'banner' && !delayReady) return null;

  const ModalContent = showHelpModal
    ? createPortal(
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#141417] text-neutral-900 dark:text-neutral-100 border border-neutral-200/80 dark:border-neutral-800 rounded-2xl p-6 max-w-md w-full space-y-5 shadow-xl relative animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                  Install MMSS Mohali App
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                  Follow the instructions below for your device
                </p>
              </div>
              <button
                onClick={handleCloseModal}
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs text-neutral-700 dark:text-neutral-300">
              <div className="space-y-1">
                <div className="font-semibold text-neutral-900 dark:text-neutral-100">Option 1: Address Bar</div>
                <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed">
                  Click the <strong>Install</strong> icon in the right corner of your browser&apos;s address bar.
                </p>
              </div>

              <div className="space-y-1.5 pt-2.5 border-t border-neutral-100 dark:border-neutral-800">
                <div className="font-semibold text-neutral-900 dark:text-neutral-100">Option 2: Desktop Menu</div>
                <ol className="list-decimal list-inside space-y-1 text-neutral-600 dark:text-neutral-400">
                  <li>Click the <strong>3-dots menu (⋮)</strong> in the top right.</li>
                  <li>Click or hover <strong>Cast, save and share</strong>.</li>
                  <li>Click <strong>Install MMSS Mohali...</strong>.</li>
                </ol>
              </div>

              <div className="space-y-1.5 pt-2.5 border-t border-neutral-100 dark:border-neutral-800">
                <div className="font-semibold text-neutral-900 dark:text-neutral-100">Option 3: Mobile (Android &amp; iOS)</div>
                <ul className="space-y-1.5 text-neutral-600 dark:text-neutral-400">
                  <li>
                    <strong>Android:</strong> Tap <strong>3-dots menu (⋮)</strong> → select <strong>Add to Home screen</strong> or{' '}
                    <strong>Install app</strong>.
                  </li>
                  <li>
                    <strong>iOS (iPhone/iPad):</strong> Tap <strong>Share</strong> icon in Safari → tap <strong>View More</strong> →
                    select <strong>Add to Home Screen</strong> → tap <strong>Add</strong>.
                  </li>
                </ul>
              </div>
            </div>

            <button
              onClick={handleCloseModal}
              className="w-full py-2.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium text-xs hover:opacity-90 transition-opacity cursor-pointer"
            >
              Got it
            </button>
          </div>
        </div>,
        document.body
      )
    : null;

  if (variant === 'button') {
    return (
      <>
        <div className="inline-flex items-center rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 shadow-2xs border border-neutral-800 dark:border-neutral-200 overflow-hidden text-xs font-semibold shrink-0 whitespace-nowrap">
          <button
            onClick={handleInstallClick}
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 hover:opacity-90 active:opacity-80 transition-opacity cursor-pointer touch-manipulation whitespace-nowrap shrink-0"
            title="Install MMSS Mohali App"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span className="whitespace-nowrap">Install App</span>
          </button>
          <button
            onClick={handleDismiss}
            className="px-2 py-1.5 hover:opacity-90 active:opacity-80 text-white/70 dark:text-neutral-500 hover:text-white dark:hover:text-neutral-900 border-l border-white/20 dark:border-neutral-300 transition-opacity cursor-pointer touch-manipulation shrink-0"
            title="Dismiss install button"
            aria-label="Dismiss install button"
          >
            <X className="w-3.5 h-3.5 shrink-0" />
          </button>
        </div>
        {ModalContent}
      </>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-neutral-200/60 dark:border-neutral-800/80 bg-neutral-50/80 dark:bg-neutral-900/40 text-xs text-neutral-700 dark:text-neutral-300 animate-in fade-in-0 duration-500">
        <Smartphone className="w-3.5 h-3.5 text-neutral-400 dark:text-neutral-500 shrink-0" />
        <div className="min-w-0 flex-1 leading-snug">
          <span className="font-medium text-neutral-800 dark:text-neutral-200">Install the app</span>
          <span className="text-neutral-500 dark:text-neutral-500">
            {' '}
            — faster access, works offline.
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleInstallClick}
            className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white/80 dark:bg-neutral-900/80 text-neutral-800 dark:text-neutral-200 font-medium text-[11px] hover:bg-white dark:hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            Install
          </button>
          <button
            onClick={handleDismiss}
            className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 cursor-pointer"
            aria-label="Dismiss banner"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {ModalContent}
    </>
  );
};
