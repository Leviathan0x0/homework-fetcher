export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PWAInstallSnapshot {
  canInstall: boolean;
  isInstalled: boolean;
}

export type PWAInstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

const listeners = new Set<() => void>();
const serverSnapshot: PWAInstallSnapshot = { canInstall: false, isInstalled: false };

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let initialized = false;
let snapshot = serverSnapshot;

function isRunningStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
    document.referrer.includes('android-app://')
  );
}

function updateSnapshot(next: PWAInstallSnapshot) {
  if (snapshot.canInstall === next.canInstall && snapshot.isInstalled === next.isInstalled) return;
  snapshot = next;
  listeners.forEach((listener) => listener());
}

/**
 * Capture the browser's one-shot install event before authenticated UI mounts.
 * Every install entry point then uses this same event, so opening settings or
 * rendering a second header cannot lose or consume a different prompt.
 */
export function initializePWAInstall() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  const installed = isRunningStandalone();
  updateSnapshot({ canInstall: false, isInstalled: installed });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    updateSnapshot({ canInstall: true, isInstalled: false });
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    updateSnapshot({ canInstall: false, isInstalled: true });
  });
}

export function subscribeToPWAInstall(listener: () => void) {
  initializePWAInstall();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPWAInstallSnapshot() {
  return snapshot;
}

export function getServerPWAInstallSnapshot() {
  return serverSnapshot;
}

export async function requestPWAInstall(): Promise<PWAInstallOutcome> {
  const prompt = deferredPrompt;
  if (!prompt) return 'unavailable';

  // A BeforeInstallPromptEvent may only be used once. Clear it for every
  // install surface before opening the browser-owned confirmation dialog.
  deferredPrompt = null;
  updateSnapshot({ canInstall: false, isInstalled: false });

  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  if (outcome === 'accepted') {
    updateSnapshot({ canInstall: false, isInstalled: true });
  }
  return outcome;
}
