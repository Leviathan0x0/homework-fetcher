const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const {
  mintNoticeToken,
  verifyNoticeToken,
  looksLikeUuid,
  COUNTDOWN_MS,
} = require("../../server/messaging/noticeToken");

describe("monitoring notice tokens", () => {
  it("mints a signed token that verifies after the countdown", () => {
    const now = 1_700_000_000_000;
    const minted = mintNoticeToken({
      userId: "user-a",
      participantId: "user-b",
      now,
    });

    assert.equal(typeof minted.noticeToken, "string");
    assert.ok(minted.noticeToken.includes("."));
    assert.equal(minted.validAfter, now + COUNTDOWN_MS);
    assert.equal(minted.participantId, "user-b");

    const tooEarly = verifyNoticeToken(minted.noticeToken, {
      userId: "user-a",
      participantId: "user-b",
      now: now + COUNTDOWN_MS - 1,
    });
    assert.equal(tooEarly.ok, false);
    assert.equal(tooEarly.tooEarly, true);

    const ok = verifyNoticeToken(minted.noticeToken, {
      userId: "user-a",
      participantId: "user-b",
      now: now + COUNTDOWN_MS,
    });
    assert.equal(ok.ok, true);
  });

  it("rejects forged or mismatched tokens", () => {
    const minted = mintNoticeToken({
      userId: "user-a",
      participantId: "user-b",
      now: Date.now() - COUNTDOWN_MS,
    });

    const badSig = verifyNoticeToken(`${minted.noticeToken.slice(0, -2)}aa`, {
      userId: "user-a",
      participantId: "user-b",
    });
    assert.equal(badSig.ok, false);

    const wrongUser = verifyNoticeToken(minted.noticeToken, {
      userId: "user-other",
      participantId: "user-b",
    });
    assert.equal(wrongUser.ok, false);

    const legacyUuid = verifyNoticeToken("6f1d2c3b-4a5e-6789-abcd-ef0123456789", {
      userId: "user-a",
      participantId: "user-b",
    });
    assert.equal(legacyUuid.ok, false);
    assert.equal(legacyUuid.error, "malformed");
  });

  it("detects UUID-shaped user ids", () => {
    assert.equal(looksLikeUuid("6f1d2c3b-4a5e-4789-8bcd-ef0123456789"), true);
    assert.equal(looksLikeUuid("kiaan1240"), false);
    assert.equal(looksLikeUuid(""), false);
  });
});
