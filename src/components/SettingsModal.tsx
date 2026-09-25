import React, { useEffect, useRef, useState } from 'react';
import { ThemeMode, SessionStatus } from '../types/homework';
import { UserAccount } from '../hooks/useHomework';
import { authService } from '../services/api';
import { Reicon } from './ui/reicon';
import { cn } from '../utils/cn';
import { ForgotPasswordDialog } from './ForgotPasswordDialog';
import { ProfileAvatar } from './ProfileAvatar';
import { compressImage, formatBytes } from '../utils/imageCompression';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { AutoRefreshMinutes } from '../utils/appPreferences';
import { AppTheme, ThemeAppearance, themesForMode } from '../themes';

export type SettingsSection = 'profile' | 'account' | 'preferences' | 'appearance' | 'app';

interface SettingsPanelProps {
  user: UserAccount | null;
  onLogout: () => void;
  onUserChange?: (user: UserAccount) => void;
  sessionStatus: SessionStatus;
  schoolSessionExpired?: boolean;
  onReconnect?: () => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  /** Light or dark, after `system` has been resolved. */
  resolvedTheme: ThemeAppearance;
  /** Id of the active palette for `resolvedTheme`. */
  themeId: string;
  onThemeIdChange: (id: string) => void;
  autoRefreshMinutes?: AutoRefreshMinutes;
  onAutoRefreshChange?: (minutes: AutoRefreshMinutes) => void;
  inAppNotifications?: boolean;
  onInAppNotificationsChange?: (enabled: boolean) => void;
  section: SettingsSection;
  className?: string;
}

interface SettingsCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

function SettingsCard({ title, description, icon, children, className }: SettingsCardProps) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-2xs sm:p-6 dark:border-neutral-800/80 dark:bg-[#111114]',
        className
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">{title}</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">{description}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

interface ToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
}

function Toggle({ checked, onCheckedChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40 focus-visible:ring-offset-2 dark:focus-visible:ring-neutral-600/50 dark:focus-visible:ring-offset-[#111114]',
        checked ? 'bg-neutral-900 dark:bg-neutral-100' : 'bg-neutral-200 dark:bg-neutral-700'
      )}
    >
      <span
        className={cn(
          'size-5 rounded-full bg-white shadow-sm transition-transform duration-200 dark:bg-neutral-900',
          checked ? 'translate-x-4' : 'translate-x-0'
        )}
      />
    </button>
  );
}

interface ThemeCardProps {
  theme: AppTheme;
  active: boolean;
  onSelect: (id: string) => void;
}

function ThemeCard({ theme, active, onSelect }: ThemeCardProps) {
  const { background, surface, accent, foreground } = theme.swatch;
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${theme.name} theme`}
      onClick={() => onSelect(theme.id)}
      className={cn(
        'group overflow-hidden rounded-xl border text-left transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40',
        active
          ? 'border-neutral-900 shadow-sm ring-2 ring-neutral-900/15 dark:border-neutral-100 dark:ring-neutral-100/15'
          : 'border-neutral-200 hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-700'
      )}
    >
      <span className="relative block h-16 w-full overflow-hidden" style={{ backgroundColor: background }}>
        <span
          className="absolute left-2.5 top-2.5 h-11 w-16 rounded-lg shadow-sm"
          style={{ backgroundColor: surface }}
        >
          <span
            className="absolute left-2 top-2 h-1.5 w-8 rounded-full"
            style={{ backgroundColor: foreground, opacity: 0.4 }}
          />
          <span
            className="absolute left-2 top-5 h-1.5 w-11 rounded-full"
            style={{ backgroundColor: foreground, opacity: 0.2 }}
          />
          <span
            className="absolute bottom-2 left-2 h-3 w-7 rounded-full"
            style={{ backgroundColor: accent }}
          />
        </span>
        <span
          className="absolute right-2.5 top-2.5 size-6 rounded-full"
          style={{ backgroundColor: accent }}
        />
        <span
          className="absolute bottom-2.5 right-2.5 h-2.5 w-12 rounded-full"
          style={{ backgroundColor: foreground, opacity: 0.3 }}
        />
      </span>
      <span className="flex items-center justify-between gap-1.5 px-2.5 py-2">
        <span className="min-w-0">
          <span className="block truncate text-[11px] font-semibold text-neutral-800 dark:text-neutral-200">
            {theme.name}
          </span>
          <span className="mt-0.5 block truncate text-[10px] text-neutral-400 dark:text-neutral-500">
            {theme.mode === 'light' ? 'Light palette' : 'Dark palette'}
          </span>
        </span>
        <Reicon
          name="circle-check"
          size={15}
          className={cn(
            'shrink-0 transition-opacity',
            active
              ? 'text-emerald-600 opacity-100 dark:text-emerald-400'
              : 'opacity-0'
          )}
        />
      </span>
    </button>
  );
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  user,
  onLogout,
  onUserChange,
  sessionStatus,
  schoolSessionExpired,
  onReconnect,
  theme,
  onThemeChange,
  resolvedTheme,
  themeId,
  onThemeIdChange,
  autoRefreshMinutes = 2,
  onAutoRefreshChange,
  inAppNotifications = true,
  onInAppNotificationsChange,
  section,
  className,
}) => {
  const [nameDraft, setNameDraft] = useState(user?.displayName || '');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);
  const [pictureBusy, setPictureBusy] = useState(false);
  const [pictureError, setPictureError] = useState<string | null>(null);
  const [pictureSaved, setPictureSaved] = useState(false);
  const pictureInputRef = useRef<HTMLInputElement>(null);
  const { canInstall, isInstalled, isChecking, supportsInstallPrompt, install } = usePWAInstall();
  const [isInstalling, setIsInstalling] = useState(false);
  const [showPasswordHelp, setShowPasswordHelp] = useState(false);

  useEffect(() => {
    setNameDraft(user?.displayName || '');
    setNameError(null);
    setNameSaved(false);
  }, [user?.displayName]);

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

  const handlePictureChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPictureBusy(true);
    setPictureError(null);
    setPictureSaved(false);
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type.toLowerCase())) {
        throw new Error('Choose a JPG, PNG, or WebP image.');
      }
      const prepared = await compressImage(file, {
        maxDimension: 512,
        quality: 0.86,
        skipBelowBytes: 0,
      });
      if (prepared.size > 2 * 1024 * 1024) {
        throw new Error(`That image is ${formatBytes(prepared.size)}. Please choose a smaller image.`);
      }
      const profilePictureUrl = await authService.uploadProfilePicture(prepared);
      if (user) onUserChange?.({ ...user, profilePictureUrl });
      setPictureSaved(true);
    } catch (err: any) {
      setPictureError(typeof err?.message === 'string' ? err.message : 'Could not save that profile picture.');
    } finally {
      setPictureBusy(false);
    }
  };

  const handleRemovePicture = async () => {
    setPictureBusy(true);
    setPictureError(null);
    setPictureSaved(false);
    try {
      await authService.deleteProfilePicture();
      if (user) onUserChange?.({ ...user, profilePictureUrl: null });
      setPictureSaved(true);
    } catch (err: any) {
      setPictureError(typeof err?.message === 'string' ? err.message : 'Could not remove your profile picture.');
    } finally {
      setPictureBusy(false);
    }
  };

  const isAdmin = Boolean(user?.isAdmin || user?.role === 'admin');
  const isTeacher = !isAdmin && Boolean(user?.isTeacher || user?.role === 'teacher' || user?.role === 'class_teacher');
  const hasSchoolPortal = !isAdmin && !isTeacher;
  const hasActiveSession = sessionStatus === 'connected' && !schoolSessionExpired;
  const connectionLabel = hasSchoolPortal
    ? schoolSessionExpired
      ? 'School portal disconnected'
      : hasActiveSession
        ? 'School session active'
        : 'School session expired'
    : hasActiveSession
      ? 'Account active'
      : 'Account session unavailable';

  return (
    <div className={cn('mx-auto w-full max-w-3xl', className)}>
      {section === 'profile' && (
      <SettingsCard
        title="Your profile"
        description="Choose how you appear to classmates and how your photo is handled."
        icon={<Reicon name="user" size={17} />}
        className="lg:col-span-2"
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <ProfileAvatar
            src={user?.profilePictureUrl}
            name={user?.displayName || user?.studentId}
            className="size-20 shrink-0 text-lg sm:size-24 sm:text-xl"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div>
                <p className="text-base font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">
                  {user?.displayName || 'Your profile'}
                </p>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  Student ID {user?.studentId || '—'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={pictureInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handlePictureChange}
                />
                <button
                  type="button"
                  disabled={pictureBusy}
                  onClick={() => pictureInputRef.current?.click()}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-neutral-900 px-3 text-xs font-semibold text-white transition hover:bg-neutral-700 disabled:cursor-wait disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                >
                  <Reicon name="upload" size={14} className="size-3.5" />
                  {pictureBusy ? 'Checking…' : user?.profilePictureUrl ? 'Change photo' : 'Add photo'}
                </button>
                {user?.profilePictureUrl && (
                  <button
                    type="button"
                    disabled={pictureBusy}
                    onClick={handleRemovePicture}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-neutral-200 px-3 text-xs font-medium text-neutral-600 transition hover:border-rose-200 hover:text-rose-600 disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:border-rose-900 dark:hover:text-rose-400"
                  >
                    <Reicon name="trash-2" size={14} className="size-3.5" /> Remove
                  </button>
                )}
              </div>
            </div>
            <p className="mt-3 max-w-2xl text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              Use a clear, school-appropriate photo. Uploads are checked for unsafe content before they are saved.
            </p>
            {(pictureError || pictureSaved) && (
              <p
                className={cn(
                  'mt-2 text-xs',
                  pictureError ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
                )}
                aria-live="polite"
              >
                {pictureError || 'Profile photo updated.'}
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 border-t border-neutral-200/80 pt-5 dark:border-neutral-800/80">
          <label htmlFor="settings-display-name" className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
            Name in messages
          </label>
          <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
            Classmates will see this instead of your student ID.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              id="settings-display-name"
              type="text"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              placeholder="e.g. Aarav Sharma"
              maxLength={40}
              className="min-h-10 flex-1 rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 text-sm text-neutral-900 outline-none transition focus:border-neutral-400 focus:bg-white focus:ring-2 focus:ring-neutral-400/15 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-600 dark:focus:bg-neutral-900"
            />
            <button
              type="button"
              onClick={handleSaveName}
              disabled={savingName || !nameDraft.trim() || nameDraft.trim() === (user?.displayName || '')}
              className="min-h-10 rounded-xl border border-neutral-200 bg-white px-4 text-xs font-semibold text-neutral-800 transition hover:border-neutral-300 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
            >
              {savingName ? 'Saving…' : 'Save name'}
            </button>
          </div>
          {(nameError || nameSaved) && (
            <p
              className={cn(
                'mt-2 text-xs',
                nameError ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
              )}
              aria-live="polite"
            >
              {nameError || 'Saved. Classmates now see this name.'}
            </p>
          )}
        </div>
      </SettingsCard>
      )}

      {section === 'account' && (
      <SettingsCard
        title={hasSchoolPortal ? 'School connection' : 'Account access'}
        description={hasSchoolPortal
          ? 'Keep your homework connection healthy and manage your session.'
          : 'Manage access to your MMSS Mohali account.'}
        icon={<Reicon name={hasSchoolPortal ? 'key' : 'shield-check'} size={17} />}
      >
        <div
          className={cn(
            'rounded-xl border p-4',
            hasActiveSession
              ? 'border-emerald-200/80 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/20'
              : 'border-amber-200/80 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/20'
          )}
        >
          <div className="flex items-center gap-2">
            <Reicon
              name={hasActiveSession ? 'circle-check' : 'alert-triangle'}
              size={16}
              className={hasActiveSession ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}
            />
            <p className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">{connectionLabel}</p>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-400">
            {hasSchoolPortal
              ? 'Your school session lets MMSS fetch homework and classwork. Your app sign-in stays active if the school session expires.'
              : 'Your role and account permissions are managed by the MMSS Mohali system.'}
          </p>
        </div>

        {hasSchoolPortal && schoolSessionExpired && onReconnect && (
          <button
            type="button"
            onClick={onReconnect}
            className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-3 text-xs font-semibold text-white transition hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
          >
            <Reicon name="key" size={15} /> Reconnect school portal
          </button>
        )}

        <div className="mt-4 space-y-1">
          <button
            type="button"
            onClick={() => setShowPasswordHelp(true)}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
          >
            <span className="inline-flex items-center gap-2.5 text-xs font-medium text-neutral-700 dark:text-neutral-300">
              <Reicon name="lock" size={15} className="text-neutral-500" /> Forgot or change password
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-neutral-400">
              School office <Reicon name="chevron-right" size={13} />
            </span>
          </button>
          <div className="border-t border-neutral-200/80 pt-3 dark:border-neutral-800/80">
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
            >
              <Reicon name="logout" size={15} /> Sign out
            </button>
          </div>
        </div>
      </SettingsCard>
      )}

      {section === 'preferences' && (
      <SettingsCard
        title="Updates & alerts"
        description="Decide what MMSS checks automatically and which updates reach you."
        icon={<Reicon name="bell" size={17} />}
      >
        <div className="flex items-center justify-between gap-4 rounded-xl border border-neutral-200/80 p-3.5 dark:border-neutral-800/80">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">In-app notifications</p>
            <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              Show homework, messages, and announcement alerts in the header.
            </p>
          </div>
          <Toggle
            checked={inAppNotifications}
            onCheckedChange={(enabled) => onInAppNotificationsChange?.(enabled)}
            label="In-app notifications"
          />
        </div>

        {hasSchoolPortal && (
          <div className="mt-3 rounded-xl border border-neutral-200/80 p-3.5 dark:border-neutral-800/80">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <label htmlFor="settings-auto-refresh" className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                  Background updates
                </label>
                <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                  How often to check the school portal while the app is open.
                </p>
              </div>
              <select
                id="settings-auto-refresh"
                value={autoRefreshMinutes}
                onChange={(event) => onAutoRefreshChange?.(Number(event.target.value) as AutoRefreshMinutes)}
                className="h-9 shrink-0 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-400/15 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              >
                <option value={0}>Off</option>
                <option value={2}>Every 2 minutes</option>
                <option value={5}>Every 5 minutes</option>
                <option value={10}>Every 10 minutes</option>
              </select>
            </div>
            <p className="mt-3 border-t border-neutral-200/80 pt-3 text-[10px] leading-relaxed text-neutral-400 dark:border-neutral-800/80 dark:text-neutral-500">
              Manual refresh is always available from the header.
            </p>
          </div>
        )}
      </SettingsCard>
      )}

      {section === 'appearance' && (
      <SettingsCard
        title="Appearance"
        description="Pick a light or dark mode, then choose a palette for it."
        icon={<Reicon name="sun" size={17} />}
      >
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Color theme">
          {([
            { value: 'light', label: 'Light', icon: 'sun' },
            { value: 'dark', label: 'Dark', icon: 'moon' },
            { value: 'system', label: 'System', icon: 'monitor' },
          ] as const).map((mode) => (
            <button
              key={mode.value}
              type="button"
              aria-pressed={theme === mode.value}
              onClick={() => onThemeChange(mode.value)}
              className={cn(
                'flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-[11px] font-semibold transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40',
                theme === mode.value
                  ? 'border-neutral-900 bg-neutral-900 text-white shadow-sm dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                  : 'border-neutral-200 bg-neutral-50 text-neutral-600 hover:border-neutral-300 hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-400 dark:hover:border-neutral-700'
              )}
            >
              <Reicon name={mode.icon} size={17} />
              {mode.label}
            </button>
          ))}
        </div>

        <div className="mt-5 border-t border-neutral-200/80 pt-4 dark:border-neutral-800/80">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
              {resolvedTheme === 'dark' ? 'Dark themes' : 'Light themes'}
            </p>
            <p className="text-[10px] text-neutral-400 dark:text-neutral-500">
              {themesForMode(resolvedTheme).length} palettes
            </p>
          </div>
          <div
            className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3"
            role="group"
            aria-label="Theme palette"
          >
            {themesForMode(resolvedTheme).map((option) => (
              <ThemeCard
                key={option.id}
                theme={option}
                active={option.id === themeId}
                onSelect={onThemeIdChange}
              />
            ))}
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-neutral-400 dark:text-neutral-500">
            Themes apply immediately and are remembered separately for light and dark mode.
            System follows your device setting.
          </p>
        </div>
      </SettingsCard>
      )}

      {section === 'app' && (
      <SettingsCard
        title="MMSS Mohali app"
        description="Install the app for quicker access and an app-like experience."
        icon={<Reicon name="smartphone" size={17} />}
        className="lg:col-span-2"
      >
        <div className="flex flex-col justify-between gap-4 rounded-xl border border-neutral-200/80 p-4 sm:flex-row sm:items-center dark:border-neutral-800/80">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-lg',
                isInstalled
                  ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
              )}
            >
              <Reicon name={isInstalled ? 'circle-check' : 'download'} size={17} />
            </div>
            <div>
              <p className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                {isInstalled ? 'App installed' : canInstall ? 'Ready to install' : isChecking ? 'Checking install support…' : 'Install from your browser'}
              </p>
              <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                {isInstalled
                  ? 'You can open MMSS Mohali from your home screen or app drawer.'
                  : canInstall
                    ? 'Use your browser’s built-in install flow to add MMSS Mohali to this device.'
                    : isChecking
                      ? 'Checking whether this browser supports one-tap installation.'
                      : supportsInstallPrompt
                        ? 'This browser session does not currently offer installation.'
                        : 'Your browser can still add MMSS Mohali from its Share or browser menu.'}
              </p>
            </div>
          </div>
          {canInstall && !isInstalled && (
            <button
              type="button"
              onClick={handleInstallClick}
              disabled={isInstalling}
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-neutral-900 px-4 text-xs font-semibold text-white transition hover:bg-neutral-700 disabled:cursor-wait disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
              aria-busy={isInstalling}
            >
              <Reicon name="download" size={15} />
              {isInstalling ? 'Opening…' : 'Install app'}
            </button>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2 text-[10px] text-neutral-400 dark:text-neutral-500">
          <Reicon name="shield-check" size={14} className="text-emerald-500" />
          Your session uses secure, HTTP-only cookies.
        </div>
      </SettingsCard>
      )}

      <ForgotPasswordDialog
        isOpen={showPasswordHelp}
        onClose={() => setShowPasswordHelp(false)}
        variant="change"
      />
    </div>
  );
};
