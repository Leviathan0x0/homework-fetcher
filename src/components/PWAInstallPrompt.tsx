import React, { useEffect, useState } from 'react';
import { Download, Smartphone, X, Share, Monitor, Globe, ChevronRight, Sparkles } from 'lucide-react';

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

        {/* Multi-platform Installation Helper Modal */}
        {showHelpModal && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-[#141417] text-neutral-900 dark:text-white border border-neutral-200 dark:border-neutral-800 rounded-3xl p-6 max-w-md w-full space-y-5 shadow-2xl relative">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">Install Homework App</h3>
                    <p className="text-[11px] text-neutral-400 font-medium">Quick Browser Installation Guide</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowHelpModal(false)}
                  className="p-1.5 rounded-full text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {isIOS ? (
                <div className="space-y-3 text-xs text-neutral-600 dark:text-neutral-300">
                  <p className="font-semibold text-neutral-900 dark:text-neutral-100">To install on iPhone or iPad:</p>
                  <ol className="space-y-2.5 list-decimal list-inside pl-1 text-neutral-600 dark:text-neutral-400">
                    <li className="flex items-center gap-2">
                      <span>Tap the</span>
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 font-semibold border border-neutral-200 dark:border-neutral-700">
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
                  <div className="p-4 rounded-2xl bg-neutral-50 dark:bg-[#1c1c20] border border-neutral-200/80 dark:border-neutral-800 space-y-3">
                    <div className="flex items-center gap-2 font-bold text-neutral-900 dark:text-neutral-100 text-xs">
                      <Monitor className="w-4 h-4 text-indigo-500" />
                      <span>Desktop Chrome / Helium Browser Installation</span>
                    </div>

                    <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed text-[11.5px]">
                      Follow this 2-step menu path in your browser:
                    </p>

                    {/* Exact Screenshot Path Visual Card */}
                    <div className="rounded-xl bg-white dark:bg-[#121215] border border-neutral-200 dark:border-neutral-800 p-3 space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
                        <span className="flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-md bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center font-bold text-neutral-900 dark:text-neutral-100">1</span>
                          Click Browser Menu (<strong>⋮</strong>)
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-800 dark:text-neutral-200 bg-neutral-100/80 dark:bg-neutral-900/80 p-2 rounded-lg border border-neutral-200/60 dark:border-neutral-800">
                        <span className="text-neutral-500">2. Select</span>
                        <span className="text-indigo-600 dark:text-indigo-400">Cast, Save, and Share</span>
                        <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">Install Homework Fetcher...</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-neutral-50 dark:bg-[#1c1c20] border border-neutral-200/80 dark:border-neutral-800 space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-neutral-900 dark:text-neutral-100">
                      <Globe className="w-4 h-4 text-emerald-500" />
                      <span>Android Phone</span>
                    </div>
                    <p className="text-[11px] text-neutral-600 dark:text-neutral-400">
                      Tap Chrome menu (<strong>⋮</strong>) → Select <strong>Add to Home screen</strong> or <strong>Install app</strong>.
                    </p>
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
        )}
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

      {/* Multi-platform Installation Helper Modal */}
      {showHelpModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#141417] text-neutral-900 dark:text-white border border-neutral-200 dark:border-neutral-800 rounded-3xl p-6 max-w-md w-full space-y-5 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">Install Homework App</h3>
                  <p className="text-[11px] text-neutral-400 font-medium">Quick Browser Installation Guide</p>
                </div>
              </div>
              <button
                onClick={() => setShowHelpModal(false)}
                className="p-1.5 rounded-full text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isIOS ? (
              <div className="space-y-3 text-xs text-neutral-600 dark:text-neutral-300">
                <p className="font-semibold text-neutral-900 dark:text-neutral-100">To install on iPhone or iPad:</p>
                <ol className="space-y-2.5 list-decimal list-inside pl-1 text-neutral-600 dark:text-neutral-400">
                  <li className="flex items-center gap-2">
                    <span>Tap the</span>
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 font-semibold border border-neutral-200 dark:border-neutral-700">
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
                <div className="p-4 rounded-2xl bg-neutral-50 dark:bg-[#1c1c20] border border-neutral-200/80 dark:border-neutral-800 space-y-3">
                  <div className="flex items-center gap-2 font-bold text-neutral-900 dark:text-neutral-100 text-xs">
                    <Monitor className="w-4 h-4 text-indigo-500" />
                    <span>Desktop Chrome / Helium Browser Installation</span>
                  </div>

                  <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed text-[11.5px]">
                    Follow this 2-step menu path in your browser:
                  </p>

                  <div className="rounded-xl bg-white dark:bg-[#121215] border border-neutral-200 dark:border-neutral-800 p-3 space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
                      <span className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-md bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center font-bold text-neutral-900 dark:text-neutral-100">1</span>
                        Click Browser Menu (<strong>⋮</strong>)
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-800 dark:text-neutral-200 bg-neutral-100/80 dark:bg-neutral-900/80 p-2 rounded-lg border border-neutral-200/60 dark:border-neutral-800">
                      <span className="text-neutral-500">2. Select</span>
                      <span className="text-indigo-600 dark:text-indigo-400">Cast, Save, and Share</span>
                      <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold">Install Homework Fetcher...</span>
                    </div>
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-neutral-50 dark:bg-[#1c1c20] border border-neutral-200/80 dark:border-neutral-800 space-y-1.5">
                  <div className="flex items-center gap-2 font-bold text-neutral-900 dark:text-neutral-100">
                    <Globe className="w-4 h-4 text-emerald-500" />
                    <span>Android Phone</span>
                  </div>
                  <p className="text-[11px] text-neutral-600 dark:text-neutral-400">
                    Tap Chrome menu (<strong>⋮</strong>) → Select <strong>Add to Home screen</strong> or <strong>Install app</strong>.
                  </p>
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
      )}
    </>
  );
};
