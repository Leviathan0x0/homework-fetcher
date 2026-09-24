export type AutoRefreshMinutes = 0 | 2 | 5 | 10;

export interface AppPreferences {
  autoRefreshMinutes: AutoRefreshMinutes;
  inAppNotifications: boolean;
}

const STORAGE_KEY = 'appPreferencesV1';
const CHANGE_EVENT = 'app_preferences_changed';

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  autoRefreshMinutes: 2,
  inAppNotifications: true,
};

function isAutoRefreshMinutes(value: unknown): value is AutoRefreshMinutes {
  return value === 0 || value === 2 || value === 5 || value === 10;
}

export function readAppPreferences(): AppPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APP_PREFERENCES;
    const value = JSON.parse(raw) as Partial<AppPreferences>;
    return {
      autoRefreshMinutes: isAutoRefreshMinutes(value.autoRefreshMinutes)
        ? value.autoRefreshMinutes
        : DEFAULT_APP_PREFERENCES.autoRefreshMinutes,
      inAppNotifications: typeof value.inAppNotifications === 'boolean'
        ? value.inAppNotifications
        : DEFAULT_APP_PREFERENCES.inAppNotifications,
    };
  } catch {
    return DEFAULT_APP_PREFERENCES;
  }
}

export function saveAppPreferences(
  preferences: AppPreferences,
  patch: Partial<AppPreferences>
): AppPreferences {
  const next = { ...preferences, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return next;
}

export function subscribeToAppPreferences(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}
