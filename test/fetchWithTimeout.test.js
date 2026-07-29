const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchWithTimeout } = require("../server/http/fetchWithTimeout");

test("external requests fail with a bounded timeout", async () => {
  const originalFetch = global.fetch;
  global.fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener(
        "abort",
        () => reject(new Error("aborted")),
        {
          once: true,
        },
      );
    });

  try {
    await assert.rejects(
      fetchWithTimeout("https://example.test", {}, 10),
      (err) => err.code === "REQUEST_TIMEOUT",
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("the timeout remains active while the response body is consumed", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, init) => ({
    text: () =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
      }),
  });

  try {
    const response = await fetchWithTimeout("https://example.test", {}, 10);
    await assert.rejects(
      response.text(),
      (err) => err.code === "REQUEST_TIMEOUT",
    );
  } finally {
    global.fetch = originalFetch;
  }
});
