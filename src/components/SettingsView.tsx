import React, { useState } from 'react';
import { ThemeMode, SessionStatus } from '../types/homework';
import { UserAccount } from '../hooks/useHomework';
import { SettingsPanel, SettingsSection } from './SettingsModal';
import { Reicon } from './ui/reicon';
import { PageHeader } from './PageHeader';
import { ProfileAvatar } from './ProfileAvatar';
import { AutoRefreshMinutes } from '../utils/appPreferences';
import { getTheme, ThemeAppearance, THEMES } from '../themes';

interface SettingsViewProps {
  user: UserAccount | null;
  onLogout: () => void;
  onUserChange?: (user: UserAccount) => void;
  sessionStatus: SessionStatus;
  schoolSessionExpired?: boolean;
  onReconnect?: () => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  resolvedTheme: ThemeAppearance;
  themeId: string;
  onThemeIdChange: (id: string) => void;
  autoRefreshMinutes: AutoRefreshMinutes;
  onAutoRefreshChange: (minutes: AutoRefreshMinutes) => void;
  inAppNotifications: boolean;
  onInAppNotificationsChange: (enabled: boolean) => void;
  onBack: () => void;
}

interface SettingRowProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  value?: string;
  onClick: () => void;
}

function SettingRow({ icon, title, description, value, onClick }: SettingRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-[4.75rem] w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-400/40 sm:px-5 dark:hover:bg-neutral-800/40"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700 transition-colors group-hover:bg-white dark:bg-neutral-800 dark:text-neutral-300 dark:group-hover:bg-neutral-700">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">{description}</span>
      </span>
      {value && (
        <span className="hidden max-w-32 truncate text-xs text-neutral-500 sm:block dark:text-neutral-400">{value}</span>
      )}
      <Reicon
        name="chevron-right"
        size={17}
        className="shrink-0 text-neutral-400 transition-transform group-hover:translate-x-0.5"
      />
    </button>
  );
}

const SETTING_GROUPS: Array<{
  label: string;
  items: Array<{
    section: SettingsSection;
    icon: React.ReactNode;
    title: string;
    description: string;
  }>;
}> = [
  {
    label: 'Account',
    items: [
      {
        section: 'profile',
        icon: <Reicon name="user" size={18} />,
        title: 'Profile',
        description: 'Profile photo and name in messages',
      },
      {
        section: 'account',
        icon: <Reicon name="shield-check" size={18} />,
        title: 'Login & school connection',
        description: 'Session, password help, and sign out',
      },
    ],
  },
  {
    label: 'Preferences',
    items: [
      {
        section: 'preferences',
        icon: <Reicon name="bell" size={18} />,
        title: 'Notifications & updates',
        description: 'In-app alerts and background refresh',
      },
      {
        section: 'appearance',
        icon: <Reicon name="sun" size={18} />,
        title: 'Appearance',
        description: `Mode plus ${THEMES.length} colour themes`,
      },
    ],
  },
  {
    label: 'App',
    items: [
      {
        section: 'app',
        icon: <Reicon name="smartphone" size={18} />,
        title: 'MMSS Mohali app',
        description: 'Install or check this device',
      },
    ],
  },
];

const SECTION_COPY: Record<SettingsSection, { title: string; description: string }> = {
  profile: {
    title: 'Profile',
    description: 'Manage the photo and name other students see.',
  },
  account: {
    title: 'Login & security',
    description: 'Manage your school connection and account access.',
  },
  preferences: {
    title: 'Notifications & updates',
    description: 'Choose what you see and how often the app checks for updates.',
  },
  appearance: {
    title: 'Appearance',
    description: 'Choose a mode, then a theme that suits your environment.',
  },
  app: {
    title: 'MMSS Mohali app',
    description: 'Install the app or check its status on this device.',
  },
};

export const SettingsView: React.FC<SettingsViewProps> = ({
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
  autoRefreshMinutes,
  onAutoRefreshChange,
  inAppNotifications,
  onInAppNotificationsChange,
  onBack,
}) => {
  const [section, setSection] = useState<SettingsSection | null>(null);
  const isAdmin = Boolean(user?.isAdmin || user?.role === 'admin');
  const isTeacher = !isAdmin && Boolean(user?.isTeacher || user?.role === 'teacher' || user?.role === 'class_teacher');
  const hasSchoolPortal = !isAdmin && !isTeacher;
  const connectionValue = hasSchoolPortal
    ? schoolSessionExpired
      ? 'Disconnected'
      : sessionStatus === 'connected'
        ? 'Connected'
        : 'Expired'
    : sessionStatus === 'connected'
      ? 'Active'
      : 'Unavailable';
  const preferenceValue = inAppNotifications
    ? autoRefreshMinutes === 0
      ? 'Alerts on'
      : `Every ${autoRefreshMinutes} min`
    : 'Off';
  const header = section ? SECTION_COPY[section] : {
    title: 'Settings',
    description: 'Manage your profile, preferences, and MMSS Mohali app.',
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 sm:space-y-8">
      <PageHeader
        title={header.title}
        description={header.description}
        actions={(
          <button
            type="button"
            onClick={section ? () => setSection(null) : onBack}
            className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3.5 py-2 text-xs font-semibold text-neutral-700 shadow-2xs transition-colors hover:border-neutral-300 hover:bg-neutral-100 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-neutral-700 dark:hover:bg-neutral-800"
          >
            <Reicon name="arrow-left" size={15} preset="lift" className="size-3.5" />
            {section ? 'All settings' : 'Back'}
          </button>
        )}
      />

      {!section ? (
        <div className="space-y-6">
          <button
            type="button"
            onClick={() => setSection('profile')}
            className="group flex w-full items-center gap-4 rounded-2xl border border-neutral-200/80 bg-white p-5 text-left shadow-2xs transition hover:border-neutral-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40 sm:p-6 dark:border-neutral-800/80 dark:bg-[#111114] dark:hover:border-neutral-700"
          >
            <ProfileAvatar
              src={user?.profilePictureUrl}
              name={user?.displayName || user?.studentId}
              className="size-16 shrink-0 text-lg sm:size-20 sm:text-xl"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">
                {user?.displayName || 'Your profile'}
              </span>
              <span className="mt-1 block text-xs text-neutral-500 dark:text-neutral-400">
                Student ID {user?.studentId || '—'}
              </span>
              <span className="mt-2 block text-[11px] font-medium text-neutral-700 dark:text-neutral-300">Edit profile</span>
            </span>
            <Reicon name="chevron-right" size={18} className="shrink-0 text-neutral-400 transition-transform group-hover:translate-x-0.5" />
          </button>

          {hasSchoolPortal && schoolSessionExpired && (
            <button
              type="button"
              onClick={() => setSection('account')}
              className="flex w-full items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 dark:border-amber-900/60 dark:bg-amber-950/30 dark:hover:bg-amber-950/50"
            >
              <Reicon name="alert-triangle" size={17} className="shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-amber-900 dark:text-amber-200">School portal disconnected</span>
                <span className="mt-0.5 block text-[11px] text-amber-700 dark:text-amber-300/80">Reconnect to keep receiving homework.</span>
              </span>
              <Reicon name="chevron-right" size={16} className="text-amber-600 dark:text-amber-400" />
            </button>
          )}

          <div className="space-y-6">
            {SETTING_GROUPS.map((group) => (
              <section key={group.label} aria-labelledby={`settings-group-${group.label.toLowerCase()}`}>
                <h2
                  id={`settings-group-${group.label.toLowerCase()}`}
                  className="mb-2 px-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400"
                >
                  {group.label}
                </h2>
                <div className="divide-y divide-neutral-200/80 overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-2xs dark:divide-neutral-800/80 dark:border-neutral-800/80 dark:bg-[#111114]">
                  {group.items.map((item) => {
                    const value = item.section === 'account'
                      ? connectionValue
                      : item.section === 'preferences'
                        ? preferenceValue
                        : item.section === 'appearance'
                          ? `${getTheme(themeId)?.name ?? 'Default'}${theme === 'system' ? ' · System' : ''}`
                          : undefined;
                    return (
                      <SettingRow
                        key={item.section}
                        {...item}
                        value={value}
                        onClick={() => setSection(item.section)}
                      />
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="flex min-h-14 w-full items-center gap-3.5 rounded-2xl border border-neutral-200/80 bg-white px-4 py-3.5 text-left transition-colors hover:border-rose-200 hover:bg-rose-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/40 sm:px-5 dark:border-neutral-800/80 dark:bg-[#111114] dark:hover:border-rose-900 dark:hover:bg-rose-950/20"
          >
            <span className="flex size-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
              <Reicon name="logout" size={18} />
            </span>
            <span className="text-sm font-semibold text-rose-600 dark:text-rose-400">Sign out</span>
          </button>
        </div>
      ) : (
        <SettingsPanel
          user={user}
          onLogout={onLogout}
          onUserChange={onUserChange}
          sessionStatus={sessionStatus}
          schoolSessionExpired={schoolSessionExpired}
          onReconnect={onReconnect}
          theme={theme}
          onThemeChange={onThemeChange}
          resolvedTheme={resolvedTheme}
          themeId={themeId}
          onThemeIdChange={onThemeIdChange}
          autoRefreshMinutes={autoRefreshMinutes}
          onAutoRefreshChange={onAutoRefreshChange}
          inAppNotifications={inAppNotifications}
          onInAppNotificationsChange={onInAppNotificationsChange}
          section={section}
        />
      )}
    </div>
  );
};
