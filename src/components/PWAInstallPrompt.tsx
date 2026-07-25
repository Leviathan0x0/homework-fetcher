import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Smartphone, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const BANNER_DISMISS_KEY = 'pwa_prompt_banner_dismissed_v4';
const INSTALLED_KEY = 'pwa_app_installed_v4';

export const PWAInstallPrompt: React.FC<{ variant?: 'banner' | 'button' }> = ({ variant = 'banner' }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    // Check if installed from localStorage
    if (localStorage.getItem(INSTALLED_KEY) === 'true') {
      setIsInstalled(true);
      return;
    }

    // Check if banner dismissed
    if (localStorage.getItem(BANNER_DISMISS_KEY) === 'true') {
      setBannerDismissed(true);
    }

    // Check if running in standalone PWA window
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true ||
      document.referrer.includes('android-app://');

    if (isStandalone) {
      setIsInstalled(true);
      localStorage.setItem(INSTALLED_KEY, 'true');
      return;
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      localStorage.setItem(INSTALLED_KEY, 'true');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleDismissBanner = (e: React.MouseEvent) => {
    e.stopPropagation();
    setBannerDismissed(true);
    localStorage.setItem(BANNER_DISMISS_KEY, 'true');
  };

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          setIsInstalled(true);
          localStorage.setItem(INSTALLED_KEY, 'true');
        }
        setDeferredPrompt(null);
      } catch {
        setShowHelpModal(true);
      }
    } else {
      setShowHelpModal(true);
    }
  };

  // If app is installed, don't show prompt promotion anywhere
  if (isInstalled) return null;
  if (variant === 'banner' && bannerDismissed) return null;

  const ModalContent = showHelpModal
    ? createPortal(
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#141417] text-neutral-900 dark:text-neutral-100 border border-neutral-200/80 dark:border-neutral-800 rounded-2xl p-6 max-w-md w-full space-y-5 shadow-xl relative animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                  Install Homework App
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                  Follow the instructions below for your device
                </p>
              </div>
              <button
                onClick={() => setShowHelpModal(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Body: All 3 Options Bright and Clear */}
            <div className="space-y-4 text-xs text-neutral-700 dark:text-neutral-300">
              {/* Option 1 */}
              <div className="space-y-1">
                <div className="font-semibold text-neutral-900 dark:text-neutral-100">Option 1: Address Bar</div>
                <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed">
                  Click the <strong>Install</strong> icon in the right corner of your browser's address bar.
                </p>
              </div>

              {/* Option 2 */}
              <div className="space-y-1.5 pt-2.5 border-t border-neutral-100 dark:border-neutral-800">
                <div className="font-semibold text-neutral-900 dark:text-neutral-100">Option 2: Desktop Menu</div>
                <ol className="list-decimal list-inside space-y-1 text-neutral-600 dark:text-neutral-400">
                  <li>Click the <strong>3-dots menu (⋮)</strong> in the top right.</li>
                  <li>Select <strong>Cast, Save, and Share</strong>.</li>
                  <li>Click <strong>Install Homework Fetcher...</strong>.</li>
                </ol>
              </div>

              {/* Option 3: Mobile (Android & iOS) */}
              <div className="space-y-1.5 pt-2.5 border-t border-neutral-100 dark:border-neutral-800">
                <div className="font-semibold text-neutral-900 dark:text-neutral-100">Option 3: Mobile (Android & iOS)</div>
                <ul className="space-y-1.5 text-neutral-600 dark:text-neutral-400">
                  <li>
                    <strong>Android:</strong> Tap <strong>3-dots menu (⋮)</strong> → select <strong>Add to Home screen</strong> or <strong>Install app</strong>.
                  </li>
                  <li>
                    <strong>iOS (iPhone/iPad):</strong> Tap the <strong>Share</strong> button in Safari → select <strong>Add to Home Screen</strong> → tap <strong>Add</strong>.
                  </li>
                </ul>
              </div>
            </div>

            {/* Action Button */}
            <button
              onClick={() => setShowHelpModal(false)}
              className="w-full py-2.5 rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 font-medium text-xs hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors cursor-pointer"
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
        <button
          onClick={handleInstallClick}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 text-xs font-medium shadow-2xs transition-colors cursor-pointer"
          title="Install app"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Install App</span>
        </button>
        {ModalContent}
      </>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs text-neutral-900 dark:text-neutral-100">
        <div className="flex items-center gap-3">
          <Smartphone className="w-4 h-4 text-neutral-500 shrink-0" />
          <div>
            <span className="font-semibold block">Install Homework App</span>
            <span className="text-neutral-500 dark:text-neutral-400">Install to your home screen or desktop.</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleInstallClick}
            className="px-3 py-1.5 rounded-lg bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 font-medium text-xs hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors cursor-pointer"
          >
            Install
          </button>
          <button
            onClick={handleDismissBanner}
            className="p-1.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer"
            aria-label="Dismiss banner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      {ModalContent}
    </>
  );
};
