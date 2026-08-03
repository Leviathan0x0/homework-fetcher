import React, { useEffect, useState } from 'react';
import { ThemeMode, SessionStatus } from '../types/homework';
import { UserAccount } from '../hooks/useHomework';
import { authService } from '../services/api';
import { X, User, LogOut, CheckCircle2, AlertTriangle, ShieldCheck, Download, Smartphone, Moon, Sun, Monitor, KeyRound } from 'lucide-react';
import { cn } from '../utils/cn';
import { ForgotPasswordDialog } from './ForgotPasswordDialog';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface SettingsPanelProps {
  user: UserAccount | null;
  onLogout: () => void;
  onUserChange?: (user: UserAccount) => void;
  sessionStatus: SessionStatus;
  /** True when the school portal ended its session but the app login is fine. */
  schoolSessionExpired?: boolean;
  onReconnect?: () => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  /** Renders the closing action. Omitted when settings are a page of their own. */
  onDone?: () => void;
  className?: string;
}

interface SettingsModalProps extends Omit<SettingsPanelProps, 'onDone' | 'className'> {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * The settings form itself, shared by the desktop modal and the mobile page so
 * both surfaces stay in sync.
 */
export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  user,
  onLogout,
  onUserChange,
  sessionStatus,
  schoolSessionExpired,
  onReconnect,
  theme,
  onThemeChange,
  onDone,
  className,
}) => {
  const [nameDraft, setNameDraft] = useState(user?.displayName || '');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  // PWA Install state inside settings
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [installTab, setInstallTab] = useState<'computer' | 'android' | 'ios'>('computer');
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [showPasswordHelp, setShowPasswordHelp] = useState(false);

  useEffect(() => {
    setNameDraft(user?.displayName || '');
    setNameError(null);
    setNameSaved(false);
  }, [user?.displayName]);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    if (isStandalone) {
      setIsInstalled(true);
      return;
    }

    const ua = window.navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream) {
      setInstallTab('ios');
    } else if (/Android/i.test(ua)) {
      setInstallTab('android');
    } else {
      setInstallTab('computer');
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as Event as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallClick = () => {
    setShowInstallModal(true);
  };

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
    onDone?.();
  };

  return (
    <div className={cn('p-5 sm:p-6 space-y-6', className)}>
      {/* Section 1: User Account & Session Status */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            School account
          </h3>
          <div className="flex items-center gap-1.5 text-xs">
            {schoolSessionExpired ? (
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                <AlertTriangle className="w-3.5 h-3.5 animate-wiggle-subtle" /> School portal disconnected
              </span>
            ) : sessionStatus === 'connected' ? (
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

        <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200/80 dark:border-neutral-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center text-neutral-700 dark:text-neutral-300 font-semibold text-xs">
                <User className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs text-neutral-400 dark:text-neutral-500 font-medium">Student ID</div>
                <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
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

          {schoolSessionExpired && onReconnect && (
            <div className="pt-3 border-t border-neutral-200/80 dark:border-neutral-800 space-y-2.5">
              <p className="text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-400">
                The school portal ended its own session, so new homework has stopped arriving. You
                are still signed in here — reconnect with your school password to start it again.
              </p>
              <button
                type="button"
                onClick={() => {
                  onDone?.();
                  onReconnect();
                }}
                className="group/reconnect inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition-colors duration-150 cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
              >
                <KeyRound className="w-3.5 h-3.5 transition-transform duration-200 group-hover/reconnect:rotate-12" />
                <span>Reconnect to school portal</span>
              </button>
            </div>
          )}

          <div className="pt-3 border-t border-neutral-200/80 dark:border-neutral-800">
            <button
              type="button"
              onClick={() => setShowPasswordHelp(true)}
              className="group/password inline-flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-neutral-100/80 dark:hover:bg-neutral-800/60 cursor-pointer"
            >
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300">
                <KeyRound className="h-3.5 w-3.5 text-neutral-500 transition-transform duration-200 group-hover/password:rotate-12" />
                Forgot or change password
              </span>
              <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                Via school office
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Section 2: Display name shown to other students */}
      <div className="space-y-3 pt-4 border-t border-neutral-100 dark:border-neutral-800/80">
        <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
          Your name in messages
        </h3>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Classmates see this name instead of your student ID when they search for you or chat with you.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder="e.g. Aarav Sharma"
            maxLength={40}
            className="flex-1 text-sm h-9 px-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
          <button
            type="button"
            onClick={handleSaveName}
            disabled={savingName || !nameDraft.trim() || nameDraft.trim() === (user?.displayName || '')}
            className="px-3 h-9 rounded-lg bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 text-xs font-semibold disabled:opacity-40 cursor-pointer active:scale-95 transition-transform"
          >
            {savingName ? 'Saving…' : 'Save'}
          </button>
        </div>
        {nameError && <p className="text-xs text-rose-600 dark:text-rose-400">{nameError}</p>}
        {nameSaved && !nameError && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">Saved. Classmates now see this name.</p>
        )}
      </div>

      {/* Section 3: PWA Installation App Option */}
      <div className="space-y-3 pt-4 border-t border-neutral-100 dark:border-neutral-800/80">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center text-neutral-700 dark:text-neutral-300 font-semibold text-xs">
              <Smartphone className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
                <span>Install Application</span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-neutral-200 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-300/60 dark:border-neutral-700/60">PWA</span>
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                {isInstalled
                  ? 'App is installed on your device.'
                  : 'Add directly to your home screen for quick access.'}
              </div>
            </div>
          </div>

          {!isInstalled && (
            <button
              type="button"
              onClick={handleInstallClick}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 text-xs font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-200 cursor-pointer active:scale-95 transition-transform"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Install</span>
            </button>
          )}
        </div>
      </div>

      {/* Section 4: Appearance Theme */}
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

      {/* Section 5: App Identity & Security Info */}
      <div className="pt-4 border-t border-neutral-100 dark:border-neutral-800/80 flex items-center justify-between text-xs text-neutral-400">
        <span className="flex items-center gap-1.5 group/sec">
          <ShieldCheck className="w-4 h-4 text-emerald-500 transition-transform duration-200 group-hover/sec:rotate-12" />
          <span>Secure HTTP-only session</span>
        </span>
        <span className="text-[11px] font-medium">mmss64 · v1.1.0</span>
      </div>

      {/* Footer Actions */}
      {onDone && (
        <div className="flex items-center justify-end pt-4 border-t border-neutral-100 dark:border-neutral-800/80">
          <button
            type="button"
            onClick={onDone}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors duration-150 cursor-pointer touch-manipulation active:scale-95"
          >
            Done
          </button>
        </div>
      )}

      {/* Comprehensive Multi-Device Installation Guide Modal */}
      {showInstallModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#141418] text-neutral-900 dark:text-white border border-neutral-200 dark:border-neutral-800 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-neutral-200/80 dark:border-neutral-800/80 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">Install MMSS Mohali App</h3>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400">Select your device for instructions</p>
                </div>
              </div>
              <button
                onClick={() => setShowInstallModal(false)}
                className="p-1 rounded-full text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Device Choice Tabs */}
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-2xl">
              <button
                type="button"
                onClick={() => setInstallTab('computer')}
                className={cn(
                  'flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer',
                  installTab === 'computer'
                    ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-2xs'
                    : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
                )}
              >
                <Monitor className="w-3.5 h-3.5" />
                <span>Computer</span>
              </button>

              <button
                type="button"
                onClick={() => setInstallTab('android')}
                className={cn(
                  'flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer',
                  installTab === 'android'
                    ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-2xs'
                    : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
                )}
              >
                <Smartphone className="w-3.5 h-3.5 text-emerald-500" />
                <span>Android</span>
              </button>

              <button
                type="button"
                onClick={() => setInstallTab('ios')}
                className={cn(
                  'flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer',
                  installTab === 'ios'
                    ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-2xs'
                    : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
                )}
              >
                <Smartphone className="w-3.5 h-3.5 text-sky-500" />
                <span>iOS</span>
              </button>
            </div>

            {/* Tab Instructions Content */}
            <div className="space-y-3 py-1 min-h-[140px]">
              {installTab === 'computer' && (
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                    Desktop Chrome, Edge, Brave, or Safari:
                  </div>
                  <ol className="text-xs text-neutral-600 dark:text-neutral-300 space-y-2 list-decimal list-inside pl-1 leading-relaxed">
                    <li>Look for the <strong>Install icon (⬇️ or ⊕)</strong> in your browser search bar</li>
                    <li>Or click the <strong>3 dots menu (⋮)</strong> in the top right corner</li>
                    <li>Hover or click <strong>"Cast, save and share"</strong></li>
                    <li>Click <strong>"Install MMSS Mohali..."</strong> (or <strong>"Create shortcut..."</strong>)</li>
                    <li>Click <strong>Install</strong> to add the app directly to your desktop</li>
                  </ol>
                </div>
              )}

              {installTab === 'android' && (
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                    Android Chrome or Samsung Internet:
                  </div>
                  <ol className="text-xs text-neutral-600 dark:text-neutral-300 space-y-2 list-decimal list-inside pl-1 leading-relaxed">
                    <li>Open Chrome or Samsung Internet on your Android phone</li>
                    <li>Tap the <strong>Menu icon (⋮)</strong> in the top right corner</li>
                    <li>Tap <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong></li>
                    <li>Tap <strong>Add</strong> to confirm — the app icon will appear on your home screen</li>
                  </ol>
                </div>
              )}

              {installTab === 'ios' && (
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                    iPhone or iPad (Safari):
                  </div>
                  <ol className="text-xs text-neutral-600 dark:text-neutral-300 space-y-2 list-decimal list-inside pl-1 leading-relaxed">
                    <li>Click the <strong>Share icon</strong> in the search bar / navigation bar (the box with an upward arrow ⎋)</li>
                    <li>Click <strong>View More</strong> (or scroll down the share menu)</li>
                    <li>Click <strong>Add to Home Screen</strong> (➕)</li>
                    <li>Tap <strong>Add</strong> in the top right corner</li>
                  </ol>
                </div>
              )}
            </div>

            {/* Action Footer */}
            <div className="pt-2 space-y-2 border-t border-neutral-200/80 dark:border-neutral-800/80">
              {deferredPrompt && (
                <button
                  type="button"
                  onClick={async () => {
                    deferredPrompt.prompt();
                    const { outcome } = await deferredPrompt.userChoice;
                    if (outcome === 'accepted') setIsInstalled(true);
                    setDeferredPrompt(null);
                    setShowInstallModal(false);
                  }}
                  className="w-full py-2.5 rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 font-bold text-xs hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                >
                  <Download className="w-4 h-4" />
                  <span>Install Instantly (1-Click)</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowInstallModal(false)}
                className="w-full py-2.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 font-semibold text-xs hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors cursor-pointer active:scale-95"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <ForgotPasswordDialog
        isOpen={showPasswordHelp}
        onClose={() => setShowPasswordHelp(false)}
        variant="change"
      />
    </div>
  );
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  user,
  onLogout,
  onUserChange,
  sessionStatus,
  schoolSessionExpired,
  onReconnect,
  theme,
  onThemeChange,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 pt-[env(safe-area-inset-top)] bg-black/40 dark:bg-black/70 backdrop-blur-xs animate-in fade-in duration-200"
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

        <SettingsPanel
          user={user}
          onLogout={onLogout}
          onUserChange={onUserChange}
          sessionStatus={sessionStatus}
          schoolSessionExpired={schoolSessionExpired}
          onReconnect={onReconnect}
          theme={theme}
          onThemeChange={onThemeChange}
          onDone={onClose}
          className="overflow-y-auto flex-1 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        />
      </div>
    </div>
  );
};
