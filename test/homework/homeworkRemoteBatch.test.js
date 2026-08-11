const assert = require("node:assert/strict");
const test = require("node:test");

process.env.TURSO_DATABASE_URL = "libsql://homework-round-trip.test";
process.env.TURSO_AUTH_TOKEN = "test-token";
delete process.env.LIBSQL_URL;
delete process.env.DATABASE_URL;

const originalFetch = global.fetch;
const pipelines = [];
let homeworkSelectRows = [];

function protocolValue(value) {
  if (value === null || value === undefined) return { type: "null" };
  if (typeof value === "number") return { type: "integer", value: String(value) };
  return { type: "text", value: String(value) };
}

global.fetch = async (_url, options) => {
  const payload = JSON.parse(options.body);
  pipelines.push(payload);
  const results = payload.requests.map((request) => {
    if (request.type === "close") {
      return { type: "ok", response: { type: "close" } };
    }
    const isHomeworkSelect = /\bfrom\s+"homework"/i.test(request.stmt.sql);
    return {
      type: "ok",
      response: {
        type: "execute",
        result: {
          cols: isHomeworkSelect
            ? ["id", "userId", "type", "date", "content", "subject", "attachmentUrl", "createdAt", "updatedAt", "completed", "note"]
                .map((name) => ({ name }))
            : [],
          rows: isHomeworkSelect
            ? homeworkSelectRows.map((row) => row.map(protocolValue))
            : [],
          affected_row_count: /^\s*select/i.test(request.stmt.sql) ? 0 : 1,
        },
      },
    };
  });
  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

const { db, ready } = require("../../server/db/client");
const homeworkCacheService = require("../../server/homework/homeworkCacheService");

test.after(() => {
  global.fetch = originalFetch;
});

test("remote upsert and duplicate cleanup stay in two requests without Drizzle batching", async () => {
  await ready;
  pipelines.length = 0;

  const originalBatch = db.batch;
  db.batch = undefined;
  try {
    const homework = await homeworkCacheService.upsertHomework("remote-user", [
      {
        type: "Homework",
        date: "11 Aug 2026",
        homework: "MATHEMATICS: Complete exercise 8",
        attachment: null,
      },
      {
        type: "Homework",
        date: "11 Aug 2026",
        homework: "SCIENCE: Read chapter 3",
        attachment: null,
      },
    ]);
    assert.equal(homework.length, 2);
  } finally {
    db.batch = originalBatch;
  }

  assert.equal(pipelines.length, 2, "one joined read and one write pipeline are expected");
  const executions = pipelines.map((pipeline) =>
    pipeline.requests.filter((request) => request.type === "execute")
  );
  assert.equal(executions[0].length, 1);
  assert.match(executions[0][0].stmt.sql, /^select\b/i);
  assert.equal(executions[1].length, 2);
  assert.ok(executions[1].every((request) => /^insert\b/i.test(request.stmt.sql)));

  const now = new Date().toISOString();
  homeworkSelectRows = [
    [
      "legacy-without-state",
      "remote-user",
      "Homework",
      "12 Aug 2026",
      "MATHEMATICS: Complete exercise 9",
      "Mathematics",
      null,
      now,
      now,
      null,
      null,
    ],
    [
      "legacy-with-state",
      "remote-user",
      "Homework",
      "12 Aug 2026",
      "MATHEMATICS: Complete exercise 9",
      "Mathematics",
      null,
      now,
      now,
      1,
      "Preserve this",
    ],
  ];
  pipelines.length = 0;
  db.batch = undefined;
  try {
    const homework = await homeworkCacheService.upsertHomework("remote-user", [
      {
        type: "Homework",
        date: "12 Aug 2026",
        homework: "MATHEMATICS: Complete exercise 9",
        attachment: null,
      },
    ]);
    assert.equal(homework.length, 1);
    assert.equal(
      homework[0].id,
      "legacy-with-state",
      pipelines[0]?.requests?.[0]?.stmt?.sql
    );
    assert.equal(homework[0].completed, true);
    assert.equal(homework[0].note, "Preserve this");
  } finally {
    db.batch = originalBatch;
  }

  assert.equal(pipelines.length, 2);
  const cleanupExecutions = pipelines[1].requests.filter(
    (request) => request.type === "execute"
  );
  assert.equal(cleanupExecutions.length, 2);
  assert.match(cleanupExecutions[0].stmt.sql, /^update\b/i);
  assert.match(cleanupExecutions[1].stmt.sql, /^delete\b/i);
});
