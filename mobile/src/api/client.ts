import { API_BASE_URL, TIMEOUTS, apiUrl } from "./config";
import { ApiError, kindFromStatus } from "./errors";
import { getSessionToken } from "./session";

/**
 * The single place that talks to the network.
 *
 * Responsibilities, deliberately centralised:
 *  - attach the auth credential
 *  - enforce a timeout on every request (nothing hangs forever)
 *  - turn any failure into an `ApiError` with a `kind` the UI can branch on
 *  - notify the auth layer once, from one place, on a 401
 *
 * ---------------------------------------------------------------------------
 * Auth note
 * ---------------------------------------------------------------------------
 * The API accepts the session token in either transport: browsers use the
 * httpOnly `app_session` cookie, native clients send the same token as
 * `Authorization: Bearer <token>` (see `server/auth/requireAuth.js`). Login
 * returns the token in its body, so this client is bearer-only and never relies
 * on a cookie jar — which matters because native image and file loaders do not
 * share the RN cookie jar and could not authenticate a download otherwise.
 *
 * The `Set-Cookie` fallback below exists only so a client built against an older
 * API build still finds a credential; the cookie value is the same token, so it
 * works as a bearer token unchanged.
 */

/** Cookie name the Express server reads in `requireAuth`. */
const SESSION_COOKIE_NAME = "app_session";

const BEARER_PREFIX = "bearer:";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface RequestOptions {
  method?: HttpMethod;
  /** Serialised as JSON. Mutually exclusive with `form`. */
  body?: unknown;
  /** Multipart payload. `Content-Type` is left to the platform so the boundary is correct. */
  form?: FormData;
  query?: Record<string, string | number | boolean | undefined | null>;
  timeoutMs?: number;
  /** Caller-owned cancellation, combined with the internal timeout. */
  signal?: AbortSignal;
  /** Skip the credential entirely (login). */
  anonymous?: boolean;
  /** Suppress the global sign-out on 401 (login, and probes that expect 401). */
  ignoreUnauthorized?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Injected collaborators (kept as hooks to avoid import cycles)               */
/* -------------------------------------------------------------------------- */

type NetworkProbe = () => boolean | null;
let networkProbe: NetworkProbe = () => null;

/** Wired to NetInfo by the query layer so "offline" and "server down" read differently. */
export function setNetworkProbe(probe: NetworkProbe): void {
  networkProbe = probe;
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Registered once by the auth provider: clear the credential and return to login. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

/* -------------------------------------------------------------------------- */
/* Credential encoding                                                         */
/* -------------------------------------------------------------------------- */

export function encodeBearerCredential(token: string): string {
  return `${BEARER_PREFIX}${token}`;
}

function decodeCredential(raw: string | null): string | null {
  if (raw === null) return null;
  return raw.startsWith(BEARER_PREFIX) ? raw.slice(BEARER_PREFIX.length) : raw;
}

/**
 * Auth headers for the current credential.
 *
 * Every request carries this, including image and file loads.
 */
export function authHeaders(raw: string | null = getSessionToken()): Record<string, string> {
  const token = decodeCredential(raw);
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/**
 * Source object for `expo-image` / `Image` when loading an authenticated file.
 * Native image loaders do not share the RN cookie jar, so the credential has to
 * be passed explicitly.
 */
export function authorizedSource(pathOrUrl: string): { uri: string; headers: Record<string, string> } {
  return { uri: apiUrl(pathOrUrl), headers: authHeaders() };
}

/* -------------------------------------------------------------------------- */
/* Response parsing                                                            */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(source: unknown, key: string): string | undefined {
  if (!isRecord(source)) return undefined;
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** `Retry-After` is either delta-seconds or an HTTP date. Both are handled. */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function buildQuery(query: RequestOptions["query"]): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.append(key, String(value));
  }
  const serialised = params.toString();
  return serialised ? `?${serialised}` : "";
}

/**
 * Extracts the session credential from a login response.
 *
 * `token` is the documented and current behaviour. The `Set-Cookie` path is a
 * fallback for an older API build — the cookie value is the same session token,
 * so it is used as a bearer token unchanged. If neither is present the session
 * would be unusable, so this fails loudly rather than half-signing-in.
 */
export function extractSessionCredential(response: Response, body: unknown): string {
  const explicit = stringField(body, "token");
  if (explicit) return encodeBearerCredential(explicit);

  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    const match = new RegExp(`${SESSION_COOKIE_NAME}=([^;,\\s]+)`).exec(setCookie);
    const value = match?.[1];
    if (value) return encodeBearerCredential(decodeURIComponent(value));
  }

  throw new ApiError({
    kind: "server",
    message: "Sign in succeeded but the server did not return a session token.",
  });
}

/* -------------------------------------------------------------------------- */
/* Core request                                                                */
/* -------------------------------------------------------------------------- */

export interface RawResult<T> {
  data: T;
  response: Response;
}

/**
 * Performs the request and returns both the parsed body and the raw response.
 * Only login needs the raw response (to read `Set-Cookie`); everything else uses
 * `apiRequest`.
 */
export async function apiRequestRaw<T>(path: string, options: RequestOptions = {}): Promise<RawResult<T>> {
  if (!API_BASE_URL) {
    throw new ApiError({
      kind: "misconfigured",
      message: "No API base URL. Set EXPO_PUBLIC_API_BASE_URL and reload.",
    });
  }

  const {
    method = "GET",
    body,
    form,
    query,
    timeoutMs = form ? TIMEOUTS.upload : TIMEOUTS.default,
    signal,
    anonymous = false,
    ignoreUnauthorized = false,
  } = options;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (!anonymous) {
    Object.assign(headers, authHeaders());
  }
  if (body !== undefined && !form) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(`${apiUrl(path)}${buildQuery(query)}`, {
      method,
      headers,
      // Multipart: never set Content-Type by hand or the boundary is lost.
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw new ApiError({ kind: "timeout", message: `Request to ${path} timed out.`, cause: error });
    }
    if (signal?.aborted) {
      // Caller-initiated cancellation: propagate so TanStack Query treats it as
      // a cancellation rather than a failure.
      throw error;
    }
    const online = networkProbe();
    throw new ApiError({
      kind: online === false ? "offline" : "unreachable",
      message: online === false ? "No network connection." : `Could not reach ${API_BASE_URL}.`,
      cause: error,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }

  const raw = await response.text();
  let parsed: unknown = null;
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      // A non-JSON body from an error page or proxy. Keep the text for the message.
      parsed = null;
    }
  }

  if (!response.ok) {
    const code = stringField(parsed, "code");
    const kind = kindFromStatus(response.status, code);
    const message =
      stringField(parsed, "error") ??
      stringField(parsed, "message") ??
      (raw.length > 0 && raw.length < 200 ? raw : `Request failed with status ${response.status}.`);

    if ((kind === "unauthorized" || kind === "schoolSessionExpired") && !ignoreUnauthorized) {
      unauthorizedHandler?.();
    }

    throw new ApiError({
      kind,
      message,
      status: response.status,
      code,
      retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
    });
  }

  // The single boundary cast in the app: a validated 2xx JSON body is trusted to
  // match the endpoint's declared response type.
  return { data: parsed as T, response };
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { data } = await apiRequestRaw<T>(path, options);
  return data;
}

/**
 * Appends a device file to a FormData in the shape React Native expects.
 *
 * RN's FormData accepts `{ uri, name, type }`, which the DOM `FormData` type does
 * not describe. This narrow structural cast keeps that fact in one function
 * instead of leaking `any` into feature code.
 */
export function appendFile(form: FormData, field: string, file: { uri: string; name: string; type: string }): void {
  const rnForm = form as unknown as {
    append(name: string, value: { uri: string; name: string; type: string }, fileName?: string): void;
  };
  rnForm.append(field, { uri: file.uri, name: file.name, type: file.type }, file.name);
}
