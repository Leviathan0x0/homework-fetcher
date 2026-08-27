const assert = require("node:assert/strict");
const test = require("node:test");
const {
  measureRequestTiming,
  requestTimingMiddleware,
} = require("../../server/performance/requestTiming");

test("emits component and total durations in Server-Timing", async () => {
  const headers = new Map();
  const response = {
    headersSent: false,
    statusCode: 200,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    end() {},
  };
  const originalInfo = console.info;
  console.info = () => {};

  try {
    await new Promise((resolve, reject) => {
      requestTimingMiddleware(
        { method: "GET", originalUrl: "/api/example" },
        response,
        () => {
          measureRequestTiming("database", async () => {
            await new Promise((done) => setTimeout(done, 5));
          }).then(() => {
            response.end();
            resolve();
          }, reject);
        }
      );
    });
  } finally {
    console.info = originalInfo;
  }

  const value = headers.get("server-timing");
  assert.match(value, /database;dur=\d+(?:\.\d+)?/);
  assert.match(value, /total;dur=\d+(?:\.\d+)?/);
});
