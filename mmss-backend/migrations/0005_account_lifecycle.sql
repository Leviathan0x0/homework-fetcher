-- Account lifecycle: explicit active state, setup tokens, and an audit trail.
--
-- R11 could enrol accounts but could not take any of them away. There was no way to
-- say "this student has left", no way to give a new student a password without the
-- school first inventing one, and no record of who did what. R12 adds exactly those
-- three things and nothing else.
--
-- Conventions unchanged from 0001: INTEGER epoch-millisecond timestamps, enforced
-- foreign keys, no file bytes anywhere.

-- The explicit state R11 lacked.
--
-- `NOT NULL DEFAULT 1` so every existing row is active without a data migration, and
-- so a future insert that forgets to mention it produces a working account rather
-- than a NULL that every query has to special-case. Deliberately a flag rather than a
-- deleted row: deactivating must not take a student's notes and homework progress with
-- it, which `users::delete` would (it cascades).
ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1
    CHECK (is_active IN (0, 1));

-- Sessions are looked up by token, so the primary key covers it.
--
-- `token_hash` is a SHA-256 digest and never the token. A dump of this table therefore
-- contains nothing an attacker can paste into the setup endpoint, exactly as R3
-- already does for `sessions`.
--
-- `used_at` is what makes a token single-use, and setting it is what the setup
-- endpoint does in the same statement that consumes it -- so two concurrent
-- submissions cannot both see an unused token. `expires_at` is enforced by the
-- service; it is stored rather than computed so the deadline is visible to an
-- operator inspecting the table.
CREATE TABLE setup_tokens (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER
);

-- The "who did this, and when" trail.
--
-- Account lifecycle actions are consequential and mostly performed out of band -- a
-- student leaves, a new one is enrolled -- so without this the only answer to "why
-- can't this student sign in" is a guess. `actor` is the school ID of whoever did it,
-- or the literal `cli` for an operator action, which is deliberately a distinct value
-- rather than a null so "nobody" is never recorded as if a person had.
--
-- `detail` is free text from an operator (a reason for a deactivation) and is bounded
-- and stripped of control characters by the service. Nothing secret may be written
-- here: a password or a token in this column would outlive the request that carried
-- it, and this table is the one place an operator would plausibly go looking.
CREATE TABLE account_events (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL,
    actor      TEXT    NOT NULL,
    detail     TEXT,
    created_at INTEGER NOT NULL
);

-- The two questions an operator actually asks of this table: "what happened to this
-- account" and "what has this deployment done recently".
CREATE INDEX idx_account_events_user ON account_events (user_id);
CREATE INDEX idx_account_events_recent ON account_events (created_at);

-- Deactivated accounts are rare and always named in a report, so the index exists for
-- the sessions query rather than for a listing endpoint.
CREATE INDEX idx_users_inactive ON users (is_active) WHERE is_active = 0;