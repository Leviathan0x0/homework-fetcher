import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from '../components/SettingsModal';

const baseProps = {
  user: { id: 'user-1', studentId: 'student-1', displayName: 'Student' },
  onLogout: vi.fn(),
  sessionStatus: 'connected' as const,
  theme: 'light' as const,
  onThemeChange: vi.fn(),
};

describe('SettingsPanel', () => {
  it('updates real user preferences', async () => {
    const onInAppNotificationsChange = vi.fn();
    const onAutoRefreshChange = vi.fn();
    const user = userEvent.setup();

    render(
      <SettingsPanel
        {...baseProps}
        onInAppNotificationsChange={onInAppNotificationsChange}
        onAutoRefreshChange={onAutoRefreshChange}
        section="preferences"
      />,
    );

    const notifications = screen.getByRole('switch', { name: 'In-app notifications' });
    expect(notifications).toHaveAttribute('aria-checked', 'true');
    await user.click(notifications);
    expect(onInAppNotificationsChange).toHaveBeenCalledWith(false);

    await user.selectOptions(screen.getByLabelText('Background updates'), '5');
    expect(onAutoRefreshChange).toHaveBeenCalledWith(5);
  });
});
