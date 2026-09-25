(() => {
  const THEME_KEY = 'theme';
  const LIGHT_THEME_ID_KEY = 'theme-light';
  const DARK_THEME_ID_KEY = 'theme-dark';

  const systemIsDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

  try {
    const saved = localStorage.getItem(THEME_KEY);
    const preference = saved === 'light' || saved === 'dark' || saved === 'system'
      ? saved
      : 'light';
    const resolved = preference === 'system'
      ? (systemIsDark() ? 'dark' : 'light')
      : preference;

    // Theme ids are validated against the stylesheet at runtime: an unknown id
    // simply matches no `[data-theme]` block, so the palette falls back to the
    // stock defaults instead of breaking the page.
    const savedId = localStorage.getItem(resolved === 'dark' ? DARK_THEME_ID_KEY : LIGHT_THEME_ID_KEY);
    const themeId = typeof savedId === 'string' && savedId && /^[a-z0-9-]+$/.test(savedId)
      ? savedId
      : resolved === 'dark'
        ? 'midnight'
        : 'daylight';

    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.dataset.theme = themeId;
    document.documentElement.style.colorScheme = resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      resolved === 'dark' ? '#09090b' : '#fafafa'
    );
  } catch {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
  }
})();
