/**
 * Minimal libSQL (Turso) HTTP client built on fetch.
 *
 * Serverless platforms such as Vercel give every deployment (and every
 * instance) a fresh, read-only filesystem, so a local SQLite file cannot be
 * used as the shared source of truth: data disappears on redeploy and two
 * users can end up talking to two different copies of the database.
 * Pointing TURSO_DATABASE_URL at a hosted libSQL database makes every instance
 * read and write the same data.
 *
 * The libSQL "pipeline" endpoint is plain HTTPS + JSON, so no extra dependency
 * is required.
 */

/** Converts a libSQL "libsql://" URL into its HTTPS endpoint. */
function toHttpUrl(rawUrl) {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  if (trimmed.startsWith("libsql://")) return `https://${trimmed.slice("libsql://".length)}`;
  if (trimmed.startsWith("wss://")) return `https://${trimmed.slice("wss://".length)}`;
  if (trimmed.startsWith("ws://")) return `http://${trimmed.slice("ws://".length)}`;
  return trimmed;
}

/** Encodes a JavaScript value as a libSQL protocol value. */
function encodeValue(value) {
  if (value === null || value === undefined) return { type: "null" };
  if (typeof value === "boolean") return { type: "integer", value: value ? "1" : "0" };
  if (typeof value === "bigint") return { type: "integer", value: value.toString() };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { type: "integer", value: String(value) }
      : { type: "float", value };
  }
  if (Buffer.isBuffer(value)) return { type: "blob", base64: value.toString("base64") };
  if (value instanceof Uint8Array) return { type: "blob", base64: Buffer.from(value).toString("base64") };
  if (typeof value === "object") return { type: "text", value: JSON.stringify(value) };
  return { type: "text", value: String(value) };
}

/** Decodes a libSQL protocol value into a JavaScript value. */
function decodeValue(cell) {
  if (!cell || cell.type === "null") return null;
  switch (cell.type) {
    case "integer": {
      const asNumber = Number(cell.value);
      return Number.isSafeInteger(asNumber) ? asNumber : cell.value;
    }
    case "float":
      return Number(cell.value);
    case "blob":
      return Buffer.from(cell.base64 || "", "base64");
    default:
      return cell.value === undefined ? null : String(cell.value);
  }
}

/**
 * Creates a libSQL HTTP client.
 * @param {string} url libsql:// or https:// database URL
 * @param {string} [authToken]
 */
function createLibsqlClient(url, authToken) {
  const endpoint = `${toHttpUrl(url)}/v2/pipeline`;
  const maxAttempts = 3;
  const defaultTimeoutMs = 2_500;

  const wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

  async function postPipeline(requests, requestTimeoutMs = defaultTimeoutMs) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ requests }),
          signal: controller.signal,
        });

        if (res.ok) return res;

        const detail = await res.text().catch(() => "");
        const error = new Error(`libSQL request failed with ${res.status}: ${detail.slice(0, 300)}`);
        const retryable = res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500;
        if (!retryable) throw error;
        lastError = error;
      } catch (err) {
        if (err?.message?.startsWith("libSQL request failed with 4")) throw err;
        lastError = err?.name === "AbortError"
          ? new Error(`libSQL request timed out after ${requestTimeoutMs}ms`)
          : err;
      } finally {
        clearTimeout(timeout);
      }

      if (attempt < maxAttempts) {
        await wait(150 * attempt);
      }
    }

    throw new Error(
      `Could not reach the hosted database after ${maxAttempts} attempts: ${lastError?.message || "unknown transport error"}`
    );
  }

  /**
   * Executes one or more statements in a single round trip.
   *
   * @param {{sql: string, args?: any[]}[]} statements
   * @param {{timeoutMs?: number, throwOnError?: boolean}} [options]
   *   `throwOnError: false` reports a failed statement as `{ error }` in its
   *   slot instead of rejecting, so a batch of independent best-effort
   *   statements (migrations, seeds) still costs a single round trip.
   * @returns {Promise<{columns: string[], rows: any[][], rowsAffected: number, error?: string}[]>}
   */
  async function executeBatch(statements, options = {}) {
    const { timeoutMs, throwOnError = true } = options;
    const requests = statements.map((statement) => ({
      type: "execute",
      stmt: {
        sql: statement.sql,
        args: (statement.args || []).map(encodeValue),
      },
    }));
    requests.push({ type: "close" });

    const res = await postPipeline(requests, timeoutMs);

    const payload = await res.json();
    const results = [];
    for (const entry of payload.results || []) {
      if (entry.type === "error") {
        const message = entry.error?.message || "unknown error";
        if (throwOnError) throw new Error(`libSQL error: ${message}`);
        results.push({ columns: [], rows: [], rowsAffected: 0, error: message });
        continue;
      }
      if (entry.response?.type !== "execute") continue;
      const result = entry.response.result || {};
      results.push({
        columns: (result.cols || []).map((col) => col.name),
        rows: (result.rows || []).map((row) => row.map(decodeValue)),
        rowsAffected: result.affected_row_count || 0,
      });
    }
    return results;
  }

  /**
   * Executes a single statement.
   * @param {string} sql
   * @param {any[]} [args]
   * @param {{timeoutMs?: number}} [options]
   */
  async function execute(sql, args, options) {
    const [result] = await executeBatch([{ sql, args }], options);
    return result || { columns: [], rows: [], rowsAffected: 0 };
  }

  return { execute, executeBatch, endpoint };
}

module.exports = { createLibsqlClient, toHttpUrl };
