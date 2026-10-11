const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const test = require("node:test");
const Database = require("better-sqlite3");

const SCRIPT = path.join(__dirname, "../../scripts/migrate-remote-to-local.js");

function encodeCell(value) {
  if (value === null || value === undefined) return { type: "null" };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { type: "integer", value: String(value) }
      : { type: "float", value };
  }
  if (Buffer.isBuffer(value)) return { type: "blob", base64: value.toString("base64") };
  return { type: "text", value: String(value) };
}

/**
 * Minimal libSQL /v2/pipeline server backed by a local SQLite file. Speaks
 * just enough of the protocol for the migration script: "execute" requests
 * (rows as arrays, cols by name) plus "close".
 */
function startPipelineServer(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const { requests } = JSON.parse(body);
        const results = [];
        for (const request of requests) {
          if (request.type !== "execute") continue;
          const { sql, args = [] } = request.stmt;
          try {
            const stmt = db.prepare(sql);
            if (stmt.reader) {
              const raw = stmt.raw(true);
              const rows = raw.all(...args);
              results.push({
                type: "execute",
                response: {
                  type: "execute",
                  result: {
                    cols: stmt.columns().map((c) => ({ name: c.name })),
                    rows: rows.map((row) => row.map(encodeCell)),
                    affected_row_count: 0,
                  },
                },
              });
            } else {
              const info = stmt.run(...args);
              results.push({
                type: "execute",
                response: {
                  type: "execute",
                  result: { cols: [], rows: [], affected_row_count: info.changes },
                },
              });
            }
          } catch (err) {
            results.push({ type: "error", error: { message: err.message } });
          }
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ results }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => { db.close(); server.close(r); }),
      });
    });
  });
}

function runScript(env) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [SCRIPT],
      { env: { ...process.env, ...env }, timeout: 30_000 },
      (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr })
    );
  });
}

test("migrate-remote-to-local copies rows, preserves local data, and is idempotent", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-test-"));
  const sourcePath = path.join(dir, "source.db");
  const targetPath = path.join(dir, "target.db");

  // Source: parent + child rows. Copy order in the script is alphabetical, so
  // "homework" is copied before "users" in the target — a naive copy would
  // trip the foreign key unless the script defers enforcement.
  const source = new Database(sourcePath);
  source.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, student_id TEXT NOT NULL UNIQUE,
      display_name TEXT, section TEXT NOT NULL DEFAULT 'Section 10-A',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE homework (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      source_identifier TEXT NOT NULL DEFAULT 'edusecure', date TEXT NOT NULL,
      subject TEXT NOT NULL, content TEXT NOT NULL, attachment_url TEXT,
      type TEXT NOT NULL DEFAULT 'Homework', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  const now = new Date().toISOString();
  source
    .prepare("INSERT INTO users (id, student_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run("u1", "10A-01", "Test Student", now, now);
  const insHw = source.prepare(
    "INSERT INTO homework (id, user_id, date, subject, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  for (let i = 0; i < 25; i++) {
    insHw.run(`hw-${i}`, "u1", "2026-10-01", "Mathematics", `Problem set ${i}`, now, now);
  }
  source.close();

  const stub = await startPipelineServer(sourcePath);
  t.after(stub.close);

  const env = {
    TURSO_DATABASE_URL: stub.url,
    TURSO_AUTH_TOKEN: "test-token",
    SQLITE_DB_PATH: targetPath,
  };

  // First run: everything is new.
  const first = await runScript(env);
  assert.equal(first.code, 0, `first run failed: ${first.stdout}\n${first.stderr}`);
  assert.match(first.stdout, /\+25 inserted/);
  assert.match(first.stdout, /\+1 inserted/);
  assert.match(first.stdout, /Inserted 26 rows/);

  const target = new Database(targetPath);
  assert.equal(target.prepare("SELECT COUNT(*) AS n FROM homework").get().n, 25);
  assert.equal(target.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
  assert.equal(target.prepare("PRAGMA foreign_key_check").all().length, 0);
  target.close();

  // Local row added between runs must survive: OR IGNORE, never overwrite.
  const preExisting = new Database(targetPath);
  preExisting
    .prepare("INSERT INTO users (id, student_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run("u2", "10A-02", "Local Only", now, now);
  preExisting.close();

  // Second run: idempotent, local-only row untouched.
  const second = await runScript(env);
  assert.equal(second.code, 0, `second run failed: ${second.stdout}\n${second.stderr}`);
  assert.match(second.stdout, /Inserted 0 rows, kept 26 existing rows/);

  const after = new Database(targetPath);
  assert.equal(after.prepare("SELECT COUNT(*) AS n FROM users").get().n, 2);
  assert.equal(
    after.prepare("SELECT display_name FROM users WHERE id = 'u2'").get().display_name,
    "Local Only"
  );
  after.close();

  fs.rmSync(dir, { recursive: true, force: true });
});
