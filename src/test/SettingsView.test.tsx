import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SettingsView } from '../components/SettingsView';
import { themesForMode } from '../themes';

const baseProps = {
  user: { id: 'user-1', studentId: 'student-1', displayName: 'Student' },
  onLogout: vi.fn(),
  sessionStatus: 'connected' as const,
  theme: 'system' as const,
  onThemeChange: vi.fn(),
  resolvedTheme: 'light' as const,
  themeId: 'daylight',
  onThemeIdChange: vi.fn(),
  autoRefreshMinutes: 2 as const,
  onAutoRefreshChange: vi.fn(),
  inAppNotifications: true,
  onInAppNotificationsChange: vi.fn(),
  onBack: vi.fn(),
};

describe('SettingsView', () => {
  it('opens focused detail screens from the settings overview', async () => {
    const user = userEvent.setup();
    render(<SettingsView {...baseProps} />);

    await user.click(screen.getByRole('button', { name: /^Profile Profile photo and name in messages/i }));

    expect(screen.getByRole('heading', { level: 1, name: 'Profile' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name in messages')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'All settings' }));
    await user.click(screen.getByRole('button', { name: /Notifications & updates In-app alerts and background refresh/i }));

    expect(screen.getByRole('heading', { level: 1, name: 'Notifications & updates' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'In-app notifications' })).toBeInTheDocument();
  });

  it('offers every theme for the active mode and applies the selection', async () => {
    const user = userEvent.setup();
    const onThemeIdChange = vi.fn();
    const onThemeChange = vi.fn();
    render(<SettingsView {...baseProps} onThemeChange={onThemeChange} onThemeIdChange={onThemeIdChange} />);

    await user.click(screen.getByRole('button', { name: /Appearance Mode plus 20 colour themes/i }));

    expect(screen.getByRole('heading', { level: 1, name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByText('Light themes')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: / theme$/i })).toHaveLength(themesForMode('light').length);
    expect(screen.getByRole('button', { name: 'Daylight theme' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Sky theme' }));
    expect(onThemeIdChange).toHaveBeenCalledWith('sky');

    await user.click(screen.getByRole('button', { name: 'Dark' }));
    expect(onThemeChange).toHaveBeenCalledWith('dark');
  });
});
