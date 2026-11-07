const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const zlib = require("node:zlib");
const express = require("express");
const { compressJsonResponses } = require("../../server/performance/compressJson");

function startApp() {
  const app = express();
  app.use(compressJsonResponses());
  app.get("/big", (req, res) => res.json({ rows: Array.from({ length: 200 }, (_, i) => `row ${i}`) }));
  app.get("/small", (req, res) => res.json({ ok: true }));
  app.get("/denied", (req, res) => res.status(403).json({ error: "x".repeat(2000) }));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function get(server, path, headers = {}) {
  return new Promise((resolve, reject) => {
    http
      .get({ port: server.address().port, path, headers }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ res, body: Buffer.concat(chunks) }));
      })
      .on("error", reject);
  });
}

test("gzips large JSON, leaves small JSON alone, and answers a matching ETag with 304", async (t) => {
  const server = await startApp();
  t.after(() => server.close());

  const big = await get(server, "/big", { "Accept-Encoding": "gzip" });
  assert.equal(big.res.headers["content-encoding"], "gzip");
  assert.match(big.res.headers.vary, /Accept-Encoding/);
  assert.equal(JSON.parse(zlib.gunzipSync(big.body)).rows.length, 200);

  const revalidated = await get(server, "/big", {
    "Accept-Encoding": "gzip",
    "If-None-Match": big.res.headers.etag,
  });
  assert.equal(revalidated.res.statusCode, 304);
  assert.equal(revalidated.body.length, 0);

  const small = await get(server, "/small", { "Accept-Encoding": "gzip" });
  assert.equal(small.res.headers["content-encoding"], undefined);
  assert.deepEqual(JSON.parse(small.body.toString()), { ok: true });

  const plain = await get(server, "/big");
  assert.equal(plain.res.headers["content-encoding"], undefined);
  assert.equal(JSON.parse(plain.body.toString()).rows.length, 200);
});

test("error responses are compressed but never answered with 304", async (t) => {
  const server = await startApp();
  t.after(() => server.close());

  const first = await get(server, "/denied", { "Accept-Encoding": "gzip" });
  assert.equal(first.res.statusCode, 403);
  assert.equal(first.res.headers.etag, undefined);
  assert.equal(JSON.parse(zlib.gunzipSync(first.body)).error.length, 2000);
});
