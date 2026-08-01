const enabled =
  process.env.DD_TRACE_ENABLED !== "false" &&
  process.env.NODE_ENV === "production";

if (enabled) {
  try {
    require("dd-trace").init({
      env: process.env.DD_ENV || process.env.NODE_ENV,
      service: process.env.DD_SERVICE || "homework-fetcher",
      version: process.env.DD_VERSION,
      logInjection: true,
      runtimeMetrics: process.env.DD_RUNTIME_METRICS_ENABLED !== "false",
      profiling: process.env.DD_PROFILING_ENABLED === "true",
    });
  } catch (error) {
    console.error(
      "[observability] Datadog tracing could not start:",
      error.message,
    );
  }
}

function apiRequestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log(
      JSON.stringify({
        event: "api.request",
        method: req.method,
        route: req.baseUrl || "/api",
        status_code: res.statusCode,
        duration_ms: Number(durationMs.toFixed(2)),
      }),
    );
  });

  next();
}

module.exports = { apiRequestLogger };
