const crypto = require("crypto");
const { deriveKey } = require("../auth/secrets");

/** Client countdown length; OK stays locked until this time. */
const COUNTDOWN_MS = 3000;
/** How long a minted notice token remains usable after issue. */
const TTL_MS = 5 * 60 * 1000;

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function signingKey() {
  return deriveKey("monitoring-notice-token");
}

/**
 * Mints a signed notice token that does not need a database round trip.
 *
 * Hosted/serverless instances do not share memory, and inserting into
 * monitoring_notice_tokens can fail when the participant row is missing or the
 * table is unavailable. A signed token carries the same countdown + expiry
 * guarantees without that dependency.
 *
 * @param {{ userId: string, participantId: string, now?: number }} input
 * @returns {{ noticeToken: string, validAfter: number, expiresAt: number, participantId: string }}
 */
function mintNoticeToken({ userId, participantId, now = Date.now() }) {
  const payload = {
    uid: userId,
    pid: participantId,
    va: now + COUNTDOWN_MS,
    exp: now + TTL_MS,
    n: crypto.randomUUID(),
  };
  const body = base64url(JSON.stringify(payload));
  const sig = base64url(crypto.createHmac("sha256", signingKey()).update(body).digest());
  return {
    noticeToken: `${body}.${sig}`,
    validAfter: payload.va,
    expiresAt: payload.exp,
    participantId,
  };
}

/**
 * Verifies a signed notice token for starting a conversation.
 *
 * @param {string} token
 * @param {{ userId: string, participantId: string, now?: number }} expected
 * @returns {{ ok: true, payload: object } | { ok: false, error: string, tooEarly?: boolean }}
 */
function verifyNoticeToken(token, { userId, participantId, now = Date.now() }) {
  if (!token || typeof token !== "string") {
    return { ok: false, error: "missing" };
  }

  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) {
    return { ok: false, error: "malformed" };
  }

  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expectedSig = base64url(crypto.createHmac("sha256", signingKey()).update(body).digest());

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (
    sigBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return { ok: false, error: "bad_sig" };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "bad_payload" };
  }

  if (
    !payload ||
    typeof payload.uid !== "string" ||
    typeof payload.pid !== "string" ||
    typeof payload.va !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, error: "bad_payload" };
  }

  if (payload.uid !== userId || payload.pid !== participantId) {
    return { ok: false, error: "mismatch" };
  }
  if (now > payload.exp) {
    return { ok: false, error: "expired" };
  }
  if (now < payload.va) {
    return { ok: false, error: "too_early", tooEarly: true };
  }

  return { ok: true, payload };
}

/** True when a value looks like a UUID v4-style id used for user rows. */
function looksLikeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

module.exports = {
  COUNTDOWN_MS,
  TTL_MS,
  mintNoticeToken,
  verifyNoticeToken,
  looksLikeUuid,
};
