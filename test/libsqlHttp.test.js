const test = require("node:test");
const assert = require("node:assert/strict");
const { createLibsqlClient } = require("../server/db/libsqlHttp");

function jsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

test("executeBatch sends every statement in one HTTP request", async () => {
  const calls = [];
  const client = createLibsqlClient("libsql://example.turso.io", "token", {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        results: [
          {
            type: "ok",
            response: {
              type: "execute",
              result: {
                cols: [{ name: "value" }],
                rows: [[{ type: "integer", value: "1" }]],
                affected_row_count: 0,
              },
            },
          },
          {
            type: "ok",
            response: {
              type: "execute",
              result: {
                cols: [],
                rows: [],
                affected_row_count: 1,
              },
            },
          },
          { type: "ok", response: { type: "close" } },
        ],
      });
    },
  });

  const results = await client.executeBatch([
    { sql: "SELECT ?", args: [1] },
    { sql: "UPDATE users SET updated_at = ?", args: ["now"] },
  ]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.turso.io/v2/pipeline");
  assert.equal(calls[0].init.headers.Authorization, "Bearer token");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.requests.length, 3);
  assert.equal(body.requests[2].type, "close");
  assert.deepEqual(results[0].rows, [[1]]);
  assert.equal(results[1].rowsAffected, 1);
});

test("executeBatch aborts a stalled database request", async () => {
  const client = createLibsqlClient("https://example.turso.io", "", {
    timeoutMs: 10,
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          {
            once: true,
          },
        );
      }),
  });

  await assert.rejects(
    client.execute("SELECT 1"),
    (err) => err.code === "DATABASE_TIMEOUT",
  );
});

test("executeBatch times out when the response body stalls", async () => {
  const client = createLibsqlClient("https://example.turso.io", "", {
    timeoutMs: 10,
    fetchImpl: async (_url, init) => ({
      ok: true,
      json: () =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    }),
  });

  await assert.rejects(
    client.execute("SELECT 1"),
    (err) => err.code === "DATABASE_TIMEOUT",
  );
});
