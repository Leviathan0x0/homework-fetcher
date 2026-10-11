const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const { localClassify, localFormat, clearLocalAiState } = require("../../server/ai/localAi");

function setEnv(values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

/** Starts a stub model service; handler(req, res) decides the response. */
function startStub(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(JSON.parse(body)));
  });
}

test.before(() => clearLocalAiState());
test.afterEach(() => clearLocalAiState());

test("disabled by default: returns null without any network call", async (t) => {
  const restore = setEnv({ LAYA_ENABLED: undefined, GEMMA_ENABLED: undefined });
  t.after(restore);

  const previousFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("fetch must not be called when local AI is disabled");
  };
  t.after(() => {
    global.fetch = previousFetch;
  });

  assert.equal(await localClassify("Solve quadratic equations", { section: "10-A" }), null);
  assert.equal(await localFormat("ch 3 ex 4", "Mathematics"), null);
});

test("enabled but unreachable: returns null instead of throwing", async (t) => {
  // Port 1 on loopback refuses connections immediately.
  const restore = setEnv({
    LAYA_ENABLED: "true",
    LAYA_URL: "http://127.0.0.1:1",
    GEMMA_ENABLED: "true",
    GEMMA_URL: "http://127.0.0.1:1",
    AI_LOCAL_TIMEOUT_MS: "500",
  });
  t.after(restore);

  assert.equal(await localClassify("homework text", { section: "9-A" }), null);
  assert.equal(await localFormat("messy text", "Science"), null);
});

test("classify: valid stub answer is parsed into the remote-shaped verdict", async (t) => {
  const stub = await startStub(async (req, res) => {
    const payload = await readJson(req);
    assert.equal(req.url, "/classify");
    assert.equal(payload.section, "10-A");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ subject: "Mathematics", is_formatted: false }));
  });
  t.after(stub.close);

  const restore = setEnv({ LAYA_ENABLED: "true", LAYA_URL: stub.url });
  t.after(restore);

  const result = await localClassify("Solve quadratic equations", { section: "10-A" });
  assert.deepEqual(result, { subject: "Mathematics", isFormatted: false });
});

test("classify: malformed answers are treated as unavailable", async (t) => {
  let requests = 0;
  const stub = await startStub((req, res) => {
    requests += 1;
    res.setHeader("Content-Type", "application/json");
    // Missing is_formatted -> must not be trusted as a verdict.
    res.end(JSON.stringify({ subject: "Mathematics" }));
  });
  t.after(stub.close);

  const restore = setEnv({ LAYA_ENABLED: "true", LAYA_URL: stub.url });
  t.after(restore);

  assert.equal(await localClassify("text", {}), null);
  assert.equal(requests, 1);
});

test("format: composes the same body shape as the remote formatter", async (t) => {
  const stub = await startStub(async (req, res) => {
    const payload = await readJson(req);
    assert.equal(req.url, "/format");
    assert.equal(payload.subject, "Mathematics");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ homework: "Ex 4, 5 on p. 32", classwork: "Quadratic formulas" }));
  });
  t.after(stub.close);

  const restore = setEnv({ GEMMA_ENABLED: "true", GEMMA_URL: stub.url });
  t.after(restore);

  const result = await localFormat("ex4 5 p32 quad formulas", "Mathematics");
  assert.equal(result.updated, true);
  assert.equal(result.homework, "Ex 4, 5 on p. 32");
  assert.equal(result.classwork, "Quadratic formulas");
  assert.equal(result.formattedText, "Homework: Ex 4, 5 on p. 32\nClasswork: Quadratic formulas");

  // A body the model echoes back unchanged is not an update.
  const unchanged = await localFormat(
    "Homework: Ex 4, 5 on p. 32\nClasswork: Quadratic formulas",
    "Mathematics"
  );
  assert.equal(unchanged.updated, false);
});

test("format: an empty model answer falls through instead of swallowing the entry", async (t) => {
  const stub = await startStub((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ homework: null, classwork: null }));
  });
  t.after(stub.close);

  const restore = setEnv({ GEMMA_ENABLED: "true", GEMMA_URL: stub.url });
  t.after(restore);

  assert.equal(await localFormat("some text", "Science"), null);
});

test("repeated failures open a cooldown and stop calling the service", async (t) => {
  let requests = 0;
  const stub = await startStub((req, res) => {
    requests += 1;
    res.statusCode = 500;
    res.end("boom");
  });
  t.after(stub.close);

  const restore = setEnv({ LAYA_ENABLED: "true", LAYA_URL: stub.url });
  t.after(restore);

  for (let i = 0; i < 3; i++) {
    assert.equal(await localClassify("text", {}), null);
  }
  assert.equal(requests, 3);

  // Breaker open: the service is not contacted again within the window.
  assert.equal(await localClassify("text", {}), null);
  assert.equal(requests, 3);
});
