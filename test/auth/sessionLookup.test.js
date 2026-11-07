const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const databasePath = path.join(os.tmpdir(), `session-lookup-${process.pid}-${Date.now()}.sqlite`);
delete process.env.TURSO_DATABASE_URL;
delete process.env.LIBSQL_URL;
process.env.SQLITE_DB_PATH = databasePath;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "session-lookup-test-key-0123456789abcdef";

const { db, ready, schema, sqlite } = require("../../server/db/client");
const sessionService = require("../../server/auth/sessionService");

test.before(async () => {
  await ready;
});

test.after(() => {
  try {
    sqlite?.close();
  } catch {}
  for (const suffix of ["", "-shm", "-wal"]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});

test("simultaneous requests with one cookie share a single session lookup", async (t) => {
  const now = new Date().toISOString();
  const user = { id: "lookup-user", studentId: "lookup1", section: "9-A", createdAt: now, updatedAt: now };
  await db.insert(schema.users).values(user).run();
  const token = await sessionService.createAppSession(user.id, { ...user, role: "student" });

  const original = sessionService.loadSessionWithUser.bind(sessionService);
  let lookups = 0;
  t.mock.method(sessionService, "loadSessionWithUser", async (key) => {
    lookups += 1;
    return original(key);
  });

  const sessions = await Promise.all(Array.from({ length: 5 }, () => sessionService.getAppSession(token)));

  assert.equal(lookups, 1);
  for (const session of sessions) assert.equal(session.user.id, user.id);
  assert.equal((await sessionService.getAppSession(token)).user.id, user.id);
  assert.equal(lookups, 1, "the resolved session is then served from the short-lived cache");
});
