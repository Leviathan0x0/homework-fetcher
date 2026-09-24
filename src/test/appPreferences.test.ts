import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_APP_PREFERENCES,
  readAppPreferences,
  saveAppPreferences,
  subscribeToAppPreferences,
} from '../utils/appPreferences';

describe('appPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns safe defaults when nothing is stored', () => {
    expect(readAppPreferences()).toEqual(DEFAULT_APP_PREFERENCES);
  });

  it('persists valid preferences and notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToAppPreferences(listener);

    const next = saveAppPreferences(DEFAULT_APP_PREFERENCES, {
      autoRefreshMinutes: 10,
      inAppNotifications: false,
    });

    unsubscribe();
    expect(next).toEqual({ autoRefreshMinutes: 10, inAppNotifications: false });
    expect(readAppPreferences()).toEqual(next);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('rejects invalid stored values', () => {
    localStorage.setItem('appPreferencesV1', JSON.stringify({
      autoRefreshMinutes: 3,
      inAppNotifications: 'no',
    }));

    expect(readAppPreferences()).toEqual(DEFAULT_APP_PREFERENCES);
  });
});
