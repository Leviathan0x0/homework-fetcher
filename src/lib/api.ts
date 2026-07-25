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

/** fetch() wrapper that targets the API origin and always sends session cookies. */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), { credentials: "include", ...init });
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
    throw new ApiUnreachableError(res.url || apiUrl("/api"));
  }
}
