export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PWAInstallSnapshot {
  canInstall: boolean;
  isInstalled: boolean;
  isChecking: boolean;
  supportsInstallPrompt: boolean;
}

export type PWAInstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

interface PWAInstallWindow extends Window {
  __mmssPwaInstallPrompt?: BeforeInstallPromptEvent | null;
  __mmssPwaInstalled?: boolean;
}

const INSTALL_AVAILABLE_EVENT = 'mmss:pwa-install-available';
const INSTALLED_KEY = 'pwa_installed_v6';
const LEGACY_INSTALLED_KEYS = ['pwa_installed_v5'];
const INSTALL_DECISION_DELAY_MS = 500;
const SERVICE_WORKER_READY_TIMEOUT_MS = 2_500;

const listeners = new Set<() => void>();
const serverSnapshot: PWAInstallSnapshot = {
  canInstall: false,
  isInstalled: false,
  isChecking: true,
  supportsInstallPrompt: false,
};

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

function hasInstallMarker(): boolean {
  try {
    return [INSTALLED_KEY, ...LEGACY_INSTALLED_KEYS].some(
      (key) => localStorage.getItem(key) === 'true',
    );
  } catch {
    return false;
  }
}

function setInstallMarker(installed: boolean) {
  try {
    if (installed) {
      localStorage.setItem(INSTALLED_KEY, 'true');
      return;
    }
    localStorage.removeItem(INSTALLED_KEY);
    LEGACY_INSTALLED_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Storage is only a compatibility hint for installations made by older builds.
  }
}

interface RelatedApplication {
  id?: string;
  platform: string;
  url?: string;
}

interface NavigatorWithRelatedApps extends Navigator {
  getInstalledRelatedApps?: () => Promise<RelatedApplication[]>;
}

function isThisPWA(application: RelatedApplication): boolean {
  if (application.platform !== 'webapp') return false;
  if (application.id === '/' || application.id === `${window.location.origin}/`) return true;
  if (!application.url) return false;

  try {
    const manifestUrl = new URL(application.url, window.location.href);
    return manifestUrl.origin === window.location.origin && manifestUrl.pathname === '/manifest.json';
  } catch {
    return false;
  }
}

async function detectRelatedInstallation() {
  const relatedAppsNavigator = navigator as NavigatorWithRelatedApps;
  if (!relatedAppsNavigator.getInstalledRelatedApps) return;

  try {
    const applications = await relatedAppsNavigator.getInstalledRelatedApps();
    if (!applications.some(isThisPWA)) return;
    setInstallMarker(true);
    updateSnapshot({
      ...snapshot,
      canInstall: false,
      isInstalled: true,
      isChecking: false,
    });
  } catch {
    // This API is optional and can be blocked by browser privacy policy.
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function waitForWindowLoad() {
  if (document.readyState === 'complete') return Promise.resolve();
  return new Promise<void>((resolve) => {
    window.addEventListener('load', () => resolve(), { once: true });
  });
}

async function settleInstallCheck() {
  await waitForWindowLoad();
  if ('serviceWorker' in navigator) {
    await Promise.race([
      navigator.serviceWorker.ready.then(() => undefined),
      delay(SERVICE_WORKER_READY_TIMEOUT_MS),
    ]);
  }
  await delay(INSTALL_DECISION_DELAY_MS);
  if (!snapshot.isChecking) return;
  updateSnapshot({ ...snapshot, isChecking: false });
}

function updateSnapshot(next: PWAInstallSnapshot) {
  if (
    snapshot.canInstall === next.canInstall &&
    snapshot.isInstalled === next.isInstalled &&
    snapshot.isChecking === next.isChecking &&
    snapshot.supportsInstallPrompt === next.supportsInstallPrompt
  ) {
    return;
  }
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function capturePrompt(prompt: BeforeInstallPromptEvent) {
  prompt.preventDefault();
  deferredPrompt = prompt;
  setInstallMarker(false);
  updateSnapshot({
    canInstall: true,
    isInstalled: false,
    isChecking: false,
    supportsInstallPrompt: true,
  });
}

/**
 * Capture the browser's one-shot install event before authenticated UI mounts.
 * Every install entry point then uses this same event, so opening settings or
 * rendering a second header cannot lose or consume a different prompt.
 */
export function initializePWAInstall() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  const installWindow = window as PWAInstallWindow;
  const installed =
    isRunningStandalone() || installWindow.__mmssPwaInstalled === true || hasInstallMarker();
  updateSnapshot({
    canInstall: false,
    isInstalled: installed,
    isChecking: !installed,
    supportsInstallPrompt: 'onbeforeinstallprompt' in window,
  });

  if (installWindow.__mmssPwaInstallPrompt) {
    capturePrompt(installWindow.__mmssPwaInstallPrompt);
  }

  void detectRelatedInstallation();
  void settleInstallCheck();

  window.addEventListener('beforeinstallprompt', (event) => {
    capturePrompt(event as BeforeInstallPromptEvent);
  });

  window.addEventListener(INSTALL_AVAILABLE_EVENT, () => {
    const earlyPrompt = installWindow.__mmssPwaInstallPrompt;
    if (earlyPrompt) capturePrompt(earlyPrompt);
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installWindow.__mmssPwaInstallPrompt = null;
    installWindow.__mmssPwaInstalled = true;
    setInstallMarker(true);
    updateSnapshot({ ...snapshot, canInstall: false, isInstalled: true, isChecking: false });
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

export async function refreshPWAInstallStatus() {
  initializePWAInstall();
  await detectRelatedInstallation();
}

export async function requestPWAInstall(): Promise<PWAInstallOutcome> {
  const prompt = deferredPrompt;
  if (!prompt) return 'unavailable';

  // A BeforeInstallPromptEvent may only be used once. Clear it for every
  // install surface before opening the browser-owned confirmation dialog.
  deferredPrompt = null;
  (window as PWAInstallWindow).__mmssPwaInstallPrompt = null;
  updateSnapshot({ ...snapshot, canInstall: false, isInstalled: false, isChecking: false });

  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  if (outcome === 'accepted') {
    setInstallMarker(true);
    updateSnapshot({ ...snapshot, canInstall: false, isInstalled: true, isChecking: false });
  }
  return outcome;
}
