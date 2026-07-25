import { QueryClient } from "@tanstack/react-query";

import { isApiError } from "../api/errors";

/**
 * Failures that will never succeed on retry. Retrying them just delays the error
 * the user needs to see — and for `rateLimited`, actively makes things worse.
 */
const NON_RETRYABLE = new Set([
  "unauthorized",
  "schoolSessionExpired",
  "invalidCredentials",
  "forbidden",
  "notFound",
  "validation",
  "tooLarge",
  "rateLimited",
  "misconfigured",
]);

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (isApiError(error)) return !NON_RETRYABLE.has(error.kind);
  return true;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
        staleTime: 30_000,
        // Long enough that a cached list survives a background/foreground cycle
        // and is still there to hydrate from disk on the next launch.
        gcTime: 1000 * 60 * 60 * 24 * 7,
        // Polling must not continue while the app is backgrounded. This is the
        // default, restated because the requirement is explicit.
        refetchIntervalInBackground: false,
        refetchOnReconnect: true,
        refetchOnMount: true,
      },
      mutations: {
        // Mutations are user-initiated and mostly optimistic; a silent retry would
        // risk duplicate sends. Failures roll back and surface inline instead.
        retry: false,
      },
    },
  });
}
