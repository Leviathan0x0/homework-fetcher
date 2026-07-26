import React, { useEffect, useState } from 'react';
import { ThemeMode, SessionStatus } from '../types/homework';
import { UserAccount } from '../hooks/useHomework';
import { authService } from '../services/api';
import { X, User, LogOut, CheckCircle2, AlertTriangle, ShieldCheck, Download, Smartphone, Moon, Sun, Monitor } from 'lucide-react';
import { cn } from '../utils/cn';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserAccount | null;
  onLogout: () => void;
  onUserChange?: (user: UserAccount) => void;
  sessionStatus: SessionStatus;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  user,
  onLogout,
  onUserChange,
  sessionStatus,
  theme,
  onThemeChange,
}) => {
  const [nameDraft, setNameDraft] = useState(user?.displayName || '');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  // PWA Install state inside settings
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSModal, setShowIOSModal] = useState(false);

  useEffect(() => {
    setNameDraft(user?.displayName || '');
    setNameError(null);
    setNameSaved(false);
  }, [user?.displayName, isOpen]);

  useEffect(() => {
    // Detect standalone mode
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    if (isStandalone) {
      setIsInstalled(true);
      return;
    }

    const ua = window.navigator.userAgent;
    setIsIOS(/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as Event as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
    } else if (isIOS) {
      setShowIOSModal(true);
    } else {
      alert('To install, open your browser menu (⋮ or ⋯) and tap "Install App" or "Add to Home Screen".');
    }
  };

  if (!isOpen) return null;

  const handleSaveName = async () => {
    setSavingName(true);
    setNameError(null);
    setNameSaved(false);
    try {
      const updated = await authService.updateDisplayName(nameDraft);
      onUserChange?.(updated);
      setNameSaved(true);
    } catch (err: any) {
      setNameError(typeof err?.message === 'string' ? err.message : 'Could not save your name.');
    } finally {
      setSavingName(false);
    }
  };

  const handleSignOut = () => {
    onLogout();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 dark:bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white dark:bg-[#121215] text-neutral-900 dark:text-neutral-100 border border-neutral-200 dark:border-neutral-800 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200/80 dark:border-neutral-800/80 shrink-0 bg-neutral-50/80 dark:bg-[#141418]/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-neutral-200 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 flex items-center justify-center font-bold text-xs">
              <User className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
              Profile & Settings
            </h2>
          </div>
          <button
            onClick={onClose}
            className="group/close p-2 rounded-xl text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors duration-150 cursor-pointer active:scale-90"
            title="Close"
          >
            <X className="w-5 h-5 sm:w-4 sm:h-4 transition-transform duration-200 group-hover/close:rotate-90" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1 pb-safe">
          {/* Profile Card */}
          <div className="p-5 rounded-2xl bg-neutral-100/80 dark:bg-neutral-900/80 border border-neutral-200/80 dark:border-neutral-800/80 text-neutral-900 dark:text-neutral-100 shadow-2xs">
            <div className="flex items-center gap-4">
              <div className="w-13 h-13 rounded-2xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 flex items-center justify-center font-bold text-lg shadow-2xs shrink-0">
                {(user?.displayName || user?.studentId || 'S').charAt(0).toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-bold truncate text-neutral-900 dark:text-neutral-100">
                    {user?.displayName || 'Student User'}
                  </h3>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-neutral-200 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-300/60 dark:border-neutral-700/60">
                    {user?.section || 'Section Student'}
                  </span>
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 font-mono mt-0.5">
                  ID: {user?.studentId || 'Authenticated'}
                </p>
              </div>

              <div className="shrink-0">
                {sessionStatus === 'connected' ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                    <AlertTriangle className="w-3.5 h-3.5" /> Expired
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Section: Display Name Editor */}
          <div className="p-4.5 rounded-2xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200/80 dark:border-neutral-800/80 space-y-3">
            <div>
              <h3 className="text-xs font-bold text-neutral-900 dark:text-neutral-100 uppercase tracking-wider">
                Display Name in Messages
              </h3>
              <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">
                Classmates see this display name when chatting with you in direct messages.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Enter your name (e.g. Aarav Sharma)"
                maxLength={40}
                className="flex-1 text-sm h-10 px-3.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400/40 dark:focus:ring-neutral-600/40"
              />
              <button
                type="button"
                onClick={handleSaveName}
                disabled={savingName || !nameDraft.trim() || nameDraft.trim() === (user?.displayName || '')}
                className="px-4 h-10 rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 text-xs font-bold disabled:opacity-40 cursor-pointer active:scale-95 transition-all shadow-2xs hover:bg-neutral-800 dark:hover:bg-neutral-200"
              >
                {savingName ? 'Saving…' : 'Save'}
              </button>
            </div>
            {nameError && <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">{nameError}</p>}
            {nameSaved && !nameError && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">✓ Display name updated successfully.</p>
            )}
          </div>

          {/* Section: PWA Install App Option */}
          <div className="p-4.5 rounded-2xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200/80 dark:border-neutral-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-neutral-200 dark:bg-neutral-800 border border-neutral-300/60 dark:border-neutral-700/60 flex items-center justify-center text-neutral-800 dark:text-neutral-200 shrink-0">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
                    <span>Install Application</span>
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-neutral-200 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-300/60 dark:border-neutral-700/60">PWA</span>
                  </h4>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">
                    {isInstalled
                      ? 'App installed on your device.'
                      : 'Add directly to your home screen or search bar for quick access.'}
                  </p>
                </div>
              </div>

              {!isInstalled && (
                <button
                  type="button"
                  onClick={handleInstallClick}
                  className="px-3.5 py-2 rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 text-xs font-bold cursor-pointer transition-all shadow-2xs active:scale-95 flex items-center gap-1.5 shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Install</span>
                </button>
              )}
            </div>
          </div>

          {/* Section: Appearance & Theme */}
          <div className="p-4.5 rounded-2xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200/80 dark:border-neutral-800/80 space-y-3">
            <h3 className="text-xs font-bold text-neutral-900 dark:text-neutral-100 uppercase tracking-wider">
              Appearance Theme
            </h3>
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { mode: 'light' as ThemeMode, label: 'Light', icon: Sun },
                { mode: 'dark' as ThemeMode, label: 'Obsidian', icon: Moon },
                { mode: 'system' as ThemeMode, label: 'System', icon: Monitor },
              ].map(({ mode, label, icon: Icon }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onThemeChange(mode)}
                  className={cn(
                    'flex flex-col items-center justify-center gap-1.5 py-3 px-3 rounded-xl border text-xs font-semibold transition-all duration-150 cursor-pointer active:scale-95',
                    theme === mode
                      ? 'border-neutral-900 dark:border-white bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-2xs font-bold'
                      : 'border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 hover:border-neutral-300 dark:hover:border-neutral-700 bg-white dark:bg-neutral-900'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Section: Security Info & Sign Out */}
          <div className="p-4.5 rounded-2xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200/80 dark:border-neutral-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400 font-medium">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Encrypted Session Active</span>
            </div>

            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition-all cursor-pointer active:scale-95"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-neutral-200/80 dark:border-neutral-800/80 bg-neutral-50/80 dark:bg-[#141418]/80 flex items-center justify-between shrink-0">
          <span className="text-xs font-mono text-neutral-500 dark:text-neutral-400">Homework PWA v1.2.0</span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all cursor-pointer active:scale-95 shadow-2xs"
          >
            Done
          </button>
        </div>
      </div>

      {/* iOS Safari Installation Guide Modal */}
      {showIOSModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white border border-neutral-200 dark:border-neutral-800 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">Install on iPhone / iPad</h3>
              <button onClick={() => setShowIOSModal(false)} className="text-neutral-400 hover:text-neutral-900 dark:hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-neutral-600 dark:text-neutral-300">
              To install this app on your iOS home screen:
            </p>
            <ol className="text-xs text-neutral-600 dark:text-neutral-400 space-y-2.5 list-decimal list-inside pl-1">
              <li>Tap the <strong>Share</strong> icon in Safari toolbar</li>
              <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
              <li>Tap <strong>Add</strong> in the top right corner</li>
            </ol>
            <button
              onClick={() => setShowIOSModal(false)}
              className="w-full py-2.5 rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 font-bold text-xs hover:bg-neutral-800 dark:hover:bg-neutral-200"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
