const enabled =
  process.env.SENTRY_ENABLED === "true" && Boolean(process.env.SENTRY_DSN);
let Sentry;

function sampleRate(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.1;
}

function scrubEvent(event) {
  delete event.user;

  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.headers;
  }

  return event;
}

if (enabled) {
  Sentry = require("@sentry/node");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment:
      process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE,
    sendDefaultPii: false,
    tracesSampleRate: sampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE),
    beforeSend: scrubEvent,
  });
}

function setupExpressErrorHandler(app) {
  if (Sentry) Sentry.setupExpressErrorHandler(app);
}

module.exports = { setupExpressErrorHandler };
