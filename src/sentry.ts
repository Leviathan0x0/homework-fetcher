import * as Sentry from "@sentry/react";

const env =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> })
    .env || {};

function sampleRate(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.1;
}

function apiOrigins() {
  const apiOrigin = env.VITE_API_BASE_URL
    ? new URL(env.VITE_API_BASE_URL, window.location.origin).origin
    : window.location.origin;
  return [...new Set([window.location.origin, apiOrigin])];
}

const enabled =
  env.VITE_SENTRY_ENABLED === "true" && Boolean(env.VITE_SENTRY_DSN);

if (enabled) {
  Sentry.init({
    dsn: env.VITE_SENTRY_DSN,
    environment: env.VITE_SENTRY_ENVIRONMENT || env.MODE || "development",
    release: env.VITE_SENTRY_RELEASE,
    sendDefaultPii: false,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        maskAllInputs: false,
        blockAllMedia: true,
      }),
    ],
    tracesSampleRate: sampleRate(env.VITE_SENTRY_TRACES_SAMPLE_RATE),
    tracePropagationTargets: apiOrigins(),
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    beforeSend(event) {
      delete event.user;

      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        delete event.request.headers;
      }

      return event;
    },
  });
}

export function reportClientError(error: Error, componentStack?: string) {
  if (!enabled) return;
  Sentry.captureException(
    error,
    componentStack ? { contexts: { react: { componentStack } } } : undefined,
  );
}
