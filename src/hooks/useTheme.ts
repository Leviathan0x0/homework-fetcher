import { useCallback, useEffect, useRef, useState } from 'react';
import { ThemeMode } from '../types/homework';

type ResolvedTheme = Exclude<ThemeMode, 'system'>;

const THEME_STORAGE_KEY = 'theme';

function getSavedTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
  } catch {
    return 'system';
  }
}

function resolveTheme(preference: ThemeMode): ResolvedTheme {
  if (preference !== 'system') return preference;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyResolvedTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  themeColor?.setAttribute('content', resolved === 'dark' ? '#09090b' : '#fafafa');
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(getSavedTheme);
  const initialResolved = resolveTheme(theme);
  const resolvedThemeRef = useRef<ResolvedTheme>(initialResolved);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(initialResolved);

  const syncResolvedTheme = useCallback((preference: ThemeMode) => {
    const resolved = resolveTheme(preference);
    resolvedThemeRef.current = resolved;
    applyResolvedTheme(resolved);
    setResolvedTheme(resolved);
  }, []);

  const setTheme = useCallback((preference: ThemeMode) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Theme still applies for this session when storage is unavailable.
    }
    syncResolvedTheme(preference);
    setThemeState(preference);
  }, [syncResolvedTheme]);

  useEffect(() => {
    syncResolvedTheme(theme);
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => syncResolvedTheme('system');
    mediaQuery.addEventListener('change', handleSystemThemeChange);
    return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
  }, [theme, syncResolvedTheme]);

  const toggleTheme = useCallback(() => {
    setTheme(resolvedThemeRef.current === 'dark' ? 'light' : 'dark');
  }, [setTheme]);

  return { theme, resolvedTheme, setTheme, toggleTheme };
}
