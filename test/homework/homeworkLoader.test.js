const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function loadTypeScriptModule(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  });
  const loaded = { exports: {} };
  const evaluate = new Function("module", "exports", outputText);
  evaluate(loaded, loaded.exports);
  return loaded.exports;
}

const {
  getHomeworkRequest,
  loadHomeworkWithRevalidation,
} = loadTypeScriptModule(path.join(__dirname, "../../src/services/homeworkLoader.ts"));

test("uses the refresh endpoint only for an explicit refresh", () => {
  assert.deepEqual(getHomeworkRequest(false), {
    path: "/api/homework",
    options: { headers: { Accept: "application/json" } },
  });
  assert.deepEqual(getHomeworkRequest(true), {
    path: "/api/homework/refresh",
    options: {
      method: "POST",
      headers: { Accept: "application/json" },
    },
  });
});

test("automatically replaces a stale cached response with fresh homework", async () => {
  const calls = [];
  const staleResult = {
    items: [{ id: "yesterday" }],
    schoolSessionExpired: false,
    isStale: true,
  };
  const freshResult = {
    items: [{ id: "today" }, { id: "yesterday" }],
    schoolSessionExpired: false,
    isStale: false,
  };
  let paintedStale = null;

  const result = await loadHomeworkWithRevalidation(
    async (forceRefresh) => {
      calls.push(forceRefresh);
      return forceRefresh ? freshResult : staleResult;
    },
    false,
    (cached) => {
      paintedStale = cached;
    },
  );

  assert.deepEqual(calls, [false, true]);
  assert.equal(paintedStale, staleResult);
  assert.equal(result, freshResult);
});

test("does not replay fresh, forced, or disconnected homework loads", async () => {
  for (const scenario of [
    { forceRefresh: false, isStale: false, schoolSessionExpired: false },
    { forceRefresh: true, isStale: true, schoolSessionExpired: false },
    { forceRefresh: false, isStale: true, schoolSessionExpired: true },
  ]) {
    const calls = [];
    const response = { items: [], ...scenario };
    const result = await loadHomeworkWithRevalidation(async (forceRefresh) => {
      calls.push(forceRefresh);
      return response;
    }, scenario.forceRefresh);

    assert.deepEqual(calls, [scenario.forceRefresh]);
    assert.equal(result, response);
  }
});
