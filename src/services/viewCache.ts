/**
 * Last successful payload for a read-only screen.
 *
 * Every screen used to mount with an empty list and a spinner, so opening a tab
 * meant waiting for a full round trip before anything at all appeared. Drawing
 * the previous result immediately and replacing it once the request settles
 * keeps navigation instant. The server still authorises every request, so this
 * only ever affects what is drawn, never what an account is allowed to see, and
 * it is dropped on login and logout so it can only belong to the signed-in
 * account.
 */
const PREFIX = "viewCache:";

export function readViewCache<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function writeViewCache(key: string, value: unknown) {
  try {
    localStorage.setItem(`${PREFIX}${key}`, JSON.stringify(value));
  } catch {
    // A full or unavailable storage quota only costs the head start.
  }
}

export function clearViewCache() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Nothing to drop when storage is unavailable.
  }
}
