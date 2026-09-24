import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SettingsView } from '../components/SettingsView';

const baseProps = {
  user: { id: 'user-1', studentId: 'student-1', displayName: 'Student' },
  onLogout: vi.fn(),
  sessionStatus: 'connected' as const,
  theme: 'system' as const,
  onThemeChange: vi.fn(),
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
});
