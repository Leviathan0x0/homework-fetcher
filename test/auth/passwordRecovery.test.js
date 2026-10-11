process.env.NODE_ENV = "test";
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

// An isolated file-backed database. Deliberately NOT the production one: point
// TURSO_DATABASE_URL anywhere near a real deployment and this suite would write.
const databasePath = path.join(
  os.tmpdir(),
  `mmss-password-${process.pid}-${Date.now()}.sqlite`
);
delete process.env.TURSO_DATABASE_URL;
delete process.env.LIBSQL_URL;
process.env.SQLITE_DB_PATH = databasePath;
// Sessions are signed and the EduSecure credential is sealed with this key. A
// fixed throwaway value: the tests never touch a production database, so the only
// thing the key has to be is long enough to derive from.
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
// A fixed throwaway key, never a real one. Sessions cannot be minted without a
// signing key, and this suite exercises the session layer rather than its key
// management. The repo's other session-touching test does exactly this.
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const { db, ready, schema, sqlite, initDb } = require("../../server/db/client");
const passwords = require("../../server/auth/passwords");
const audit = require("../../server/auth/securityAudit");
const resetService = require("../../server/auth/passwordResetService");
const sessionService = require("../../server/auth/sessionService");
const { eq } = require("drizzle-orm");

/** The allowlist the audit service enforces, mirrored so a test can assert on it. */
const AUDIT_ALLOWED_KEYS = {
  requestId: true,
  tokenId: true,
  reason: true,
  note: true,
  method: true,
  source: true,
  expiresAt: true,
  sessionsRevoked: true,
};

const VALID_PASSWORD = "correct horse battery staple";
const OTHER_PASSWORD = "a second valid password";
const STUDENT_ID = "stu-1";
const ADMIN_ID = "admin_mmss";

let server = null;
let baseUrl = "";
let portalCalls = 0;
let previousFetch = null;

/* ------------------------------------------------------------------ helpers */

async function createUser(id, studentId, role = "student", withHash = false) {
  const now = new Date().toISOString();
  await db
    .insert(schema.users)
    .values({
      id,
      studentId,
      displayName: `User ${studentId}`,
      section: "9-C",
      role,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  if (withHash) {
    await db
      .update(schema.users)
      .set({ passwordHash: await passwords.hashPassword(VALID_PASSWORD) })
      .where(eq(schema.users.id, id))
      .run();
  }
}

async function call(route, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, raw, headers: response.headers };
}

function cookieFrom({ headers }) {
  const header = headers.get("set-cookie") || "";
  const match = /app_session=([^;]+)/.exec(header);
  return match ? match[1] : null;
}

async function login(studentId, password) {
  const result = await call("/api/auth/login", {
    method: "POST",
    body: { studentId, password },
  });
  return { ...result, token: result.json?.token || cookieFrom(result) };
}

/** The current stored hash, for assertions about which password is live. */
async function storedHash(userId) {
  const row = await db
    .select({ passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  return row.passwordHash;
}

let userCounter = 0;
/** A fresh account, so tests never share state through the users table. */
async function freshUser(withHash = false) {
  const id = `u-fresh-${++userCounter}`;
  const studentId = `stu-fresh-${userCounter}`;
  await createUser(id, studentId, "student", withHash);
  return { id, studentId };
}

async function freshSession(userId) {
  return sessionService.createAppSession(userId);
}

/* -------------------------------------------------------------------- setup */

test.before(async () => {
  await ready;

  // The admin account exists before anything tries to borrow its session: the
  // sessions table has a foreign key onto users, so a session cannot be created for
  // an account that does not exist.
  await createUser("u-admin", ADMIN_ID, "admin");
  await createUser("u-student", STUDENT_ID);

  const express = require("express");
  const authRoutes = require("../../server/routes/authRoutes");
  const adminRoutes = require("../../server/routes/adminRoutes");

  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use("/api/auth", authRoutes);
  app.use("/api/admin", adminRoutes);

  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Outbound requests are counted, not satisfied. A request that reaches the school
  // portal is exactly what "no EduSecure fallback" is about, so the tests assert on
  // the count rather than on a fabricated login.
  previousFetch = global.fetch;
  global.fetch = async (url, ...args) => {
    if (String(url).includes("edusecure")) portalCalls += 1;
    return previousFetch(url, ...args);
  };
});

test.after(async () => {
  global.fetch = previousFetch;
  await new Promise((resolve) => server.close(resolve));
  try {
    sqlite?.close();
  } catch {}
  for (const suffix of ["", "-shm", "-wal"]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});

/* --------------------------------------------------------------- migration */

test("the migration adds password_hash and leaves existing accounts alone", async () => {
  const columns = sqlite.pragma("table_info(users)").map((column) => column.name);
  assert.ok(columns.includes("password_hash"), "password_hash column exists");

  const legacy = await freshUser();
  assert.equal(await storedHash(legacy.id), null, "existing rows keep a null hash");
});

test("the recovery tables exist", async () => {
  for (const table of ["password_reset_requests", "password_reset_tokens", "security_audit_log"]) {
    const columns = sqlite.pragma(`table_info(${table})`).map((column) => column.name);
    assert.ok(columns.includes("id"), `${table} was created`);
  }
});

test("schema initialization is idempotent and keeps every row", async () => {
  // A cold start runs it again. Nothing may be dropped or duplicated.
  await initDb();
  await initDb();
  const users = await db.select().from(schema.users).all();
  assert.ok(users.length > 0, "existing accounts survive a re-run");
});

/* ------------------------------------------------------------- login rules */

test("an account with an MMSS64 password signs in with it", async () => {
  const { studentId } = await freshUser(true);
  const result = await login(studentId, VALID_PASSWORD);
  assert.equal(result.status, 200);
  assert.equal(result.json.authenticated, true);
  assert.ok(result.token, "a session was issued");
});

test("a wrong MMSS64 password is refused without ever contacting the portal", async () => {
  const student = await freshUser(true);
  const before = portalCalls;

  const result = await login(student.studentId, "not the password at all");

  assert.equal(result.status, 401);
  assert.equal(result.json.authenticated, false);
  assert.equal(portalCalls, before, "no EduSecure round trip was attempted");
  assert.equal(result.json.token, undefined, "no session was issued");
});

test("an account with no password still reaches the portal, exactly as before", async () => {
  const student = await freshUser();
  const before = portalCalls;

  // The portal is unreachable here, so this ends in a portal error. The point is
  // that the request was routed there at all, which is legacy behaviour intact.
  await login(student.studentId, VALID_PASSWORD);

  assert.ok(portalCalls > before, "the EduSecure path is still taken for legacy accounts");
});

test("an unknown ID and a wrong password are answered the same way", async () => {
  const student = await freshUser(true);
  const wrongPassword = await login(student.studentId, "definitely not it");
  const unknownId = await login("stu-does-not-exist", "definitely not it");
  assert.equal(wrongPassword.status, unknownId.status);
  assert.equal(wrongPassword.json.error, unknownId.json.error);
});

/* --------------------------------------------------------- password changes */

test("changing the password kills the old one and every other session", async () => {
  const student = await freshUser(true);

  const first = await login(student.studentId, VALID_PASSWORD);
  assert.equal(first.status, 200);
  const originalToken = first.token;

  // A second sign-in stands in for "my other device".
  const second = await login(student.studentId, VALID_PASSWORD);
  const otherToken = second.token;
  assert.notEqual(originalToken, otherToken, "each sign-in gets its own session");

  const changed = await call("/api/auth/security/password", {
    method: "PATCH",
    token: originalToken,
    body: {
      currentPassword: VALID_PASSWORD,
      newPassword: OTHER_PASSWORD,
      confirmPassword: OTHER_PASSWORD,
    },
  });

  assert.equal(changed.status, 200);
  assert.equal(changed.json.success, true);
  assert.equal(changed.json.separatePasswordEnabled, true);

  const rotated = cookieFrom(changed);
  assert.ok(rotated, "a replacement session is issued in place");

  assert.equal(await passwords.verifyPassword(OTHER_PASSWORD, await storedHash(student.id)), true);
  assert.equal(await passwords.verifyPassword(VALID_PASSWORD, await storedHash(student.id)), false);

  // The old credential is dead at the login gate too.
  assert.equal((await login(student.studentId, VALID_PASSWORD)).status, 401);
  assert.equal((await login(student.studentId, OTHER_PASSWORD)).status, 200);

  // Every session the old password was good for stopped, including the other
  // device's; the rotated one replaced this one.
  assert.equal((await call("/api/auth/me", { token: originalToken })).json?.authenticated, false);
  assert.equal((await call("/api/auth/me", { token: otherToken })).json?.authenticated, false);
  assert.equal((await call("/api/auth/me", { token: rotated })).json?.authenticated, true);
});

test("a change needs the current password, a matching confirmation and a new password", async () => {
  const student = await freshUser(true);
  const token = await freshSession(student.id);
  const attempt = (body) =>
    call("/api/auth/security/password", { method: "PATCH", token, body });

  const wrongCurrent = await attempt({
    currentPassword: "nope",
    newPassword: OTHER_PASSWORD,
    confirmPassword: OTHER_PASSWORD,
  });
  assert.equal(wrongCurrent.status, 401);

  const mismatch = await attempt({
    currentPassword: VALID_PASSWORD,
    newPassword: OTHER_PASSWORD,
    confirmPassword: "something else",
  });
  assert.equal(mismatch.status, 400);

  const samePassword = await attempt({
    currentPassword: VALID_PASSWORD,
    newPassword: VALID_PASSWORD,
    confirmPassword: VALID_PASSWORD,
  });
  assert.equal(samePassword.status, 400);

  const tooShort = await attempt({
    currentPassword: VALID_PASSWORD,
    newPassword: "short",
    confirmPassword: "short",
  });
  assert.equal(tooShort.status, 400);

  // None of the four changed anything.
  assert.equal(await passwords.verifyPassword(VALID_PASSWORD, await storedHash(student.id)), true);
});

test("a change on an account with no password is indistinguishable from a wrong one", async () => {
  // Same status and wording either way, so this endpoint cannot become a way to
  // learn which accounts have a password configured.
  const student = await freshUser();
  const token = await freshSession(student.id);

  const result = await call("/api/auth/security/password", {
    method: "PATCH",
    token,
    body: { currentPassword: VALID_PASSWORD, newPassword: OTHER_PASSWORD, confirmPassword: OTHER_PASSWORD },
  });

  assert.equal(result.status, 401);
  assert.equal(result.json.error, "That password is not correct.");
  assert.equal(await storedHash(student.id), null, "no password was created");
});

test("a change without a session is refused", async () => {
  const result = await call("/api/auth/security/password", {
    method: "PATCH",
    body: { currentPassword: VALID_PASSWORD, newPassword: OTHER_PASSWORD, confirmPassword: OTHER_PASSWORD },
  });
  assert.equal(result.status, 401);
});

/* ------------------------------------------------------ enrollment is shut */

test("self-service enrollment is refused and names the way out", async () => {
  const student = await freshUser();
  const token = await freshSession(student.id);

  const result = await call("/api/auth/security/password", {
    method: "POST",
    token,
    body: {
      edusecurePassword: "school portal password",
      newPassword: OTHER_PASSWORD,
      confirmPassword: OTHER_PASSWORD,
    },
  });

  assert.equal(result.status, 403);
  assert.match(result.json.error, /administrator/i);
  assert.match(result.json.error, /reset/i);
  assert.equal(await storedHash(student.id), null, "nothing was written");
});

test("the status endpoint reports no usable portal verification", async () => {
  const student = await freshUser();
  const token = await freshSession(student.id);

  const result = await call("/api/auth/security", { token });

  assert.equal(result.status, 200);
  assert.deepEqual(result.json, {
    hasMmssPassword: false,
    edusecureCredentialConfigured: false,
    edusecureVerificationAvailable: false,
  });
});

test("the status endpoint reports a configured password once there is one", async () => {
  const student = await freshUser(true);
  const token = await freshSession(student.id);

  const result = await call("/api/auth/security", { token });

  assert.equal(result.status, 200);
  assert.equal(result.json.hasMmssPassword, true);
});

/* ---------------------------------------------------------- reset requests */

test("a reset request gets one answer whether or not the school ID exists", async () => {
  const known = await call("/api/auth/password-reset-requests", {
    method: "POST",
    body: { studentId: "stu-fresh-1", message: "I forgot my password." },
  });
  const unknown = await call("/api/auth/password-reset-requests", {
    method: "POST",
    body: { studentId: "stu-nobody-here", message: "Let me in." },
  });

  assert.equal(known.status, 202);
  assert.equal(unknown.status, 202);
  assert.deepEqual(known.json, unknown.json, "nothing distinguishes the two");
});

test("a reset request needs a school ID", async () => {
  const result = await call("/api/auth/password-reset-requests", { method: "POST", body: {} });
  assert.equal(result.status, 400);
});

test("a student reads only their own requests", async () => {
  const owner = await freshUser();
  const someoneElse = await freshUser();
  await resetService.createResetRequest({ studentId: owner.studentId, message: "mine" });
  await resetService.createResetRequest({ studentId: someoneElse.studentId, message: "theirs" });

  const token = await freshSession(owner.id);
  const result = await call("/api/auth/password-reset-requests", { token });

  assert.equal(result.status, 200);
  assert.ok(result.json.requests.length >= 1);
  for (const request of result.json.requests) {
    assert.equal(request.studentId, owner.studentId, "only the caller's own requests");
  }
});

test("an unauthenticated caller cannot list requests", async () => {
  const result = await call("/api/auth/password-reset-requests");
  assert.equal(result.status, 401);
});

/* ---------------------------------------------------------- reset mechanics */

test("an administrator reset gives a never-configured account its first password", async () => {
  const student = await freshUser();
  const adminToken = await freshSession("u-admin");

  const issued = await call("/api/admin/password-resets", {
    method: "POST",
    token: adminToken,
    body: { studentId: student.studentId, note: "verified at the office" },
  });

  assert.equal(issued.status, 200);
  assert.ok(issued.json.token, "a code was issued");
  assert.ok(issued.json.expiresAt > Date.now(), "it expires in the future");

  const redeemed = await call("/api/auth/password-reset", {
    method: "POST",
    body: { token: issued.json.token, newPassword: OTHER_PASSWORD, confirmPassword: OTHER_PASSWORD },
  });

  assert.equal(redeemed.status, 200);
  assert.equal(await passwords.verifyPassword(OTHER_PASSWORD, await storedHash(student.id)), true,
    "password_hash was initialised from null");
  assert.equal((await login(student.studentId, OTHER_PASSWORD)).status, 200,
    "the student signs in with the password they chose");
});

test("a reset token cannot be used twice", async () => {
  const student = await freshUser();
  const { token } = await resetService.issueResetToken({ userId: student.id, createdBy: "u-admin" });

  const first = await call("/api/auth/password-reset", {
    method: "POST",
    body: { token, newPassword: OTHER_PASSWORD, confirmPassword: OTHER_PASSWORD },
  });
  assert.equal(first.status, 200);

  const replay = await call("/api/auth/password-reset", {
    method: "POST",
    body: { token, newPassword: "third valid password", confirmPassword: "third valid password" },
  });
  assert.equal(replay.status, 400);
  assert.equal(
    await passwords.verifyPassword("third valid password", await storedHash(student.id)),
    false,
    "the replay changed nothing"
  );
});

test("two redemptions of one token: exactly one wins", async () => {
  const student = await freshUser();
  const { token } = await resetService.issueResetToken({ userId: student.id, createdBy: "u-admin" });

  // Simultaneous, because that is the shape a double tap actually takes.
  const [a, b] = await Promise.all([
    call("/api/auth/password-reset", {
      method: "POST",
      body: { token, newPassword: "first attempt pass", confirmPassword: "first attempt pass" },
    }),
    call("/api/auth/password-reset", {
      method: "POST",
      body: { token, newPassword: "second attempt pass", confirmPassword: "second attempt pass" },
    }),
  ]);

  assert.equal([a, b].filter((r) => r.status === 200).length, 1, "the token was spent once");

  const hash = await storedHash(student.id);
  // Exactly one of the two attempts is the live password.
  const firstWins = await passwords.verifyPassword("first attempt pass", hash);
  const secondWins = await passwords.verifyPassword("second attempt pass", hash);
  assert.equal(Number(firstWins) + Number(secondWins), 1, "one password won, not both");
});

test("an expired token is refused", async () => {
  const student = await freshUser();
  const issued = await resetService.issueResetToken({ userId: student.id, createdBy: "u-admin" });

  await db
    .update(schema.passwordResetTokens)
    .set({ expiresAt: Date.now() - 1000 })
    .where(eq(schema.passwordResetTokens.userId, student.id))
    .run();

  const result = await call("/api/auth/password-reset", {
    method: "POST",
    body: { token: issued.token, newPassword: OTHER_PASSWORD, confirmPassword: OTHER_PASSWORD },
  });

  assert.equal(result.status, 400);
  assert.equal(await storedHash(student.id), null, "an expired code set nothing");
});

test("a revoked token is refused", async () => {
  const student = await freshUser();
  const issued = await resetService.issueResetToken({ userId: student.id, createdBy: "u-admin" });

  await db
    .update(schema.passwordResetTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(eq(schema.passwordResetTokens.userId, student.id))
    .run();

  const result = await call("/api/auth/password-reset", {
    method: "POST",
    body: { token: issued.token, newPassword: OTHER_PASSWORD, confirmPassword: OTHER_PASSWORD },
  });
  assert.equal(result.status, 400);
});

test("issuing a second token makes the first one dead", async () => {
  const student = await freshUser();
  const stale = await resetService.issueResetToken({ userId: student.id, createdBy: "u-admin" });
  const fresh = await resetService.issueResetToken({ userId: student.id, createdBy: "u-admin" });

  const staleAttempt = await call("/api/auth/password-reset", {
    method: "POST",
    body: { token: stale.token, newPassword: OTHER_PASSWORD, confirmPassword: OTHER_PASSWORD },
  });
  assert.equal(staleAttempt.status, 400, "the superseded code is refused");

  const freshAttempt = await call("/api/auth/password-reset", {
    method: "POST",
    body: { token: fresh.token, newPassword: "third valid password", confirmPassword: "third valid password" },
  });
  assert.equal(freshAttempt.status, 200);
});

test("an invalid or malformed code is refused and says nothing about accounts", async () => {
  const missing = await call("/api/auth/password-reset", {
    method: "POST",
    body: { token: "not-a-real-code", newPassword: OTHER_PASSWORD, confirmPassword: OTHER_PASSWORD },
  });
  assert.equal(missing.status, 400);

  const empty = await call("/api/auth/password-reset", { method: "POST", body: {} });
  assert.equal(empty.status, 400);
});

test("a mismatched confirmation is refused before a token is spent", async () => {
  const student = await freshUser();
  const issued = await resetService.issueResetToken({ userId: student.id, createdBy: "u-admin" });

  const result = await call("/api/auth/password-reset", {
    method: "POST",
    body: { token: issued.token, newPassword: OTHER_PASSWORD, confirmPassword: "not the same" },
  });
  assert.equal(result.status, 400);

  // The code is still usable, because the form was refused before it was claimed.
  const retry = await call("/api/auth/password-reset", {
    method: "POST",
    body: { token: issued.token, newPassword: OTHER_PASSWORD, confirmPassword: OTHER_PASSWORD },
  });
  assert.equal(retry.status, 200);
});

/* -------------------------------------------------------- administrator side */

test("only an administrator can reach reset management", async () => {
  const student = await freshUser();
  const studentToken = await freshSession(student.id);
  const adminToken = await freshSession("u-admin");

  assert.equal((await call("/api/admin/password-reset-requests", { token: studentToken })).status, 403);
  assert.equal((await call("/api/admin/password-reset-requests", { token: adminToken })).status, 200);

  const unauthenticated = await call("/api/admin/password-reset-requests");
  assert.equal(unauthenticated.status, 401);
});

test("approving a request issues a token and records approval", async () => {
  const student = await freshUser();
  const created = await resetService.createResetRequest({ studentId: student.studentId, message: "help please" });
  const adminToken = await freshSession("u-admin");

  const approved = await call(`/api/admin/password-reset-requests/${created.id}`, {
    method: "POST",
    token: adminToken,
    body: { action: "approve", note: "verified in person" },
  });

  assert.equal(approved.status, 200);
  assert.equal(approved.json.status, "approved");
  assert.ok(approved.json.token, "an approval ships a reset token");
});

test("rejecting a request ships no credential and closes it", async () => {
  const student = await freshUser();
  const created = await resetService.createResetRequest({ studentId: student.studentId, message: "help" });
  const adminToken = await freshSession("u-admin");

  const rejected = await call(`/api/admin/password-reset-requests/${created.id}`, {
    method: "POST",
    token: adminToken,
    body: { action: "reject", note: "not verified" },
  });

  assert.equal(rejected.status, 200);
  assert.equal(rejected.json.status, "rejected");
  assert.equal(rejected.json.token, undefined, "a rejection ships no credential");

  const queue = await call("/api/admin/password-reset-requests?status=rejected", { token: adminToken });
  assert.ok(queue.json.requests.some((r) => r.id === created.id && r.status === "rejected"));
});

test("a closed request cannot be re-resolved", async () => {
  const student = await freshUser();
  const created = await resetService.createResetRequest({ studentId: student.studentId });
  const adminToken = await freshSession("u-admin");

  await call(`/api/admin/password-reset-requests/${created.id}`, {
    method: "POST",
    token: adminToken,
    body: { action: "reject" },
  });

  const second = await call(`/api/admin/password-reset-requests/${created.id}`, {
    method: "POST",
    token: adminToken,
    body: { action: "approve" },
  });
  assert.ok([409, 400].includes(second.status), "a closed request stays closed");
});

test("an unknown request is a 404, not a 500", async () => {
  const adminToken = await freshSession("u-admin");
  const result = await call("/api/admin/password-reset-requests/does-not-exist", {
    method: "POST",
    token: adminToken,
    body: { action: "approve" },
  });
  assert.equal(result.status, 404);
});

/* -------------------------------------------------------------- audit trail */

test("audit rows record the security events", async () => {
  const events = await audit.listSecurityAudit({ limit: 200 });
  assert.ok(events.length > 5, "the flow above left a trail");

  const kinds = new Set(events.map((event) => event.event));
  for (const expected of [
    "password_changed",
    "sessions_revoked",
    "password_reset_redeemed",
    "password_reset_approved",
    "password_reset_rejected",
    "password_enrollment_refused",
  ]) {
    assert.ok(kinds.has(expected), `${expected} was recorded`);
  }

  // Who did what to whom, and when.
  for (const event of events) {
    assert.ok(event.createdAt, "every event is timestamped");
    assert.ok(event.outcome, "every event has an outcome");
  }
});

test("audit rows contain no secret, from any path", async () => {
  const events = await audit.listSecurityAudit({ limit: 200 });
  const blob = JSON.stringify(events).toLowerCase();

  for (const secret of [VALID_PASSWORD, OTHER_PASSWORD, "correct horse", "third valid password"]) {
    assert.ok(!blob.includes(secret.toLowerCase()), `the audit log leaked: ${secret}`);
  }

  for (const event of events) {
    const detail = JSON.stringify(event.detail || {});
    // A base64url token is 43 characters; a scrypt hash is far longer.
    assert.ok(!/^[A-Za-z0-9_-]{43}$/.test(detail.trim()), "no token-shaped value");
    for (const key of Object.keys(event.detail || {})) {
      assert.ok(AUDIT_ALLOWED_KEYS[key], `unexpected audit key: ${key}`);
    }
  }
});

test("a caller cannot smuggle an unlisted key into the audit log", () => {
  // Same request shape the event writers use, with a credential attached.
  const stored = audit.sanitizeDetail({
    password: "hunter2",
    token: "abc",
    hash: "scrypt$1$2$3$4$5",
    reason: "not an attack, just this key",
  });
  const parsed = JSON.parse(stored);
  assert.deepEqual(Object.keys(parsed), ["reason"], "unlisted keys are dropped");
  assert.ok(!JSON.stringify(parsed).includes("hunter2"));
});

/* ------------------------------------------------------- stored token safety */

test("the reset token is never stored, only its hash", async () => {
  const student = await freshUser();
  const issued = await resetService.issueResetToken({ userId: student.id, createdBy: "u-admin" });

  // Only this student's row belongs to the token just issued; earlier tokens in
  // the shared test database have hashes of their own.
  const tokenRow = await db
    .select()
    .from(schema.passwordResetTokens)
    .where(eq(schema.passwordResetTokens.userId, student.id))
    .get();

  assert.match(tokenRow.tokenHash, /^[0-9a-f]{64}$/, "the stored value is a SHA-256 hex digest");
  assert.notEqual(tokenRow.tokenHash, issued.token, "the plaintext token is not in the table");
  assert.equal(tokenRow.tokenHash, resetService.hashResetToken(issued.token), "it is the hash of it");

  const rows = await db.select().from(schema.passwordResetTokens).all();
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.match(row.tokenHash, /^[0-9a-f]{64}$/, "every stored value is a hash");
  }
});

test("a response never carries the stored hash", async () => {
  const student = await freshUser(true);
  const token = await freshSession(student.id);

  const status = await call("/api/auth/security", { token });
  const hash = await storedHash(student.id);

  assert.ok(!status.raw.includes(hash), "the status endpoint never serialises the hash");
  assert.ok(!status.raw.includes("passwordHash"));
});
