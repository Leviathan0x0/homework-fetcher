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

// The SDK (browser tracing + session replay) is far too heavy to sit in the
// entry chunk: loading it with a dynamic import() keeps it in its own async
// chunk, and when Sentry is disabled the chunk is never fetched at all.
let sentryLoader: Promise<typeof import("@sentry/react")> | null = null;

function loadSentry(): Promise<typeof import("@sentry/react")> | null {
  if (!enabled) return null;
  if (!sentryLoader) {
    sentryLoader = import("@sentry/react").then((Sentry) => {
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
            mask: ['input[type="password"]'],
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
      return Sentry;
    });
  }
  return sentryLoader;
}

// Kick the import off at startup (no-op when disabled) so the SDK is ready
// shortly after boot without blocking or inflating the entry bundle.
loadSentry();

export function reportClientError(error: Error, componentStack?: string) {
  const loader = loadSentry();
  if (!loader) return;
  loader
    .then((Sentry) => {
      Sentry.captureException(
        error,
        componentStack ? { contexts: { react: { componentStack } } } : undefined,
      );
    })
    .catch(() => {
      // Reporting is best-effort; never let a failed SDK load surface.
    });
}
