const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  hashPassword,
  verifyPassword,
  validatePassword,
  parseHash,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
} = require("../../server/auth/passwords");

const VALID = "correct horse battery staple";

test("a password verifies against its own hash", async () => {
  const hash = await hashPassword(VALID);
  assert.equal(await verifyPassword(VALID, hash), true);
});

test("a wrong password never verifies", async () => {
  const hash = await hashPassword(VALID);
  assert.equal(await verifyPassword("correct horse battery stapl3", hash), false);
  assert.equal(await verifyPassword("", hash), false);
  assert.equal(await verifyPassword("Correct horse battery staple", hash), false, "case matters");
});

test("every hash uses a fresh random salt", async () => {
  const a = await hashPassword(VALID);
  const b = await hashPassword(VALID);
  assert.notEqual(a, b, "identical passwords must not produce identical hashes");
  const saltA = parseHash(a).salt.toString("base64");
  const saltB = parseHash(b).salt.toString("base64");
  assert.notEqual(saltA, saltB);
  // Both still verify: a unique salt must not break the password it protects.
  assert.equal(await verifyPassword(VALID, a), true);
  assert.equal(await verifyPassword(VALID, b), true);
});

test("the encoded form is versioned and carries its own cost parameters", async () => {
  const hash = await hashPassword(VALID);
  const parts = hash.split("$");
  assert.equal(parts.length, 6);
  assert.equal(parts[0], "scrypt");
  assert.equal(parts[1], "32768");
  assert.equal(parts[2], "8");
  assert.equal(parts[3], "1");
});

test("verification uses the parameters stored in the hash, not the current ones", async () => {
  // A row written at a lower cost must keep verifying after the cost is raised.
  const cheap = await hashPassword(VALID, { N: 16384, r: 8, p: 1, keylen: 64 });
  assert.ok(cheap.includes("$16384$"));
  assert.equal(await verifyPassword(VALID, cheap), true);
});

test("a malformed hash is a rejection, never an exception", async () => {
  for (const bad of [
    null,
    undefined,
    "",
    "garbage",
    "scrypt$",
    "scrypt$32768$8$1$onlyfour$parts",
    "bcrypt$32768$8$1$c2FsdA==$aGFzaA==",
    "scrypt$abc$8$1$c2FsdA==$aGFzaA==",
    // An untrusted stored value must not be able to request an absurd cost.
    "scrypt$1073741824$8$1$c2FsdA==$aGFzaA==",
    "scrypt$2$999$1$c2FsdA==$aGFzaA==",
    "scrypt$32768$8$1$$aGFzaA==",
    "scrypt$32768$8$1$c2FsdA==$",
  ]) {
    assert.equal(parseHash(bad), null, `should not parse: ${bad}`);
    assert.equal(await verifyPassword(VALID, bad), false, `should not verify: ${bad}`);
  }
});

test("an absurd cost parameter is rejected before it is spent", async () => {
  // A tampered row asking for 2^30 must not pin the process; it is refused by the
  // bounds in parseHash, so this returns quickly rather than allocating memory.
  const started = Date.now();
  assert.equal(
    await verifyPassword(VALID, `scrypt$${1 << 30}$8$1$c2FsdA==$aGFzaA==`),
    false,
  );
  assert.ok(Date.now() - started < 1000, "must not attempt the work");
});

test("a tampered hash body fails closed", async () => {
  const hash = await hashPassword(VALID);
  const parsed = parseHash(hash);
  const forged = [
    "scrypt",
    parsed.N,
    parsed.r,
    parsed.p,
    parsed.salt.toString("base64"),
    crypto.randomBytes(64).toString("base64"),
  ].join("$");
  assert.equal(await verifyPassword(VALID, forged), false);
});

test("password length is measured in code points, not UTF-16 units", async () => {
  // Ten emoji is ten characters to a person and twenty units to String.length.
  const emoji = "\u{1F512}".repeat(MIN_PASSWORD_LENGTH);
  assert.equal(emoji.length, MIN_PASSWORD_LENGTH * 2);
  assert.deepEqual(validatePassword(emoji), { ok: true });
});

test("length limits are enforced on both sides", () => {
  assert.equal(validatePassword("a".repeat(MIN_PASSWORD_LENGTH - 1)).ok, false);
  assert.equal(validatePassword("a".repeat(MIN_PASSWORD_LENGTH)).ok, true);
  assert.equal(validatePassword("a".repeat(MAX_PASSWORD_LENGTH + 1)).ok, false);
  assert.equal(validatePassword("a".repeat(MAX_PASSWORD_LENGTH)).ok, true);
});

test("non-strings and blank passwords are refused", () => {
  for (const bad of [null, undefined, 123, {}, [], true, "", "   ", "\t\n"]) {
    assert.equal(validatePassword(bad).ok, false, `should refuse: ${JSON.stringify(bad)}`);
  }
});

test("leading and trailing spaces are part of the password, never stripped", async () => {
  // Stripping them silently produces a password nobody typed.
  const spaced = `  ${VALID}  `;
  const hash = await hashPassword(spaced);
  assert.equal(await verifyPassword(spaced, hash), true);
  assert.equal(await verifyPassword(VALID, hash), false);
});

test("hashing refuses an empty password and an over-long one", async () => {
  await assert.rejects(() => hashPassword(""));
  await assert.rejects(() => hashPassword("a".repeat(MAX_PASSWORD_LENGTH + 1)));
});

test("the stored value never contains the password", async () => {
  const hash = await hashPassword(VALID);
  assert.ok(!hash.includes(VALID));
  assert.ok(!hash.includes("correct"));
});
