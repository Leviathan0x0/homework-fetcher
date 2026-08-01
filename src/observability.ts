type DatadogRum = {
  addError: (error: unknown, context?: Record<string, unknown>) => void;
  init: (configuration: Record<string, unknown>) => void;
};

type DatadogLogs = {
  init: (configuration: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    DD_LOGS?: DatadogLogs;
    DD_RUM?: DatadogRum;
  }
}

const env =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> })
    .env || {};
const rumEnabled = env.VITE_DATADOG_RUM_ENABLED === "true";
const applicationId = env.VITE_DATADOG_APPLICATION_ID;
const clientToken = env.VITE_DATADOG_CLIENT_TOKEN;
const site = env.VITE_DATADOG_SITE || "datadoghq.com";
const service = env.VITE_DATADOG_SERVICE || "homework-fetcher-web";
const deploymentEnv = env.VITE_DATADOG_ENV || env.MODE || "development";

function browserAgentRegion() {
  if (site === "datadoghq.eu") return "eu";
  if (site.startsWith("us3.")) return "us3";
  if (site.startsWith("us5.")) return "us5";
  if (site.startsWith("ap1.")) return "ap1";
  return "us1";
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Unable to load ${src}`));
    document.head.appendChild(script);
  });
}

function tracingOrigins() {
  const apiOrigin = env.VITE_API_BASE_URL
    ? new URL(env.VITE_API_BASE_URL, window.location.origin).origin
    : window.location.origin;
  return [...new Set([window.location.origin, apiOrigin])];
}

export async function initializeObservability() {
  if (!rumEnabled || !applicationId || !clientToken) return;

  const agentBaseUrl = `https://www.datadoghq-browser-agent.com/${browserAgentRegion()}/v6`;

  try {
    await loadScript(`${agentBaseUrl}/datadog-rum.js`);
    window.DD_RUM?.init({
      applicationId,
      clientToken,
      site,
      service,
      env: deploymentEnv,
      version: env.VITE_DATADOG_VERSION,
      sessionSampleRate: 100,
      sessionReplaySampleRate: 0,
      traceSampleRate: 100,
      trackResources: true,
      trackLongTasks: true,
      trackUserInteractions: true,
      defaultPrivacyLevel: "mask-user-input",
      allowedTracingUrls: tracingOrigins(),
    });

    if (env.VITE_DATADOG_LOGS_ENABLED === "true") {
      await loadScript(`${agentBaseUrl}/datadog-logs.js`);
      window.DD_LOGS?.init({
        clientToken,
        site,
        service,
        env: deploymentEnv,
        version: env.VITE_DATADOG_VERSION,
        forwardErrorsToLogs: true,
        forwardConsoleLogs: [],
        forwardReports: "all",
      });
    }
  } catch (error) {
    console.warn(
      "[observability] Datadog browser monitoring could not start.",
      error,
    );
  }
}

export function reportUiError(error: Error, componentStack?: string) {
  window.DD_RUM?.addError(
    error,
    componentStack ? { component_stack: componentStack } : undefined,
  );
}
