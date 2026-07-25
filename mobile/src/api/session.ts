import * as SecureStore from "expo-secure-store";

/**
 * Session credential storage.
 *
 * The credential lives in the device keychain / keystore via expo-secure-store —
 * never in AsyncStorage and never in the JS bundle. A synchronous in-memory copy
 * is kept so the request path does not need to await the keychain on every call.
 */
const SESSION_KEY = "homework.session.token.v1";

type SessionListener = (token: string | null) => void;

let cachedToken: string | null = null;
let hydrated = false;
const listeners = new Set<SessionListener>();

function emit(token: string | null): void {
  for (const listener of listeners) {
    listener(token);
  }
}

/** Reads the persisted credential once at startup. Safe to call repeatedly. */
export async function hydrateSession(): Promise<string | null> {
  if (hydrated) return cachedToken;
  try {
    cachedToken = await SecureStore.getItemAsync(SESSION_KEY);
  } catch (error) {
    // A keychain read can fail on a locked or misconfigured device. Treat it as
    // "no session" rather than crashing the app on launch.
    if (__DEV__) {
      console.warn("[session] secure store read failed, continuing signed out:", error);
    }
    cachedToken = null;
  }
  hydrated = true;
  return cachedToken;
}

/** Synchronous read for the request path. Returns `null` before hydration. */
export function getSessionToken(): string | null {
  return cachedToken;
}

export function isSessionHydrated(): boolean {
  return hydrated;
}

export async function setSessionToken(token: string): Promise<void> {
  cachedToken = token;
  hydrated = true;
  try {
    await SecureStore.setItemAsync(SESSION_KEY, token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch (error) {
    // The in-memory copy still works for this launch; the user just has to sign
    // in again next time. Surfacing a hard failure here would be worse.
    if (__DEV__) {
      console.warn("[session] secure store write failed; session is memory-only:", error);
    }
  }
  emit(token);
}

export async function clearSessionToken(): Promise<void> {
  cachedToken = null;
  hydrated = true;
  try {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  } catch (error) {
    if (__DEV__) {
      console.warn("[session] secure store delete failed:", error);
    }
  }
  emit(null);
}

export function subscribeToSession(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
