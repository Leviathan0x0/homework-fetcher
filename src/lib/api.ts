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
 * Hard ceiling on how long a single API call may take.
 *
 * fetch() has no timeout of its own, so a request that never gets an answer
 * (a serverless instance still booting, a dropped mobile connection) left the
 * screen spinning until the user reloaded the page by hand. Aborting turns
 * that dead end into an error the UI can show and retry from. Requests that
 * carry a body get a longer budget: an attachment on a slow phone connection
 * legitimately takes far longer than a read.
 */
const REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 90_000;

/**
 * Buffered responses for GETs currently on the wire, keyed by URL.
 *
 * Several screens poll the same endpoints (inbox counts, unread badge, message
 * list) and mount at the same time, so identical requests used to stack up and
 * queue behind each other. The body is read once and each caller gets its own
 * Response built from those bytes: handing out Response.clone() instead makes
 * the browser tee the stream, and a branch nobody reads can stall the branch
 * that is being read.
 */
type BufferedResponse = {
  body: ArrayBuffer;
  status: number;
  statusText: string;
  contentType: string | null;
};

const inFlightGets = new Map<string, Promise<BufferedResponse>>();

function rebuildResponse(buffered: BufferedResponse): Response {
  // 204/205/304 must not carry a body, and the constructor throws if one is given.
  const bodyless = buffered.status === 204 || buffered.status === 205 || buffered.status === 304;
  return new Response(bodyless ? null : buffered.body.slice(0), {
    status: buffered.status,
    statusText: buffered.statusText,
    headers: buffered.contentType ? { "Content-Type": buffered.contentType } : undefined,
  });
}

/** fetch() wrapper that targets the API origin and always sends session cookies. */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || "GET").toUpperCase();
  const isShareable = method === "GET" && !init.body && !init.signal;
  if (!isShareable) return requestApi(path, init);

  const key = apiUrl(path);
  let pending = inFlightGets.get(key);
  if (!pending) {
    pending = requestApi(path, init)
      .then(async (res) => ({
        body: await res.arrayBuffer(),
        status: res.status,
        statusText: res.statusText,
        contentType: res.headers.get("content-type"),
      }))
      .finally(() => {
        inFlightGets.delete(key);
      });
    inFlightGets.set(key, pending);
  }
  return pending.then(rebuildResponse);
}

function requestApi(path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init.signal;
  const budgetMs = init.body ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  let timedOut = false;

  const abortFromCaller = () => controller.abort();
  callerSignal?.addEventListener("abort", abortFromCaller);

  // The timer stays armed past the response headers on purpose: the body is
  // still streaming at that point, and a download that stalls half way would
  // otherwise hang the caller forever. Aborting a response that has already
  // been read is a no-op.
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }, budgetMs);

  return fetch(apiUrl(path), { credentials: "include", ...init, signal: controller.signal })
    .catch((err: unknown) => {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortFromCaller);
      // A caller-driven abort (navigating away, switching conversation) must
      // stay an abort so callers can keep ignoring it.
      if (callerSignal?.aborted) throw err;
      if (timedOut) {
        throw new Error("The server took too long to respond. Check your connection and try again.");
      }
      const reason = err instanceof Error ? err.message : String(err);
      // Browser TypeError is usually just "Failed to fetch" - make it actionable.
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
