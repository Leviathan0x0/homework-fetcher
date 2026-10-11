-- Account security: per-device sessions and separately stored EduSecure credentials.
--
-- R13 gave MMSS64 a session and a password and nothing else. There was no way to see
-- which devices were signed in, no way to end one without knowing which token it was,
-- and one password doing two unrelated jobs: proving who you are to this app, and
-- proving who you are to a school portal that is about to be retired.
--
-- Conventions unchanged from 0001: INTEGER epoch-millisecond timestamps, enforced
-- foreign keys, no file bytes anywhere.

-- ---------------------------------------------------------------- sessions
--
-- Four columns, all additive, all nullable so the ALTER succeeds on the existing
-- table. SQLite cannot add a NOT NULL column without a constant default, and a
-- default of '' would collide under the unique index below, so the backfill assigns
-- real values instead.

-- A public, opaque identifier for the session, separate from `token_hash`.
--
-- `token_hash` is the verifier and must never leave the server; a client that wants
-- to revoke one of its sessions still needs something to name it. This is a second
-- 128-bit CSPRNG value, so knowing it is useless: revoking is authorised by the
-- caller's *own* session, never by possession of this id (see
-- `AccountSecurityService::revoke_session`, which filters on `user_id` as well).
ALTER TABLE sessions ADD COLUMN id TEXT;

-- When the session was last used, for the idle timeout and for the "last active"
-- column in the device list. Written at most once per activity window rather than on
-- every authenticated request -- see `sessions::touch`.
ALTER TABLE sessions ADD COLUMN last_used_at INTEGER;

-- Best-effort device label derived from the User-Agent at sign-in.
--
-- A User-Agent is a self-reported string, so this is a hint for the person reading
-- the list ("is that my old phone?"), never an identity. It is not used for any
-- access decision and it is not unique.
ALTER TABLE sessions ADD COLUMN device_label TEXT;

-- Backfill: every live row gets a distinct public id and starts its idle clock at
-- the moment it was created, so upgrading the process does not immediately expire
-- anybody's session, and no row is left unnameable in the device list.
--
-- **Read this before deploying.** Anchoring the idle clock at `created_at` means a
-- session that has genuinely not been used for longer than `SESSION_IDLE_DAYS` (7 by
-- default) is expired the first time it is presented after the upgrade. That is the
-- idle policy working as specified, not a bug -- but on a database whose oldest
-- sessions are already past the window it looks exactly like a mass logout. Raise
-- `SESSION_IDLE_DAYS` for the deploy if a soft landing matters more than a strict
-- idle policy. Sessions are never expired by the migration itself; they are refused on
-- use, and the row is deleted at that point.
UPDATE sessions SET id = lower(hex(randomblob(16))) WHERE id IS NULL;
UPDATE sessions SET last_used_at = created_at WHERE last_used_at IS NULL;

-- The device list reads "this user's live sessions, newest activity first".
-- `idx_sessions_user` from 0002 already serves the user_id half; this covers the
-- ordering without a sort.
CREATE INDEX idx_sessions_user_activity ON sessions (user_id, last_used_at DESC);

-- Revoking by public id is a primary-key-style lookup, but the caller's own user_id
-- is always part of the predicate, so `idx_sessions_user` serves it and this index
-- exists only to make `id` itself unique and therefore safe to expose.
CREATE UNIQUE INDEX idx_sessions_id ON sessions (id) WHERE id IS NOT NULL;

-- ------------------------------------------------------- EduSecure credentials
--
-- The credential the backend uses to talk to the school portal, kept *separately*
-- from the MMSS64 password so the two can be rotated independently and so neither
-- has to be derived from the other.
--
-- `ciphertext` is AES-256-GCM, not a hash: a hash would be verifiable but not
-- recoverable, and fetching homework needs the portal to accept the actual
-- password. The key comes from `CREDENTIAL_ENCRYPTION_KEY`, which is held outside
-- the database; a deployment without one refuses to store a credential rather than
-- writing plaintext here.
CREATE TABLE edusecure_credentials (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    -- `v1.<hex nonce>.<hex ciphertext||tag>`. The version prefix is what lets a
    -- future scheme change decrypt rather than fail silently.
    ciphertext TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Nothing reads this table by any path other than "the one user", which is the
-- primary key. No secondary index: the single access path is already covered.