-- Which classes a teacher may manage.
--
-- A teacher is not a member of one class the way a student is. `users.class_id`
-- stays NULL for staff, and teaching duties live here instead, so one teacher
-- can cover several sections and one section can have several teachers.
--
-- This table is also the authorization source for the teacher API: creating
-- homework for a class, and seeing a class's homework at all, both mean "a row
-- exists here". Nothing else decides who may teach what.
--
-- Conventions unchanged from 0001: INTEGER epoch-millisecond timestamps,
-- enforced foreign keys, and a composite primary key so the same pair can
-- never be recorded twice.

CREATE TABLE teacher_classes (
    teacher_id INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    class_id   INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    -- The composite key is the whole duplicate-prevention story: two inserts of
    -- the same assignment collide on the key instead of both succeeding.
    PRIMARY KEY (teacher_id, class_id)
);

-- "Who teaches this class", which is the same question asked from the other
-- side: a teacher's timetable, or which teachers a class's parents can contact.
-- The primary key serves the teacher -> classes direction.
CREATE INDEX idx_teacher_classes_class ON teacher_classes (class_id);

-- The role invariant, honestly stated.
--
-- "teacher_id must belong to a user with role = 'teacher'" is NOT expressible as
-- a CHECK here: a SQLite CHECK constraint may only reference columns of the row
-- being checked, never another table, so `role` from `users` is out of reach.
-- Two options were available and a trigger was chosen:
--
--   * check it in the service layer -- smaller, but only holds for callers that
--     remember to call that service, and the future admin management CRUD
--     (deliberately deferred) would be exactly such a caller;
--   * check it here -- holds for every writer, including test fixtures and the
--     `sqlite3` CLI, because there is only one door into this table.
--
-- The trade-off is that the failure surfaces as a sqlx error (and therefore a
-- logged 500 with a flat body) rather than a 400. Nothing in the current API
-- writes this table, so no client can reach it; if the admin CRUD lands, it
-- should surface the cause as a 400 at that point.
--
-- A user changing role *after* being assigned is not covered -- that would need
-- a trigger on `users`, and changing a teacher's role is an admin decision
-- (also deferred) rather than a self-service one.
CREATE TRIGGER trg_teacher_classes_role_insert
BEFORE INSERT ON teacher_classes
WHEN NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.teacher_id AND role = 'teacher'
)
BEGIN
    SELECT RAISE(ABORT, 'teacher_classes.teacher_id must reference a user with role teacher');
END;

CREATE TRIGGER trg_teacher_classes_role_update
BEFORE UPDATE OF teacher_id ON teacher_classes
WHEN NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.teacher_id AND role = 'teacher'
)
BEGIN
    SELECT RAISE(ABORT, 'teacher_classes.teacher_id must reference a user with role teacher');
END;

-- Dev path, until the admin management CRUD exists. Assignments are created by
-- test fixtures and by this statement; nothing else writes the table.
--
--   INSERT INTO teacher_classes (teacher_id, class_id, created_at)
--   VALUES ((SELECT id FROM users WHERE school_id = 'teacher.a'), 1, 1760000000000);