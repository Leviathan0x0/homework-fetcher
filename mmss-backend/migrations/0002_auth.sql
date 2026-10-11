-- Authentication: server-side sessions and local password credentials.
--
-- Both tables exist because MMSS64 authenticates people, not passwords. A session
-- row is a revocable grant; a credential row is only present for accounts this
-- deployment verifies itself, so "has local credentials" is an existence fact
-- rather than a nullable column that has to be special-cased on every read.
--
-- Timestamps follow the R2 convention: INTEGER Unix epoch milliseconds.
-- Session tokens are opaque 256-bit random values; see services::auth for why the
-- cookie value is never stored.

CREATE TABLE sessions (
    -- SHA-256 of the cookie value, not the cookie value. A database dump therefore
    -- yields nothing an attacker can present as a session.
    token_hash  TEXT    PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
);

-- Session lookup is by token, so the primary key covers it. These two serve the
-- remaining access paths: "every session this user has", so a password change or a
-- staff action can revoke all devices at once, and expiry sweeps that run on a
-- schedule rather than only when a dead cookie happens to arrive.
CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

CREATE TABLE credentials (
    -- One row per locally-credentialed account. Accounts authenticated by an
    -- external school portal have no row here at all.
    user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    -- PHC string (argon2id, per-hash random salt and parameters). Never a
    -- plaintext password, never a bare digest.
    password_hash TEXT    NOT NULL,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);
