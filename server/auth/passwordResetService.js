"use strict";

/**
 * Administrator-managed password recovery.
 *
 * # Why this exists instead of self-service enrollment
 *
 * A student setting their own MMSS64 password needs their identity proved first,
 * and neither proof this codebase has available proves it:
 *
 * - An authenticated session proves that *someone* presented a cookie, not that it
 *   was the student. A stolen cookie is unchanged by session revocation here, so
 *   revocation is not an identity check.
 * - The EduSecure portal predicate (`server/edusecure/edusecureAuth.js` and the
 *   login built on it) is a deny-list: it looks for familiar error text rather than
 *   for positive proof of a signed-in page. A WAF challenge, a captcha, a redirect
 *   to a password-change page or simply an unfamiliar response all pass it. That is
 *   fail-open, and "verify the school password to set an MMSS64 password" would
 *   therefore hand a permanent credential to anyone who can reach the portal at all.
 *
 * So self-service enrollment stays off, and the enrolment path is an administrator
 * who has already verified the student in person. The admin never sees or types the
 * student's password: they hand over a single-use token once, and the student sets
 * their own password with it.
 *
 * # The token
 *
 * 32 random bytes, shown exactly once, hashed with SHA-256 at rest. The fast hash is
 * deliberate: this is not a password someone can guess, it is 256 bits of uniform
 * randomness, so the offline-cracking resistance that scrypt exists for buys nothing
 * here and would make every lookup expensive. What matters is that the token is
 * never stored, never logged, and unreadable from the database.
 *
 * # Single use without a transaction
 *
 * The libSQL HTTP proxy behind `TURSO_DATABASE_URL` has no interactive transaction
 * (see `runBatch` in server/db/client.js), so correctness comes from a *conditional*
 * UPDATE instead. Claiming a token updates it only where it is still unclaimed,
 * unrevoked and unexpired, and reads back how many rows that matched. Zero means the
 * token was already used, revoked or expired, and the redemption stops there.
 */

const crypto = require("node:crypto");
const { db, schema, runWriteWithChanges } = require("../db/client");
const { eq, and, isNull, gt, desc } = require("drizzle-orm");
const { limitText } = require("../limits");
const { hashPassword, validatePassword } = require("./passwords");
const { recordSecurityEvent, EVENTS, OUTCOMES } = require("./securityAudit");
const sessionService = require("./sessionService");

/**
 * How long an issued token stays usable. Fifteen minutes is short enough that a
 * token sitting in a staff inbox is not a standing key, and long enough for a
 * student to walk to a device and type it. Override for tests and for a school that
 * hands tokens over only during office hours.
 */
const DEFAULT_RESET_TTL_MINUTES = 15;
const MIN_RESET_TTL_MINUTES = 1;
const MAX_RESET_TTL_MINUTES = 720;

/** Short enough that the admin panel shows the point of asking. */
const MAX_RESET_MESSAGE_CHARS = 500;

/**
 * Resolves the configured TTL.
 * @returns {number} milliseconds
 */
function resetTtlMs() {
  const raw = Number(process.env.PASSWORD_RESET_TTL_MINUTES);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_RESET_TTL_MINUTES * 60 * 1000;
  const minutes = Math.min(Math.max(Math.trunc(raw), MIN_RESET_TTL_MINUTES), MAX_RESET_TTL_MINUTES);
  return minutes * 60 * 1000;
}

/**
 * SHA-256 of the token. Only this is stored.
 * @param {string} token
 * @returns {string} lowercase hex
 */
function hashResetToken(token) {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

/**
 * Mints a token. The plaintext is returned here and nowhere else: the caller must
 * hand it to the student in the same request that created it.
 *
 * @returns {{token: string, tokenHash: string, expiresAt: number}}
 */
function generateResetToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashResetToken(token),
    expiresAt: Date.now() + resetTtlMs(),
  };
}

/**
 * Finds a user row by school ID. No creation: a reset must never invent an account
 * for an ID that does not exist.
 *
 * @param {string} studentId
 */
async function findUserByStudentId(studentId) {
  if (typeof studentId !== "string" || !studentId.trim()) return null;
  return db
    .select()
    .from(schema.users)
    .where(eq(schema.users.studentId, studentId.trim()))
    .get();
}

/**
 * A reset request from a student.
 *
 * Unexpirable from here: it is only ever resolved by an administrator, because
 * there is no one else who could object.
 *
 * @param {{studentId: string, message?: string, userId?: string|null}} entry
 * @returns {Promise<{id: string, status: string, alreadyPending: boolean}>}
 */
async function createResetRequest(entry) {
  const studentId = String(entry.studentId || "").trim();
  const message = limitText(entry.message, MAX_RESET_MESSAGE_CHARS).value;
  const now = new Date().toISOString();

  // One pending request per student. A repeat request is the same student asking
  // again, not a second conversation, and a row per attempt turns the admin queue
  // into something nobody reads.
  const existing = await db
    .select()
    .from(schema.passwordResetRequests)
    .where(eq(schema.passwordResetRequests.studentId, studentId))
    .orderBy(desc(schema.passwordResetRequests.createdAt))
    .get();

  if (existing && existing.status === "pending") {
    await db
      .update(schema.passwordResetRequests)
      .set({ message: message || existing.message, updatedAt: now })
      .where(eq(schema.passwordResetRequests.id, existing.id))
      .run();
    return { id: existing.id, status: "pending", alreadyPending: true };
  }

  const id = crypto.randomUUID();
  await db
    .insert(schema.passwordResetRequests)
    .values({
      id,
      studentId,
      userId: entry.userId || null,
      message: message || null,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return { id, status: "pending", alreadyPending: false };
}

/**
 * Every reset request, for the admin queue.
 *
 * @param {{status?: string, limit?: number, offset?: number}} [params]
 */
async function listResetRequests(params = {}) {
  const limit = Math.min(Math.max(Math.trunc(Number(params.limit) || 50), 1), 200);
  const offset = Math.max(Math.trunc(Number(params.offset) || 0), 0);

  const query = db.select().from(schema.passwordResetRequests);
  const filtered =
    params.status && params.status !== "all"
      ? query.where(eq(schema.passwordResetRequests.status, String(params.status)))
      : query;

  const rows = await filtered
    .orderBy(desc(schema.passwordResetRequests.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  // `userId` is resolved at decision time rather than at request time so that a
  // student who has never opened the app can still ask for help.
  return rows.map((row) => ({ ...row }));
}

/**
 * The requesting student's own requests. Ownership comes from the session, never
 * from the request body, so this cannot be pointed at another account by editing it.
 *
 * @param {{userId: string, studentId: string}} account
 */
async function listOwnResetRequests(account) {
  const rows = await db
    .select()
    .from(schema.passwordResetRequests)
    .where(eq(schema.passwordResetRequests.studentId, account.studentId))
    .orderBy(desc(schema.passwordResetRequests.createdAt))
    .limit(20)
    .all();

  return rows.map((row) => ({
    id: row.id,
    studentId: row.studentId,
    status: row.status,
    message: row.message,
    adminNote: row.adminNote,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    reviewedAt: row.reviewedAt,
  }));
}

/**
 * Issues a token for an account. The token is returned once and never stored.
 *
 * @param {{userId: string, requestId?: string|null, createdBy: string|null, studentId?: string|null}} entry
 */
async function issueResetToken({ userId, requestId = null, createdBy = null, studentId: _studentId = null }) {
  const { token, tokenHash, expiresAt } = generateResetToken();
  const now = new Date().toISOString();

  // Outstanding tokens are superseded, not accumulated: one useful token per
  // account means an old one found later is already dead.
  await db
    .update(schema.passwordResetTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(schema.passwordResetTokens.userId, userId),
        isNull(schema.passwordResetTokens.usedAt),
        isNull(schema.passwordResetTokens.revokedAt)
      )
    )
    .run();

  const id = crypto.randomUUID();
  await db
    .insert(schema.passwordResetTokens)
    .values({
      id,
      userId,
      requestId,
      tokenHash,
      expiresAt,
      createdBy,
      createdAt: now,
    })
    .run();

  return { id, token, expiresAt };
}

/**
 * Approves, rejects or revokes a reset request.
 *
 * "Approve" *is* the token issuance: the administrator approving a request is what
 * produces the credential, so it is one step rather than two, and the second step
 * is not a place where a token could be created without a decision recorded.
 *
 * @param {string} requestId
 * @param {"approve"|"reject"|"revoke"} action
 * @param {{adminUserId: string|null, adminLabel: string, note?: string}} admin
 * @returns {Promise<{ok: true, status: string, token?: string, expiresAt?: number}
 *   | {ok: false, code: string, error: string}>}
 */
async function decideResetRequest(requestId, action, admin) {
  const request = await db
    .select()
    .from(schema.passwordResetRequests)
    .where(eq(schema.passwordResetRequests.id, requestId))
    .get();

  if (!request) return { ok: false, code: "not_found", error: "That reset request no longer exists." };
  // Only an unresolved request can be acted on. A rejected or revoked one stays
  // that way, so an administrator cannot quietly flip it back by approving again.
  const resolvable = request.status === "pending" || request.status === "approved";
  if (!resolvable) {
    return {
      ok: false,
      code: "already_resolved",
      error: `That reset request was already ${request.status}.`,
    };
  }

  const user = await findUserByStudentId(request.studentId);
  const now = new Date().toISOString();
  const note = admin.note ? limitText(admin.note, 200).value : null;

  if (action === "reject") {
    await db
      .update(schema.passwordResetRequests)
      .set({
        status: "rejected",
        adminNote: note || request.adminNote,
        reviewedBy: admin.adminUserId,
        reviewedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.passwordResetRequests.id, request.id))
      .run();
    await recordSecurityEvent({
      event: EVENTS.PASSWORD_RESET_REJECTED,
      outcome: OUTCOMES.REFUSED,
      actorUserId: admin.adminUserId,
      actorLabel: admin.adminLabel,
      targetUserId: request.userId || user?.id || null,
      targetStudentId: request.studentId,
      detail: { requestId: request.id, reason: note || "rejected_by_administrator" },
    });
    return { ok: true, status: "rejected" };
  }

  if (action === "revoke") {
    // Revoking kills the tokens the request produced. Whether one was ever issued
    // changes nothing: the write is the same.
    await db
      .update(schema.passwordResetTokens)
      .set({ revokedAt: now })
      .where(
        and(
          eq(schema.passwordResetTokens.requestId, request.id),
          isNull(schema.passwordResetTokens.usedAt),
          isNull(schema.passwordResetTokens.revokedAt)
        )
      )
      .run();
    await db
      .update(schema.passwordResetRequests)
      .set({ status: "revoked", adminNote: note || request.adminNote, reviewedAt: now, updatedAt: now })
      .where(eq(schema.passwordResetRequests.id, request.id))
      .run();
    await recordSecurityEvent({
      event: EVENTS.PASSWORD_RESET_REVOKED,
      outcome: OUTCOMES.REFUSED,
      actorUserId: admin.adminUserId,
      actorLabel: admin.adminLabel,
      targetUserId: request.userId || user?.id || null,
      targetStudentId: request.studentId,
      detail: { requestId: request.id, reason: note || "revoked_by_administrator" },
    });
    return { ok: true, status: "revoked" };
  }

  // Approve.
  if (!user) {
    return {
      ok: false,
      code: "unknown_account",
      error:
        "No account exists for that school ID yet. The student must sign in once " +
        "before a password can be issued to them.",
    };
  }
  if (request.userId && request.userId !== user.id) {
    return {
      ok: false,
      code: "account_mismatch",
      error: "That request does not belong to the account it names.",
    };
  }

  const token = await issueResetToken({
    userId: user.id,
    requestId: request.id,
    createdBy: admin.adminUserId,
    studentId: request.studentId,
  });

  await db
    .update(schema.passwordResetRequests)
    .set({
      userId: user.id,
      status: "approved",
      adminNote: note || request.adminNote,
      reviewedBy: admin.adminUserId,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.passwordResetRequests.id, request.id))
    .run();

  await recordSecurityEvent({
    event: EVENTS.PASSWORD_RESET_APPROVED,
    outcome: OUTCOMES.SUCCESS,
    actorUserId: admin.adminUserId,
    actorLabel: admin.adminLabel,
    targetUserId: user.id,
    targetStudentId: request.studentId,
    detail: { requestId: request.id, tokenId: token.id },
  });

  return { ok: true, status: "approved", token: token.token, expiresAt: token.expiresAt };
}

/**
 * Starts a reset directly for an account, without a student request. This is the
 * path that gives a never-configured account its first password.
 *
 * @param {{studentId: string, note?: string}} entry
 * @param {{adminUserId: string|null, adminLabel: string}} admin
 */
async function initiateAdminReset(entry, admin) {
  const user = await findUserByStudentId(entry.studentId);
  if (!user) {
    return {
      ok: false,
      code: "unknown_account",
      error: "No account exists for that school ID yet. They must sign in once first.",
    };
  }

  const token = await issueResetToken({
    userId: user.id,
    requestId: null,
    createdBy: admin.adminUserId,
    studentId: user.studentId,
  });

  await recordSecurityEvent({
    event: EVENTS.PASSWORD_RESET_INITIATED,
    outcome: OUTCOMES.SUCCESS,
    actorUserId: admin.adminUserId,
    actorLabel: admin.adminLabel,
    targetUserId: user.id,
    targetStudentId: user.studentId,
    detail: {
      tokenId: token.id,
      note: entry.note || "administrator_initiated_reset",
      method: "administrator_initiated",
    },
  });

  return { ok: true, token: token.token, expiresAt: token.expiresAt, user };
}

/**
 * Gives back a claimed token so a failed redemption does not burn it.
 *
 * Only releases the exact claim this process made: if the write failed after the
 * claim, `usedAt` still holds the timestamp this call wrote.
 */
async function releaseResetClaim(tokenId, claimedAtIso) {
  try {
    await db
      .update(schema.passwordResetTokens)
      .set({ usedAt: null })
      .where(
        and(
          eq(schema.passwordResetTokens.id, tokenId),
          eq(schema.passwordResetTokens.usedAt, claimedAtIso)
        )
      )
      .run();
  } catch (err) {
    console.error("Failed to release a reset token claim:", err.message);
  }
}

/**
 * Redeems a token: claims it, sets the password, then revokes the account's
 * sessions, in that order.
 *
 * **Ordering, and why.** Claiming first means a token replayed in a race finds
 * `usedAt` already set and stops. The failure mode that ordering buys is
 * recoverable -- a token spent on a failed write leaves the student needing an
 * admin, never an attacker with a working token -- so it is bought deliberately,
 * and the compensating release below narrows it to the window between the claim
 * and the password write.
 *
 * @param {{token: string, newPassword: string}} entry
 */
async function redeemResetToken({ token, newPassword }) {
  const tokenHash = hashResetToken(String(token || ""));
  if (!tokenHash) return { ok: false, code: "invalid", error: "That reset link is not valid." };

  const row = await db
    .select()
    .from(schema.passwordResetTokens)
    .where(eq(schema.passwordResetTokens.tokenHash, tokenHash))
    .get();

  if (!row) {
    await recordSecurityEvent({
      event: EVENTS.PASSWORD_RESET_FAILED,
      outcome: OUTCOMES.REFUSED,
      detail: { reason: "unknown_token" },
    });
    return { ok: false, code: "invalid", error: "That reset link is not valid." };
  }

  const now = Date.now();
  if (row.revokedAt) return refusal(row, "revoked", "That reset link has been cancelled by an administrator.");
  if (row.expiresAt <= now) return refusal(row, "expired", "That reset link has expired. Ask an administrator for a new one.");
  if (row.usedAt) return refusal(row, "used", "That reset link has already been used. Ask an administrator for a new one.");

  const validation = validatePassword(newPassword);
  if (!validation.ok) {
    // Validated before the claim, so an invalid form never burns a token.
    return { ok: false, code: "invalid_password", error: validation.error };
  }

  const claimedAtIso = new Date().toISOString();
  const claim = db
    .update(schema.passwordResetTokens)
    .set({ usedAt: claimedAtIso })
    .where(
      and(
        eq(schema.passwordResetTokens.id, row.id),
        isNull(schema.passwordResetTokens.usedAt),
        isNull(schema.passwordResetTokens.revokedAt),
        gt(schema.passwordResetTokens.expiresAt, Date.now())
      )
    )
    .toSQL();

  const claimed = await runWriteWithChanges(claim);
  if (claimed !== 1) {
    return refusal(row, "already_claimed", "That reset link was already used. Ask an administrator for a new one.");
  }

  let passwordHash;
  try {
    // Revoke *before* replacing the credential, not after. Doing it the other way
    // round leaves a window where the new password is live and every session the
    // old one was good for still is -- the exact state this flow must not produce.
    // If the write below then fails, the client is logged out with an unchanged
    // password and a released token to try again with, which is recoverable.
    await sessionService.destroyAllUserSessions(row.userId, { rethrow: true });

    passwordHash = await hashPassword(newPassword);
    await db
      .update(schema.users)
      .set({ passwordHash, updatedAt: claimedAtIso })
      .where(eq(schema.users.id, row.userId))
      .run();
  } catch (err) {
    // The claim and the session revocation are the only things that happened.
    // Undo the claim so the student can try again with the same token rather than
    // needing the administrator for a problem that was ours.
    await releaseResetClaim(row.id, claimedAtIso);
    console.error("Password reset redemption failed:", err.message);
    return { ok: false, code: "server_error", error: "Could not set your password. Please try again." };
  }

  await recordSecurityEvent({
    event: EVENTS.PASSWORD_RESET_REDEEMED,
    outcome: OUTCOMES.SUCCESS,
    targetUserId: row.userId,
    detail: { tokenId: row.id, requestId: row.requestId || undefined, method: "reset_token" },
  });

  return { ok: true, userId: row.userId };
}

/** One refusal path for a token found but not usable. */
async function refusal(row, reason, message) {
  await recordSecurityEvent({
    event: EVENTS.PASSWORD_RESET_FAILED,
    outcome: OUTCOMES.REFUSED,
    targetUserId: row.userId,
    detail: { reason, tokenId: row.id },
  });
  return { ok: false, code: reason, error: message };
}

module.exports = {
  DEFAULT_RESET_TTL_MINUTES,
  MAX_RESET_MESSAGE_CHARS,
  hashResetToken,
  generateResetToken,
  resetTtlMs,
  findUserByStudentId,
  createResetRequest,
  listResetRequests,
  listOwnResetRequests,
  issueResetToken,
  decideResetRequest,
  initiateAdminReset,
  redeemResetToken,
};
