const { AsyncLocalStorage } = require("node:async_hooks");

const requestTimings = new AsyncLocalStorage();

function elapsedMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function roundedMs(value) {
  return Math.round(value * 10) / 10;
}

function timingToken(value) {
  return String(value || "operation")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "operation";
}

function serverTimingValue(timings) {
  return timings
    .map(({ name, durationMs }) => `${timingToken(name)};dur=${roundedMs(durationMs)}`)
    .join(", ");
}

function logTiming(context, timings, { background = false } = {}) {
  console.info(`[performance] ${JSON.stringify({
    method: context.method,
    path: context.path,
    status: context.status,
    background,
    timings: timings.map(({ name, durationMs }) => ({
      name,
      durationMs: roundedMs(durationMs),
    })),
  })}`);
}

function shouldLogRequest(timings) {
  if (process.env.PERFORMANCE_TIMING_LOG_ALL === "true") return true;
  return timings.some(({ name, durationMs }) =>
    name !== "total" &&
    (name !== "database_ready" || durationMs >= 250)
  ) || timings.some(({ name, durationMs }) => name === "total" && durationMs >= 250);
}

/**
 * Captures exact server-side time spent in external systems for one API request.
 * The values are emitted both as a standard Server-Timing response header and
 * as structured logs that can be aggregated by the hosting provider.
 */
function requestTimingMiddleware(req, res, next) {
  const context = {
    method: req.method,
    path: String(req.originalUrl || req.url || "").split("?")[0],
    status: 200,
    timings: [],
    finished: false,
    startedAt: process.hrtime.bigint(),
  };
  const originalEnd = res.end;

  res.end = function timedEnd(...args) {
    if (!context.finished) {
      context.finished = true;
      context.status = res.statusCode;
      const finalTimings = [
        ...context.timings,
        { name: "total", durationMs: elapsedMs(context.startedAt) },
      ];

      if (!res.headersSent) {
        res.setHeader("Server-Timing", serverTimingValue(finalTimings));
      }
      if (shouldLogRequest(finalTimings)) logTiming(context, finalTimings);
    }

    return originalEnd.apply(this, args);
  };

  requestTimings.run(context, next);
}

/**
 * Measures an async dependency call without changing its result or errors.
 * Calls made after a response (such as homework prefetch) remain attached to
 * their originating request and are logged separately as background work.
 */
async function measureRequestTiming(name, callback) {
  const context = requestTimings.getStore();
  if (!context) return callback();

  const startedAt = process.hrtime.bigint();
  try {
    return await callback();
  } finally {
    const timing = { name: timingToken(name), durationMs: elapsedMs(startedAt) };
    context.timings.push(timing);
    if (context.finished) logTiming(context, [timing], { background: true });
  }
}

module.exports = {
  measureRequestTiming,
  requestTimingMiddleware,
};
