-- The EduSecure publication ledger.
--
-- MMSS64 is the source of truth for homework. This table records what has been *pushed*
-- to the school portal, and nothing about it is authoritative: a row here can be deleted
-- or marked failed without any effect on the homework it refers to.
--
-- It exists for three reasons the `homework` table cannot serve:
--   * duplicate prevention -- `homework_id` is the primary key, so one local entry maps to
--     at most one publication attempt chain and a second publish is a no-op;
--   * retry -- a failed attempt is kept with its error rather than discarded, so the
--     transition can be finished later;
--   * an audit trail -- "was this published, when, and what did the portal say".
--
-- Timestamps follow the R1-R2 convention: INTEGER Unix epoch milliseconds.
--
-- `ON DELETE CASCADE` means deleting the entry removes its publication record too, which is
-- correct: a publication for homework that no longer exists is meaningless.

CREATE TABLE edusecure_publications (
    -- One publication chain per local entry.
    homework_id INTEGER PRIMARY KEY REFERENCES homework(id) ON DELETE CASCADE,
    -- 'pending'   recorded, not yet attempted
    -- 'published' the portal accepted it; `external_id` holds its identifier
    -- 'failed'    the portal refused or was unreachable; `last_error` says why
    status      TEXT    NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'published', 'failed')),
    -- Whatever the portal calls this entry, when it called it that. NULL for our own
    -- entries, which the portal may accept without minting an id.
    external_id TEXT,
    -- Why the last attempt failed. Capped in the service layer, and never an internal
    -- database detail.
    last_error  TEXT,
    -- Incremented on every attempt, successful or not, so a repeated failure is visible.
    attempts    INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

-- "Everything still waiting to be pushed", for a batch job or an operator screen. Partial,
-- so the common lookup -- the rows that are not done -- does not scan published history.
CREATE INDEX idx_edusecure_publications_pending
    ON edusecure_publications (status, updated_at);

-- No index on homework_id: it is the primary key.