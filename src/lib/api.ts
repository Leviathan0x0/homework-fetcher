/**
 * Central API client for the Express backend.
 *
 * In development Vite mounts the Express app in-process, so relative "/api/..."
 * URLs resolve against the dev server. When the frontend is deployed on its own
 * (static hosting such as Appwrite Sites, Vercel, Netlify), the Express API lives
 * on a different origin and must be configured through VITE_API_BASE_URL.
 */
const metaEnv = (import.meta as any).env || {};
const RAW_API_BASE_URL = (metaEnv.VITE_API_BASE_URL || "").trim();

export const API_BASE_URL = RAW_API_BASE_URL.replace(/\/+$/, "");

/**
 * Largest upload the API accepts. Serverless hosts reject bodies above ~4.5 MB
 * before the request reaches the server, so the browser must enforce it too.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Resolves an API/served-file path against the configured API origin. */
export function apiUrl(path: string): string {
  if (!path) return path;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//")) return path;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${suffix}`;
}

/** Thrown when the API origin answers with something other than JSON. */
export class ApiUnreachableError extends Error {
  constructor(url: string) {
    super(
      API_BASE_URL
        ? `The homework API at ${API_BASE_URL} did not return JSON. Check that the Express server is running and reachable from the browser.`
        : `No homework API is reachable at ${url}. This build has no API origin configured: set VITE_API_BASE_URL to the URL of the Express server and rebuild.`
    );
    this.name = "ApiUnreachableError";
  }
}

/**
 * GET requests currently on the wire, keyed by URL.
 *
 * Several screens poll the same endpoints (inbox counts, unread badge, message
 * list) and mount at the same time, so identical requests used to stack up and
 * queue behind each other. Sharing the response means one round trip serves
 * every caller; each gets its own clone so the body can still be read once.
 */
const inFlightGets = new Map<string, Promise<Response>>();

/** fetch() wrapper that targets the API origin and always sends session cookies. */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || "GET").toUpperCase();
  const isShareable = method === "GET" && !init.body && !init.signal;
  if (!isShareable) return requestApi(path, init);

  const key = apiUrl(path);
  const pending = inFlightGets.get(key);
  if (pending) return pending.then((res) => res.clone());

  const request = requestApi(path, init).finally(() => {
    inFlightGets.delete(key);
  });
  inFlightGets.set(key, request);
  return request.then((res) => res.clone());
}

function requestApi(path: string, init: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), { credentials: "include", ...init }).catch((err: unknown) => {
    const reason = err instanceof Error ? err.message : String(err);
    // Browser TypeError is usually just "Failed to fetch" — make it actionable.
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(reason)) {
      throw new Error(
        API_BASE_URL
          ? `Can't reach the homework API at ${API_BASE_URL}. Check that the server is running and your network is online.`
          : "Can't reach the homework API. Start the server (`npm start` / `npm run dev`) and try again."
      );
    }
    throw err instanceof Error ? err : new Error(reason);
  });
}

/**
 * Parses an API response as JSON.
 * Static hosts answer unknown paths with index.html, which would otherwise fail
 * with an opaque "Unexpected token '<'" error, so surface a diagnosable message.
 */
export async function apiJson<T = any>(res: Response): Promise<T> {
  const body = await res.text();
  if (!body.trim()) return {} as T;
  try {
    return JSON.parse(body) as T;
  } catch {
    if (!res.ok) {
      return { error: `Server unavailable (HTTP ${res.status}). Please try again shortly.` } as T;
    }
    throw new ApiUnreachableError(res.url || apiUrl("/api"));
  }
}
