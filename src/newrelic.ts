import { Agent } from "@newrelic/browser-agent/loaders/agent";
import { Ajax } from "@newrelic/browser-agent/features/ajax";
import { GenericEvents } from "@newrelic/browser-agent/features/generic_events";
import { JSErrors } from "@newrelic/browser-agent/features/jserrors";
import { Logging } from "@newrelic/browser-agent/features/logging";
import { Metrics } from "@newrelic/browser-agent/features/metrics";
import { PageViewEvent } from "@newrelic/browser-agent/features/page_view_event";
import { PageViewTiming } from "@newrelic/browser-agent/features/page_view_timing";
import { SessionTrace } from "@newrelic/browser-agent/features/session_trace";
import { SoftNav } from "@newrelic/browser-agent/features/soft_navigations";

const env =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> })
    .env || {};
const enabled = env.VITE_NEW_RELIC_ENABLED === "true";
const licenseKey = env.VITE_NEW_RELIC_BROWSER_LICENSE_KEY;
const applicationID = env.VITE_NEW_RELIC_APPLICATION_ID;

function apiOrigins() {
  const apiOrigin = env.VITE_API_BASE_URL
    ? new URL(env.VITE_API_BASE_URL, window.location.origin).origin
    : window.location.origin;
  return [...new Set([window.location.origin, apiOrigin])];
}

function compact<T extends Record<string, string | undefined>>(values: T) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => Boolean(value)),
  );
}

const browserAgent =
  enabled && licenseKey && applicationID
    ? new Agent({
        init: {
          distributed_tracing: {
            enabled: true,
            allowed_origins: apiOrigins(),
          },
          performance: {
            resources: {
              enabled: true,
            },
          },
          session_replay: {
            enabled: false,
          },
        },
        info: compact({
          beacon: env.VITE_NEW_RELIC_BEACON,
          errorBeacon: env.VITE_NEW_RELIC_ERROR_BEACON,
          licenseKey,
          applicationID,
        }) as { applicationID: string; licenseKey: string },
        loader_config: compact({
          accountID: env.VITE_NEW_RELIC_ACCOUNT_ID,
          agentID: env.VITE_NEW_RELIC_AGENT_ID,
          trustKey: env.VITE_NEW_RELIC_TRUST_KEY,
        }),
        features: [
          Ajax,
          GenericEvents,
          JSErrors,
          Logging,
          Metrics,
          PageViewEvent,
          PageViewTiming,
          SessionTrace,
          SoftNav,
        ],
      })
    : undefined;

export function reportClientError(error: Error, componentStack?: string) {
  browserAgent?.noticeError(
    error,
    componentStack ? { componentStack } : undefined,
  );
}
