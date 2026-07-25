/**
 * Error mapping. One vocabulary for every failure the app can hit, so screens
 * branch on `kind` instead of re-parsing status codes.
 */
export type ApiErrorKind =
  | "offline"
  /** Device has a connection but the API host did not answer. */
  | "unreachable"
  | "timeout"
  | "misconfigured"
  | "unauthorized"
  | "schoolSessionExpired"
  | "invalidCredentials"
  | "portalUnreachable"
  | "forbidden"
  | "notFound"
  | "validation"
  | "tooLarge"
  | "rateLimited"
  | "server"
  | "unknown";

export interface ApiErrorOptions {
  kind: ApiErrorKind;
  message: string;
  status?: number;
  /** Machine-readable code from the server body, e.g. `SCHOOL_SESSION_EXPIRED`. */
  code?: string;
  /** Parsed from the `Retry-After` header on a 429. */
  retryAfterSeconds?: number;
  cause?: unknown;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly retryAfterSeconds?: number;

  constructor(options: ApiErrorOptions) {
    super(options.message);
    this.name = "ApiError";
    this.kind = options.kind;
    this.status = options.status;
    this.code = options.code;
    this.retryAfterSeconds = options.retryAfterSeconds;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** True when the credential is gone or rejected and the user must sign in again. */
export function isAuthFailure(value: unknown): boolean {
  return isApiError(value) && (value.kind === "unauthorized" || value.kind === "schoolSessionExpired");
}

/**
 * Maps an HTTP status (plus any server `code`) to a `kind`.
 *
 * `SCHOOL_SESSION_EXPIRED` is separated from a plain 401 on purpose: the app
 * session is still valid, it is the upstream school portal that needs a fresh
 * login, and the copy has to say so.
 */
export function kindFromStatus(status: number, code?: string): ApiErrorKind {
  if (code === "SCHOOL_SESSION_EXPIRED") return "schoolSessionExpired";
  switch (status) {
    case 400:
      return "validation";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "notFound";
    case 413:
      return "tooLarge";
    case 429:
      return "rateLimited";
    case 502:
    case 503:
    case 504:
      return "portalUnreachable";
    default:
      return status >= 500 ? "server" : "unknown";
  }
}

export interface DescribedError {
  kind: ApiErrorKind;
  title: string;
  detail: string;
  /** Whether offering a retry button makes sense. */
  canRetry: boolean;
}

/**
 * Human copy for any thrown value. Calm and specific — never "Something went
 * wrong", never a raw stack trace.
 */
export function describeApiError(error: unknown): DescribedError {
  if (!isApiError(error)) {
    const message = error instanceof Error ? error.message : "An unexpected error occurred.";
    return { kind: "unknown", title: "Something didn't load", detail: message, canRetry: true };
  }

  switch (error.kind) {
    case "offline":
      return {
        kind: error.kind,
        title: "You're offline",
        detail: "Reconnect to load the latest. Anything already saved is still available.",
        canRetry: true,
      };
    case "unreachable":
      return {
        kind: error.kind,
        title: "Can't reach the server",
        detail:
          "Your connection is fine but the API didn't respond. Check that it's running and that the address is right.",
        canRetry: true,
      };
    case "timeout":
      return {
        kind: error.kind,
        title: "That took too long",
        detail: "The server didn't answer in time. It may be busy — try again.",
        canRetry: true,
      };
    case "misconfigured":
      return {
        kind: error.kind,
        title: "API not configured",
        detail: "Set EXPO_PUBLIC_API_BASE_URL to your API address, then reload the app.",
        canRetry: false,
      };
    case "invalidCredentials":
      return {
        kind: error.kind,
        title: "Incorrect details",
        detail: "That student ID and password combination wasn't accepted. Check both and try again.",
        canRetry: false,
      };
    case "portalUnreachable":
      return {
        kind: error.kind,
        title: "School portal unreachable",
        detail:
          error.message ||
          "The school portal isn't responding right now. This isn't your password — try again in a few minutes.",
        canRetry: true,
      };
    case "schoolSessionExpired":
      return {
        kind: error.kind,
        title: "School session expired",
        detail: "Sign in again to reconnect to the school portal.",
        canRetry: false,
      };
    case "unauthorized":
      return {
        kind: error.kind,
        title: "Signed out",
        detail: "Your session ended. Sign in again to continue.",
        canRetry: false,
      };
    case "forbidden":
      return {
        kind: error.kind,
        title: "Not allowed",
        detail: error.message || "You don't have access to this.",
        canRetry: false,
      };
    case "notFound":
      return {
        kind: error.kind,
        title: "Not found",
        detail: error.message || "This item no longer exists.",
        canRetry: false,
      };
    case "tooLarge":
      return {
        kind: error.kind,
        title: "File too large",
        detail: error.message || "Uploads are limited to 4 MB.",
        canRetry: false,
      };
    case "rateLimited": {
      const wait = error.retryAfterSeconds;
      return {
        kind: error.kind,
        title: "Slow down a moment",
        detail: wait
          ? `You've sent a lot in a short time. Try again in ${wait} second${wait === 1 ? "" : "s"}.`
          : "You've sent a lot in a short time. Try again shortly.",
        canRetry: false,
      };
    }
    case "validation":
      return {
        kind: error.kind,
        title: "Check that again",
        detail: error.message || "The server rejected that input.",
        canRetry: false,
      };
    case "server":
      return {
        kind: error.kind,
        title: "Server error",
        detail: "The server hit a problem handling that. Trying again usually works.",
        canRetry: true,
      };
    case "unknown":
    default:
      return {
        kind: "unknown",
        title: "Something didn't load",
        detail: error.message || "An unexpected error occurred.",
        canRetry: true,
      };
  }
}

/** Short, single-line copy for inline placement (composer, banner). */
export function inlineErrorMessage(error: unknown): string {
  const described = describeApiError(error);
  return described.kind === "rateLimited" || described.kind === "offline" ? described.detail : described.title;
}
