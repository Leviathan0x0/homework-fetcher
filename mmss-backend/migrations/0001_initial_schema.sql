-- MMSS64 core schema.
--
-- MMSS64 is the source of truth. EduSecure (or any other school portal) is an
-- integration that writes into these tables; nothing below is portal-specific.
--
-- Conventions, applied uniformly:
--   * Primary keys are INTEGER rowids. External school identifiers live in
--     their own UNIQUE column (users.school_id) and are never used as keys.
--   * Timestamps are INTEGER Unix epoch milliseconds (UTC), always written by
--     the repository layer. One format, no text timestamps.
--   * Calendar dates are TEXT 'YYYY-MM-DD' so they sort and range-scan.
--   * Foreign keys are enforced: the pool opens with PRAGMA foreign_keys = ON.
--
-- The seven tables here belong together -- each is referenced by the others and
-- none is useful alone -- so they ship as one initial migration.

CREATE TABLE classes (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL UNIQUE, -- school section label, e.g. '9-F'
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE subjects (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE users (
    id           INTEGER PRIMARY KEY,
    -- External school login / roll number, stored exactly as the school issued
    -- it. The internal key stays an integer so renumbering is not a migration.
    school_id    TEXT    NOT NULL UNIQUE,
    display_name TEXT,
    role         TEXT    NOT NULL DEFAULT 'student'
                 CHECK (role IN ('student', 'teacher', 'admin')),
    -- NULL only for accounts that genuinely have no class (staff, admin).
    class_id     INTEGER REFERENCES classes(id) ON DELETE RESTRICT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);

-- A diary/assignment entry. Class-level, not per student: the same entry is one
-- row for the whole section.
CREATE TABLE homework (
    id            INTEGER PRIMARY KEY,
    class_id      INTEGER NOT NULL REFERENCES classes(id)   ON DELETE RESTRICT,
    subject_id    INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    -- The teacher who wrote the entry. NULL means no known author, which is the
    -- normal case for a diary entry imported from a school portal; deleting a
    -- teacher must not delete the homework they wrote.
    author_id     INTEGER          REFERENCES users(id)     ON DELETE SET NULL,
    -- 'YYYY-MM-DD', guarded so a display string like 'Jul 23, 2026' can never
    -- get back in. The CHECK fixes the shape, not the calendar: a month of 99
    -- still passes, so the importer is responsible for parsing.
    due_date      TEXT    NOT NULL
                  CHECK (due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    -- Homework and classwork are separate values on one entry, not one blob.
    -- Either may be absent, but an entry with neither is meaningless.
    homework_text TEXT CHECK (homework_text IS NULL OR length(trim(homework_text)) > 0),
    classwork_text TEXT CHECK (classwork_text IS NULL OR length(trim(classwork_text)) > 0),
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    CHECK (length(trim(coalesce(homework_text, ''))) > 0
        OR length(trim(coalesce(classwork_text, ''))) > 0)
);

CREATE TABLE attachments (
    id          INTEGER PRIMARY KEY,
    homework_id INTEGER NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
    filename    TEXT    NOT NULL,
    mime_type   TEXT    NOT NULL,
    size_bytes  INTEGER NOT NULL CHECK (size_bytes >= 0),
    -- Relative path or object-storage key. File bytes never live in SQLite, so
    -- a storage backend added later only has to resolve this key.
    storage_key TEXT    NOT NULL,
    created_at  INTEGER NOT NULL
);

CREATE TABLE notes (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    -- NULL homework_id = a note about the user in general rather than one entry.
    homework_id INTEGER          REFERENCES homework(id) ON DELETE CASCADE,
    body        TEXT    NOT NULL CHECK (length(trim(body)) > 0),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    -- At most one note per user per entry. SQLite ignores NULLs in a UNIQUE
    -- index, so user-scoped notes are deliberately not deduplicated.
    UNIQUE (user_id, homework_id)
);

CREATE TABLE homework_progress (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    homework_id INTEGER NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
    completed   INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    UNIQUE (user_id, homework_id)
);

-- Indexes, one per known access path.
--
-- * Class feed and the Today / Recent / Calendar views all read
--   "this class, ordered by school day", so (class_id, due_date) is the hot
--   index and also serves the class-only lookup as its leftmost prefix.
CREATE INDEX idx_homework_class_due ON homework (class_id, due_date);
-- Subject filter, e.g. the subject combobox across a class.
CREATE INDEX idx_homework_subject ON homework (subject_id);
-- School-day lookups that are not class-scoped (admin reporting, calendar).
CREATE INDEX idx_homework_due ON homework (due_date);
-- "Homework I wrote", and it keeps the ON DELETE SET NULL above cheap.
CREATE INDEX idx_homework_author ON homework (author_id);
-- Attachments for one entry.
CREATE INDEX idx_attachments_homework ON attachments (homework_id);
--
-- Already indexed, no extra index needed:
--   users (school_id), classes (name), subjects (name)  -- UNIQUE constraints.
--   notes (user_id, homework_id), homework_progress (user_id, homework_id)
--     -- the UNIQUE constraints, whose leftmost prefix is user_id.
