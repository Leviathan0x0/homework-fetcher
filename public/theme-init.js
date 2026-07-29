(() => {
  const systemIsDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

  try {
    const saved = localStorage.getItem('theme');
    const preference = saved === 'light' || saved === 'dark' || saved === 'system'
      ? saved
      : 'system';
    const resolved = preference === 'system'
      ? (systemIsDark() ? 'dark' : 'light')
      : preference;

    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      resolved === 'dark' ? '#09090b' : '#fafafa'
    );
  } catch {
    document.documentElement.classList.toggle('dark', systemIsDark());
  }
})();
