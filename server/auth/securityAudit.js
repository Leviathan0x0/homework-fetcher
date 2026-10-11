"use strict";

/**
 * Security audit trail.
 *
 * Every security-relevant event lands in one table: a password changed, sessions
 * revoked, a reset requested, approved, redeemed, refused. The events themselves are
 * the point -- who touched which account, when, and what happened.
 *
 * # Why `detail` is allowlisted
 *
 * The rule for this table is that a secret never reaches it: no password, no hash,
 * no reset token, no EduSecure cookie, no encryption key. Relying on every future
 * caller to remember that is a promise, not a mechanism. So `detail` accepts only
 * these keys, and every value is coerced to a string and length-capped before it is
 * bound. A caller passing `{ password }`, `{ token }` or `{ hash }` gets nothing
 * written for it, which fails silently in the safest direction.
 */

const crypto = require("node:crypto");
const { db, schema } = require("../db/client");
const { desc } = require("drizzle-orm");

/** Every event this module will write. Anything else is a bug in the caller. */
const EVENTS = Object.freeze({
  PASSWORD_CHANGED: "password_changed",
  PASSWORD_RESET_REQUESTED: "password_reset_requested",
  PASSWORD_RESET_APPROVED: "password_reset_approved",
  PASSWORD_RESET_REJECTED: "password_reset_rejected",
  PASSWORD_RESET_REVOKED: "password_reset_revoked",
  PASSWORD_RESET_INITIATED: "admin_password_reset_initiated",
  PASSWORD_RESET_REDEEMED: "password_reset_redeemed",
  PASSWORD_RESET_FAILED: "password_reset_failed",
  SESSIONS_REVOKED: "sessions_revoked",
  ENROLLMENT_REFUSED: "password_enrollment_refused",
});

const OUTCOMES = Object.freeze({
  SUCCESS: "success",
  REFUSED: "refused",
  FAILED: "failed",
});

/**
 * The only keys allowed into `detail`, with the type each is coerced to.
 *
 * Nothing here is secret-derived, and that is the whole purpose: a key someone
 * might reasonably reach for to record a credential is simply absent.
 */
const DETAIL_SCHEMA = Object.freeze({
  requestId: "text",
  tokenId: "text",
  reason: "text",
  note: "text",
  method: "text",
  source: "text",
  expiresAt: "text",
  sessionsRevoked: "number",
});

/** Cap on any single detail value, so one verbose note cannot bloat the row. */
const MAX_DETAIL_CHARS = 200;
const MAX_DETAIL_KEYS = 6;

/**
 * Picks the allowed keys out of `detail`, coercing and capping each value.
 *
 * @param {Record<string, unknown>} [detail]
 * @returns {string|null} JSON, or null when nothing was usable
 */
function sanitizeDetail(detail) {
  if (!detail || typeof detail !== "object") return null;
  const clean = {};
  for (const [key, raw] of Object.entries(detail)) {
    // The cap is on what gets stored, so a fifty-key payload loses tail entries
    // rather than being rejected whole.
    if (Object.keys(clean).length >= MAX_DETAIL_KEYS) break;
    const type = DETAIL_SCHEMA[key];
    if (!type) continue;
    if (raw === undefined || raw === null) continue;
    if (type === "number") {
      if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
      clean[key] = Math.trunc(raw);
    } else if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      clean[key] = String(raw).slice(0, MAX_DETAIL_CHARS);
    }
  }
  return Object.keys(clean).length ? JSON.stringify(clean) : null;
}

/**
 * Writes one audit event. Never throws: losing a log line must not fail the
 * request whose effect it was recording, and a student's password change is more
 * important than the record of it.
 *
 * @param {{
 *   event: string,
 *   outcome?: string,
 *   actorUserId?: string|null,
 *   actorLabel?: string|null,
 *   targetUserId?: string|null,
 *   targetStudentId?: string|null,
 *   detail?: Record<string, unknown>,
 * }} entry
 */
async function recordSecurityEvent(entry) {
  if (!entry || typeof entry.event !== "string" || !entry.event) return;
  try {
    await db
      .insert(schema.securityAuditLog)
      .values({
        id: crypto.randomUUID(),
        event: entry.event,
        outcome: typeof entry.outcome === "string" ? entry.outcome : OUTCOMES.SUCCESS,
        actorUserId: entry.actorUserId || null,
        actorLabel: typeof entry.actorLabel === "string" ? entry.actorLabel.slice(0, 200) : null,
        targetUserId: entry.targetUserId || null,
        targetStudentId:
          typeof entry.targetStudentId === "string" ? entry.targetStudentId.slice(0, 64) : null,
        detail: sanitizeDetail(entry.detail),
        createdAt: new Date().toISOString(),
      })
      .run();
  } catch (err) {
    console.error("Failed to write security audit event:", err.message);
  }
}

/**
 * One page of audit rows, newest first. Returns the stored view only: the `detail`
 * JSON is parsed back to an object that still contains nothing secret-bearing.
 *
 * @param {{limit?: number, offset?: number}} [params]
 */
async function listSecurityAudit(params = {}) {
  const limit = Math.min(Math.max(Math.trunc(Number(params.limit) || 50), 1), 200);
  const offset = Math.max(Math.trunc(Number(params.offset) || 0), 0);

  const rows = await db
    .select()
    .from(schema.securityAuditLog)
    .orderBy(desc(schema.securityAuditLog.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  return rows.map((row) => {
    let detail = null;
    if (row.detail) {
      try {
        detail = JSON.parse(row.detail);
      } catch {
        detail = null;
      }
    }
    return {
      id: row.id,
      event: row.event,
      outcome: row.outcome,
      actorUserId: row.actorUserId,
      actorLabel: row.actorLabel,
      targetUserId: row.targetUserId,
      targetStudentId: row.targetStudentId,
      detail,
      createdAt: row.createdAt,
    };
  });
}

module.exports = {
  EVENTS,
  OUTCOMES,
  sanitizeDetail,
  recordSecurityEvent,
  listSecurityAudit,
};
