import React, { useEffect, useState } from 'react';
import { Download, Smartphone, X, Share, Monitor, Globe, ChevronRight, Sparkles, CheckCircle2, ArrowRight } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_STORAGE_KEY = 'pwa_prompt_banner_dismissed_v3';

export const PWAInstallPrompt: React.FC<{ variant?: 'banner' | 'button' }> = ({ variant = 'banner' }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    // Check if user previously dismissed banner
    if (localStorage.getItem(DISMISS_STORAGE_KEY) === 'true') {
      setBannerDismissed(true);
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

  const handleDismissBanner = (e: React.MouseEvent) => {
    e.stopPropagation();
    setBannerDismissed(true);
    localStorage.setItem(DISMISS_STORAGE_KEY, 'true');
  };

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          setIsInstalled(true);
        }
        setDeferredPrompt(null);
      } catch {
        setShowHelpModal(true);
      }
    } else {
      setShowHelpModal(true);
    }
  };

  if (isInstalled) return null;
  if (variant === 'banner' && bannerDismissed) return null;

  const ModalContent = (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#141417] text-neutral-900 dark:text-white border border-neutral-200 dark:border-neutral-800 rounded-3xl p-6 max-w-lg w-full space-y-5 shadow-2xl relative">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold shrink-0">
              <Download className="w-5 h-5 text-indigo-500" />
            </div>
            <div>
              <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                <span>How to Install Homework App</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">PWA</span>
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">Clear step-by-step instructions for your device</p>
            </div>
          </div>
          <button
            onClick={() => setShowHelpModal(false)}
            className="p-2 rounded-full text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isIOS ? (
          <div className="space-y-4 text-xs text-neutral-600 dark:text-neutral-300">
            <p className="font-semibold text-neutral-900 dark:text-neutral-100">To install on iPhone or iPad:</p>
            <ol className="space-y-3 list-decimal list-inside pl-1 text-neutral-600 dark:text-neutral-400">
              <li className="flex items-center gap-2">
                <span>Tap the</span>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 font-semibold border border-neutral-200 dark:border-neutral-700">
                  <Share className="w-3.5 h-3.5" /> Share
                </span>
                <span>button in Safari</span>
              </li>
              <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
              <li>Tap <strong>Add</strong> in the top right corner</li>
            </ol>
          </div>
        ) : (
          <div className="space-y-4 text-xs">
            {/* Desktop Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 font-bold text-neutral-900 dark:text-neutral-100 text-xs">
                <Monitor className="w-4.5 h-4.5 text-indigo-500 shrink-0" />
                <span>Desktop (Chrome / Edge / Helium Browser)</span>
              </div>

              {/* Method 1: Address Bar */}
              <div className="p-3.5 rounded-2xl bg-neutral-50 dark:bg-[#18181c] border border-neutral-200/80 dark:border-neutral-800 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-neutral-900 dark:text-neutral-100">
                  <span className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Method 1: Address Bar (Fastest)</span>
                  </span>
                </div>
                <p className="text-[11.5px] text-neutral-600 dark:text-neutral-400 leading-relaxed pl-5">
                  Look at the top right of your URL bar (<code className="px-1.5 py-0.5 rounded bg-neutral-200/60 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 font-mono text-[10.5px]">https://...</code>). Click the <strong>Install Icon</strong> <span className="inline-block font-mono bg-neutral-200/70 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-900 dark:text-neutral-100">⊕</span> or <span className="inline-block font-mono bg-neutral-200/70 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-900 dark:text-neutral-100">🖥️↓</span>.
                </p>
              </div>

              {/* Method 2: Browser Menu (Exact Screenshot Steps) */}
              <div className="p-4 rounded-2xl bg-neutral-50 dark:bg-[#18181c] border border-neutral-200/80 dark:border-neutral-800 space-y-2.5">
                <div className="flex items-center justify-between text-xs font-bold text-neutral-900 dark:text-neutral-100">
                  <span className="flex items-center gap-1.5 text-neutral-800 dark:text-neutral-200">
                    <span className="w-5 h-5 rounded-full bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 flex items-center justify-center text-[11px] font-bold">2</span>
                    <span>Method 2: Browser Menu (⋮)</span>
                  </span>
                </div>

                <div className="space-y-2 pt-1">
                  <div className="flex items-start gap-2.5 text-[11.5px] text-neutral-700 dark:text-neutral-300">
                    <span className="font-bold text-neutral-900 dark:text-neutral-100 shrink-0">Step 1:</span>
                    <span>Click the <strong>Three Dots (⋮)</strong> menu in the top-right corner of your browser.</span>
                  </div>

                  <div className="flex items-start gap-2.5 text-[11.5px] text-neutral-700 dark:text-neutral-300">
                    <span className="font-bold text-neutral-900 dark:text-neutral-100 shrink-0">Step 2:</span>
                    <div className="flex-1">
                      <span>Hover over / click </span>
                      <span className="inline-flex items-center gap-1 font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                        Cast, Save, and Share
                        <ChevronRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5 text-[11.5px] text-neutral-700 dark:text-neutral-300">
                    <span className="font-bold text-neutral-900 dark:text-neutral-100 shrink-0">Step 3:</span>
                    <div className="flex-1">
                      <span>Click </span>
                      <span className="inline-flex items-center gap-1 font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                        <Download className="w-3 h-3" />
                        Install Homework Fetcher...
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Mobile Android Note */}
            <div className="p-3 rounded-xl bg-neutral-100/60 dark:bg-neutral-900/60 border border-neutral-200/60 dark:border-neutral-800 flex items-center justify-between text-[11px] text-neutral-600 dark:text-neutral-400">
              <span className="flex items-center gap-1.5 font-medium">
                <Globe className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span>On Android: Tap <strong>⋮</strong> menu → <strong>Add to Home screen</strong></span>
              </span>
            </div>
          </div>
        )}

        <button
          onClick={() => setShowHelpModal(false)}
          className="w-full py-3 rounded-2xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 font-bold text-xs hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors shadow-sm cursor-pointer"
        >
          Got it
        </button>
      </div>
    </div>
  );

  // Header Button Variant (ALWAYS visible in site & mobile headers)
  if (variant === 'button') {
    return (
      <>
        <button
          onClick={handleInstallClick}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 text-xs font-bold shadow-2xs transition-transform active:scale-95 cursor-pointer"
          title="Install app to your desktop or mobile home screen"
        >
          <Download className="w-3.5 h-3.5 text-indigo-400 dark:text-indigo-600" />
          <span>Install App</span>
        </button>

        {showHelpModal && ModalContent}
      </>
    );
  }

  // Banner Variant
  return (
    <>
      <div className="relative group bg-neutral-100/90 dark:bg-neutral-900/90 backdrop-blur-md border border-neutral-200/80 dark:border-neutral-800/80 rounded-2xl p-4 shadow-xs text-neutral-900 dark:text-neutral-100 transition-all">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-neutral-200 dark:bg-neutral-800 border border-neutral-300/60 dark:border-neutral-700/60 flex items-center justify-center text-neutral-800 dark:text-neutral-200 shrink-0">
              <Smartphone className="w-5 h-5 text-indigo-500" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
                <span>Install Homework App</span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">PWA</span>
              </h4>
              <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">
                Install directly to your desktop or phone home screen for instant access.
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
              onClick={handleDismissBanner}
              className="p-1.5 rounded-xl text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors cursor-pointer"
              title="Close install banner"
              aria-label="Close install banner"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {showHelpModal && ModalContent}
    </>
  );
};
