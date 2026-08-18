import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PWAInstallPrompt } from '../components/PWAInstallPrompt';
import { SettingsPanel } from '../components/SettingsModal';
import { initializePWAInstall, refreshPWAInstallStatus } from '../services/pwaInstall';

function dispatchInstallEvent(prompt: () => Promise<void>) {
  const installEvent = new Event('beforeinstallprompt', { cancelable: true });
  Object.defineProperties(installEvent, {
    prompt: { value: prompt },
    userChoice: { value: Promise.resolve({ outcome: 'dismissed' as const }) },
  });
  window.dispatchEvent(installEvent);
  return installEvent;
}

function captureInstallEventBeforeAppLoads(prompt: () => Promise<void>) {
  const installEvent = new Event('beforeinstallprompt', { cancelable: true });
  Object.defineProperties(installEvent, {
    prompt: { value: prompt },
    userChoice: { value: Promise.resolve({ outcome: 'dismissed' as const }) },
  });
  installEvent.preventDefault();
  (window as Window & { __mmssPwaInstallPrompt?: Event }).__mmssPwaInstallPrompt = installEvent;
  return installEvent;
}

describe('PWAInstallPrompt', () => {
  it('uses an install event captured before the button mounts', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);

    const installEvent = captureInstallEventBeforeAppLoads(prompt);
    initializePWAInstall();

    render(<PWAInstallPrompt variant="button" />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Install MMSS Mohali App' }));

    expect(installEvent.defaultPrevented).toBe(true);
    expect(prompt).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Install MMSS Mohali App' })).not.toBeInTheDocument();
    });
  });

  it('opens the native prompt on the first click from settings', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    dispatchInstallEvent(prompt);

    render(
      <SettingsPanel
        user={{ id: 'user-1', studentId: 'student-1', displayName: 'Student' }}
        onLogout={vi.fn()}
        sessionStatus="connected"
        theme="light"
        onThemeChange={vi.fn()}
      />,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Install' }));

    expect(prompt).toHaveBeenCalledOnce();
    expect(screen.queryByText(/select your device for instructions/i)).not.toBeInTheDocument();
  });

  it('recognizes an installation created by the first PWA version', async () => {
    const getInstalledRelatedApps = vi.fn().mockResolvedValue([
      {
        id: `${window.location.origin}/`,
        platform: 'webapp',
        url: `${window.location.origin}/manifest.json`,
      },
    ]);
    Object.defineProperty(navigator, 'getInstalledRelatedApps', {
      configurable: true,
      value: getInstalledRelatedApps,
    });

    await refreshPWAInstallStatus();
    render(
      <SettingsPanel
        user={{ id: 'user-1', studentId: 'student-1', displayName: 'Student' }}
        onLogout={vi.fn()}
        sessionStatus="connected"
        theme="light"
        onThemeChange={vi.fn()}
      />,
    );

    expect(screen.getByText('App is installed on your device.')).toBeInTheDocument();
    expect(getInstalledRelatedApps).toHaveBeenCalledOnce();
    expect(screen.queryByText(/has no one-click install API/i)).not.toBeInTheDocument();
    delete (navigator as Navigator & { getInstalledRelatedApps?: unknown }).getInstalledRelatedApps;
  });
});
