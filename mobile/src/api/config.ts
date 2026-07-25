import Constants from "expo-constants";

/**
 * Resolves the API base URL.
 *
 * Order:
 *  1. `EXPO_PUBLIC_API_BASE_URL` — always wins. Use this for a deployed API or a
 *     physical device pointed at a LAN address.
 *  2. In development, the Metro host IP with the default API port. This is what
 *     makes "clone, `npm start`, log in" work on a simulator without any env
 *     file, and avoids the classic `localhost` failure on a real device.
 *  3. `null` — the app then shows an explicit configuration error instead of
 *     firing requests at an unknown host and timing out.
 */
const DEFAULT_LOCAL_API_PORT = 3000;

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function deriveFromMetroHost(): string | null {
  // e.g. "192.168.1.42:8081" while running `expo start`.
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost;
  if (hostUri) {
    const host = hostUri.split(":")[0];
    if (host) return `http://${host}:${DEFAULT_LOCAL_API_PORT}`;
  }
  // In web environment, derive host from window.location.hostname
  if (typeof window !== "undefined" && window.location?.hostname) {
    const host = window.location.hostname || "localhost";
    return `http://${host}:${DEFAULT_LOCAL_API_PORT}`;
  }
  return null;
}

function resolveBaseUrl(): string | null {
  const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (fromEnv) return stripTrailingSlash(fromEnv);
  if (__DEV__) return deriveFromMetroHost();
  return null;
}

export const API_BASE_URL: string | null = resolveBaseUrl();

export const isApiConfigured = (): boolean => API_BASE_URL !== null;

/** Absolute URL for an API path or a server-relative `fileUrl`. */
export function apiUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (!API_BASE_URL) {
    throw new Error("API base URL is not configured. Set EXPO_PUBLIC_API_BASE_URL.");
  }
  return `${API_BASE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

/**
 * Server-enforced limits, mirrored client-side.
 *
 * These are checked before a request leaves the device so an oversized or
 * over-long payload never reaches the network and the user gets an immediate,
 * specific message instead of a 400.
 */
export const LIMITS = {
  /**
   * Hard upload ceiling. The server allows 10 MB on a normal Node host but only
   * 4 MB on a serverless one (the platform rejects a larger body before the
   * function even runs), so the client enforces the lower figure everywhere.
   */
  maxUploadBytes: 4 * 1024 * 1024,
  maxMessageChars: 4000,
  maxRequestTitleChars: 120,
  maxRequestDetailsChars: 2000,
  /** `PATCH /api/auth/profile` rejects anything outside this range. */
  minDisplayNameChars: 2,
  maxDisplayNameChars: 40,
  maxSearchQueryChars: 64,
} as const;

/** Debounce before a search request is issued, per the search spec. */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * How long the slow homework re-scrape may run before the UI admits it is taking
 * unusually long. The request itself is still bounded by `TIMEOUTS.slowRefresh`;
 * this only changes the copy so a genuinely slow operation never looks frozen.
 */
export const SLOW_REFRESH_WARNING_MS = 20_000;

/** Image compression applied to every picked photo before upload. */
export const IMAGE_COMPRESSION = {
  maxEdge: 1600,
  jpegQuality: 0.8,
} as const;

/**
 * Polling cadences. There is no realtime channel, so these are the refresh
 * contract. All of them are suspended while the app is backgrounded — see
 * `src/query/appStateSync.ts`.
 */
export const POLL_INTERVALS = {
  /** Open chat thread. */
  messages: 3_000,
  /** Conversation list. */
  inbox: 6_000,
  /** Unread badge on the tab bar. */
  unreadBadge: 20_000,
} as const;

/** Request timeouts. Nothing is allowed to hang indefinitely. */
export const TIMEOUTS = {
  default: 15_000,
  /** `/api/homework/refresh` re-scrapes the school portal and is genuinely slow. */
  slowRefresh: 45_000,
  upload: 60_000,
} as const;
