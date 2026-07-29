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
const DEFAULT_API_TIMEOUT_MS = 20000;

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

type ApiRequestInit = RequestInit & { timeoutMs?: number };

function withBodyDeadline(
  response: Response,
  cleanup: () => void,
  didTimeOut: () => boolean
): Response {
  const bodyMethods = new Set<PropertyKey>(["arrayBuffer", "blob", "formData", "json", "text"]);
  return new Proxy(response, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (!bodyMethods.has(property) || typeof value !== "function") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args: unknown[]) => {
        try {
          return await value.apply(target, args);
        } catch (err) {
          if (didTimeOut()) {
            throw new Error("The server took too long to respond. Please try again.");
          }
          throw err;
        } finally {
          cleanup();
        }
      };
    },
  });
}

/** fetch() wrapper that targets the API origin and always sends session cookies. */
export async function apiFetch(path: string, init: ApiRequestInit = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_API_TIMEOUT_MS, signal, ...requestInit } = init;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });

  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
    signal?.removeEventListener("abort", abortFromCaller);
  }, timeoutMs);
  const cleanup = () => {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  };

  try {
    const response = await fetch(apiUrl(path), {
      credentials: "include",
      ...requestInit,
      signal: controller.signal,
    });
    return withBodyDeadline(response, cleanup, () => timedOut);
  } catch (err: unknown) {
    cleanup();
    if (timedOut) {
      throw new Error("The server took too long to respond. Please try again.");
    }
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
  }
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
