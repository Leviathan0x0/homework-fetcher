import React from 'react';
import { ThemeMode, SessionStatus } from '../types/homework';
import { UserAccount } from '../hooks/useHomework';
import { SettingsPanel } from './SettingsModal';
import { InteractiveAnimatedIcon } from './ui/interactive-animated-icon';
import { ArrowLeftIcon } from './ui/arrow-left';

interface SettingsViewProps {
  user: UserAccount | null;
  onLogout: () => void;
  onUserChange?: (user: UserAccount) => void;
  sessionStatus: SessionStatus;
  schoolSessionExpired?: boolean;
  onReconnect?: () => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  onBack: () => void;
}

/**
 * Full-screen settings for phones. It reuses the same panel as the desktop
 * modal, so there is only one implementation of the settings themselves.
 */
export const SettingsView: React.FC<SettingsViewProps> = ({
  user,
  onLogout,
  onUserChange,
  sessionStatus,
  schoolSessionExpired,
  onReconnect,
  theme,
  onThemeChange,
  onBack,
}) => {
  return (
    <div className="-mx-4 sm:-mx-6 -mt-6 flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-200/70 dark:border-neutral-800/70">
        <button
          onClick={onBack}
          aria-label="Back"
          className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer active:scale-95"
        >
          <InteractiveAnimatedIcon icon={ArrowLeftIcon} size={16} className="w-4 h-4" />
        </button>
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Settings & account</h2>
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
      />
    </div>
  );
};
