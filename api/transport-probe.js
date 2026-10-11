/**
 * TEMPORARY diagnostic endpoint: measures real Vercel -> Turso transport cost.
 *
 * This is deliberately a standalone serverless function rather than a route on
 * the Express app. server.js requires server/db/client.js, whose module scope
 * runs initDb(); mounting a route there would run the schema migration and
 * block on ensureDatabaseReady(), which is exactly what this probe must not do.
 *
 * Isolated container guarantees:
 *   - no initDb(), no schema migration
 *   - no application tables touched
 *   - no EduSecure, no AI, no homework refresh code
 *   - SELECT 1 only, which cannot modify the database
 *   - the same createLibsqlClient() transport, timeout and retry policy as prod
 *
 * Enabled only when TRANSPORT_PROBE_TOKEN is set, and gated on a matching
 * header so it is not a public DB-pinging endpoint.
 */

const { createLibsqlClient } = require("../server/db/libsqlHttp");

const PROBE_SQL = "SELECT 1";
const DEFAULT_SAMPLES = 5;
const MAX_SAMPLES = 20;
const GAP_MS = 250;

/** Reads the same environment variables client.js reads, without importing it. */
function remoteConfig() {
  const raw = (process.env.DATABASE_URL || "").trim();
  const isRemote = /^(libsql|wss?|https?):\/\//i.test(raw);
  const url = (
    process.env.TURSO_DATABASE_URL ||
    process.env.LIBSQL_URL ||
    (isRemote ? raw : "")
  ).trim();
  const authToken = (process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || "").trim();
  return { url, authToken };
}

/**
 * Times each underlying fetch without editing libsqlHttp.js.
 *
 * Wrapping fetch (rather than changing the client) separates the two failure
 * modes the client cannot distinguish on its own:
 *   headersAt  -> when fetch() resolved (server began responding)
 *   bodyAt     -> when the response body was fully read
 * A large gap between them means the stall is the response body; both large
 * means the request never got a response.
 *
 * Restored in a finally block so a failed probe cannot leave fetch patched.
 */
async function withFetchTracing(fn) {
  const originalFetch = globalThis.fetch;
  const attempts = [];

  globalThis.fetch = async function tracedFetch(...args) {
    const startedAt = process.hrtime.bigint();
    const record = { headersMs: null, bodyMs: null };
    attempts.push(record);
    try {
      const res = await originalFetch.apply(this, args);
      record.headersMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const originalJson = res.json.bind(res);
      res.json = async (...jsonArgs) => {
        try {
          return await originalJson(...jsonArgs);
        } finally {
          record.bodyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        }
      };
      return res;
    } catch (err) {
      record.headersMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      throw err;
    }
  };

  try {
    return { value: await fn(), attempts };
  } catch (err) {
    // Attach the trace so the caller can report per-attempt timing on failure.
    if (err && typeof err === "object") err.__attempts = attempts;
    throw err;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function classify(err) {
  const message = String(err?.message || "");
  if (/timed out after \d+ms/.test(message)) return "client_timeout";
  if (/Could not reach the hosted database/.test(message)) return "retries_exhausted";
  if (/fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|ECONNREFUSED/.test(message)) return "transport_error";
  if (/libSQL error/.test(message)) return "server_sql_error";
  return "other";
}

function round(value) {
  return value === null ? null : Math.round(value * 10) / 10;
}

module.exports = async function transportProbe(req, res) {
  const expected = process.env.TRANSPORT_PROBE_TOKEN;
  if (!expected) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  if (req.headers["x-probe-token"] !== expected) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  const { url, authToken } = remoteConfig();
  if (!url) {
    res.status(500).json({ ok: false, error: "TURSO_DATABASE_URL is not configured." });
    return;
  }

  const requested = Number.parseInt(req.query?.n, 10);
  const samples = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 1), MAX_SAMPLES)
    : DEFAULT_SAMPLES;

  // The production client, unmodified.
  const client = createLibsqlClient(url, authToken);
  const results = [];

  for (let i = 0; i < samples; i += 1) {
    if (i > 0) await new Promise((r) => setTimeout(r, GAP_MS));
    const startedAt = process.hrtime.bigint();
    try {
      const { value, attempts } = await withFetchTracing(() =>
        client.executeBatch([{ sql: PROBE_SQL }])
      );
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      results.push({
        ok: true,
        totalMs: round(elapsedMs),
        attempts: attempts.length,
        // Per-attempt shape of a successful call.
        perAttemptMs: attempts.map((a) => round(a.headersMs)),
        returnedRows: value?.[0]?.rows?.length ?? null,
      });
    } catch (err) {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      results.push({
        ok: false,
        totalMs: round(elapsedMs),
        classification: classify(err),
        // headersMs large + bodyMs null => stalled before/while awaiting a
        // response. headersMs small + bodyMs large => response body hung.
        error: String(err?.message || "unknown error").slice(0, 300),
        // Per-attempt header wait. ~2500 on every attempt means the request
        // never got a response; small values with a large total means the
        // response body hung instead.
        perAttemptMs: (err?.__attempts || []).map((a) => round(a.headersMs)),
      });
    }
  }

  const durations = results.map((r) => r.totalMs).sort((a, b) => a - b);
  const okCount = results.filter((r) => r.ok).length;

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    ok: okCount === samples,
    region: process.env.VERCEL_REGION || process.env.AWS_REGION || "unknown",
    runtime: process.env.NODE_VERSION || process.version,
    // Endpoint host only. Never the token, never the full URL with credentials.
    databaseHost: (() => {
      try {
        return new URL(url.replace(/^libsql:\/\//, "https://")).host;
      } catch {
        return "unparseable";
      }
    })(),
    samples,
    succeeded: okCount,
    failed: samples - okCount,
    minMs: round(durations[0]),
    medianMs: round(durations[Math.floor(durations.length / 2)]),
    maxMs: round(durations[durations.length - 1]),
    results,
  });
};
