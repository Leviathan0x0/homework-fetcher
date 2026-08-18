export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.update();
        console.log('[PWA] Service worker registered successfully & updated:', reg.scope);
      })
      .catch((err) => {
        console.error('[PWA] Service worker registration failed:', err);
      });
  }
}
