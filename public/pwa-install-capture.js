// Capture Chromium's one-shot install event before the application bundle
// loads. The React install service consumes this event when it is ready.
(() => {
  const availableEventName = 'mmss:pwa-install-available';
  const installedKey = 'pwa_installed_v6';
  window.__mmssPwaInstallPrompt = null;
  window.__mmssPwaInstallCaptureReady = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    window.__mmssPwaInstallPrompt = event;
    window.dispatchEvent(new Event(availableEventName));
  });

  window.addEventListener('appinstalled', () => {
    window.__mmssPwaInstallPrompt = null;
    window.__mmssPwaInstalled = true;
    try {
      localStorage.setItem(installedKey, 'true');
    } catch {
      // Storage can be unavailable in private or locked-down browser modes.
    }
  });
})();
