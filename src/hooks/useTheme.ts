import { useCallback, useEffect, useRef, useState } from 'react';
import { ThemeMode } from '../types/homework';
import {
  AppTheme,
  DEFAULT_THEME_ID,
  getTheme,
  resolveThemeId,
} from '../themes';

type ResolvedTheme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'theme';
const LIGHT_THEME_ID_KEY = 'theme-light';
const DARK_THEME_ID_KEY = 'theme-dark';

const FALLBACK_THEME_COLOR: Record<ResolvedTheme, string> = {
  light: '#fafafa',
  dark: '#09090b',
};

function getSavedTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'light';
  } catch {
    return 'light';
  }
}

function themeIdKey(mode: ResolvedTheme) {
  return mode === 'dark' ? DARK_THEME_ID_KEY : LIGHT_THEME_ID_KEY;
}

function readThemeId(mode: ResolvedTheme): string {
  try {
    return resolveThemeId(localStorage.getItem(themeIdKey(mode)), mode);
  } catch {
    return DEFAULT_THEME_ID[mode];
  }
}

function writeThemeId(mode: ResolvedTheme, id: string) {
  try {
    localStorage.setItem(themeIdKey(mode), id);
  } catch {
    // Theme still applies for this session when storage is unavailable.
  }
}

function resolveTheme(preference: ThemeMode): ResolvedTheme {
  if (preference !== 'system') return preference;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(resolved: ResolvedTheme, themeId: string) {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.dataset.theme = themeId;
  root.style.colorScheme = resolved;

  const themeColor = getTheme(themeId)?.themeColor ?? FALLBACK_THEME_COLOR[resolved];
  const themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  themeColorMeta?.setAttribute('content', themeColor);
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(getSavedTheme);
  const initialResolved = resolveTheme(theme);
  const resolvedThemeRef = useRef<ResolvedTheme>(initialResolved);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(initialResolved);
  const [themeIds, setThemeIds] = useState<Record<ResolvedTheme, string>>(() => ({
    light: readThemeId('light'),
    dark: readThemeId('dark'),
  }));

  const themeId = themeIds[resolvedTheme];
  const activeTheme: AppTheme | undefined = getTheme(themeId);

  const syncResolvedTheme = useCallback((preference: ThemeMode, ids: Record<ResolvedTheme, string>) => {
    const resolved = resolveTheme(preference);
    resolvedThemeRef.current = resolved;
    applyTheme(resolved, ids[resolved]);
    setResolvedTheme(resolved);
  }, []);

  const setTheme = useCallback((preference: ThemeMode) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Theme still applies for this session when storage is unavailable.
    }
    setThemeState(preference);
    syncResolvedTheme(preference, themeIds);
  }, [syncResolvedTheme, themeIds]);

  const setThemeId = useCallback((id: string) => {
    const nextTheme = getTheme(id);
    if (!nextTheme) return;

    const ids = { ...themeIds, [nextTheme.mode]: nextTheme.id };
    writeThemeId(nextTheme.mode, nextTheme.id);
    setThemeIds(ids);

    if (nextTheme.mode !== resolvedThemeRef.current) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme.mode);
      } catch {
        // Storage unavailable; the in-memory preference still applies.
      }
      setThemeState(nextTheme.mode);
      syncResolvedTheme(nextTheme.mode, ids);
      return;
    }

    applyTheme(nextTheme.mode, nextTheme.id);
  }, [syncResolvedTheme, themeIds]);

  useEffect(() => {
    const resolved = resolveTheme(theme);
    resolvedThemeRef.current = resolved;
    applyTheme(resolved, themeIds[resolved]);
    setResolvedTheme(resolved);
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => syncResolvedTheme('system', themeIds);
    mediaQuery.addEventListener('change', handleSystemThemeChange);
    return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
  }, [theme, themeIds, syncResolvedTheme]);

  const toggleTheme = useCallback(() => {
    setTheme(resolvedThemeRef.current === 'dark' ? 'light' : 'dark');
  }, [setTheme]);

  return {
    theme,
    resolvedTheme,
    themeId,
    activeTheme,
    setTheme,
    setThemeId,
    toggleTheme,
  };
}
