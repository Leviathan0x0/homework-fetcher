# Phase 5 — teacher API audit (reference: current Next.js frontend + old Express API)

Sources: `server/routes/teacherRoutes.js`, `server/teacher/teacherService.js`,
`server/auth/requireAuth.js`, `server/auth/sessionService.js`,
`server/routes/adminRoutes.js`, `server/db/schema.js`,
`src/services/api.ts`, `src/components/{TeacherView,AppShell}.tsx`.
The frontend and the old backend were **not modified**.

## The single most important finding

**Teachers do not currently use MMSS64.**

The old teacher surface is a demo scaffold, not a working product:

* The only way to sign in as a teacher is `TEACHER_TEST_USERNAME` /
  `TEACHER_TEST_PASSWORD` read from the environment
  (`teacherService.testTeacherCredentials`). With no password set the account is
  disabled and the login refuses. There is no teacher provisioning, no teacher
  credential table, no way for an admin to create a usable teacher account.
* `testTeacherUser()` synthesizes an identity whose id is
  `test-teacher-<sha256(username)[0..16]>` — a hash of a username, not a row in
  `users`. It has `role: "teacher"` and `section: "Staff"`.
* A teacher's teaching duties come from `profileFromEnvironment()` defaults
  (`TEACHER_TEST_SUBJECTS`, `TEACHER_TEST_SECTIONS`,
  `TEACHER_TEST_CLASS_TEACHER_SECTIONS`, defaulting to Mathematics/Science and
  section `9-C`) unless an admin has written a `teacher_profiles` row.

So **no legacy compatibility requirements exist for the teacher API.** This is the
exact opposite of Phase 4, where preserving the contract the shipped student frontend
actually calls was the entire point — see `STUDENT_API_AUDIT.md`. Here there is no
contract to preserve: nothing outside this scaffold reads the new API, so the design
below optimizes for the final structured workflow only.

Honest caveat, since it cuts slightly against the premise above: a teacher UI *does*
exist. `src/components/TeacherView.tsx` is lazy-loaded by `AppShell` and calls roughly
twenty `/api/teacher/*` endpoints (dashboard, roster, assignments, attendance,
duties, announcements, leave, parents, student notes). It is a real screen with real
widgets. What is missing is everything behind it — real accounts, and any way to
*change* work once created (see below). The screen is reachable; the workflow is not
usable by an actual teacher.

## What teacher and admin concepts exist today

| Concept | Old representation | Where |
| --- | --- | --- |
| Teacher identity | `users.role`, values seen in the wild: `student`, `teacher`, `class_teacher`, `admin` | `users` |
| Admin identity | `users.role = 'admin'`, **or** `users.student_id === 'admin_mmss'` | `teacherRoutes.isAdmin` |
| Teaching duties | `teacher_profiles.subjects` / `.assigned_sections` / `.class_teacher_sections` — **JSON-array `TEXT`, `NOT NULL DEFAULT '[]'`**, read back through `parseList()` | `server/db/schema.js:348` |
| Teacher-authored work | `teacher_assignments` (`subject` free text, `title`, `content`, `attachment_url`, `due_date` free text) | `schema.js:361` |
| Fan-out to students | `teacher_assignment_targets` — one row **per student**, materialised at creation time, with `status`/`submission_text`/`submitted_at` | `schema.js:380` |
| Assignment attachments | `teacher_assignment_attachments` — `data TEXT NOT NULL`, base64 data URLs **in the database** | `schema.js:400` |
| Teacher notes about a student | `teacher_student_notes` (`teacher_user_id`, `student_id`, `note`) | `schema.js:415` |
| Grades | `teacher_grades`, keyed to a *target* row rather than to a student | `schema.js:431` |
| Attendance | `attendance_sessions` / `attendance_records`, both section-string keyed | `schema.js:446` |
| Duties / announcements | `teacher_duties`, `teacher_announcements`, both section-string keyed | `schema.js:478`, `498` |
| Leave | `leave_requests`, section-string keyed | used by `teacherRoutes` |
| Where profiles are written | `PUT /api/admin/teachers/:id/profile`, admin-gated — the **only** assignment-admin surface | `adminRoutes.js:261` |

## What the old authorization actually enforced

Stated precisely, because the difference matters and it would be easy to overstate:

1. **`requireAuth` on every teacher route** (`router.use(requireAuth)`), resolving the
   `app_session` cookie or an `Authorization: Bearer` header to a session.
2. **An inline role-string comparison.** `requireTeacher` is
   `req.user.role === "admin" || isTeacher(req.user)`, where `isTeacher` accepts
   `role === "teacher" || role === "class_teacher"`. Anything else is 403. Note that
   `admin` passes `requireTeacher` and is then separately re-checked by `isAdmin`,
   which also honours the magic `studentId === "admin_mmss"` string. Admins are
   therefore *not* cleanly separated from teachers in the old code; the two are
   distinguished by scattered ad-hoc predicates rather than by an extractor.
3. **A section-membership check on `POST /api/teacher/assignments`**, comparing the
   requested `sections` against `profile.assignedSections`, unless `isAdmin`.
   This is the one real authorization decision in the file.
4. **One genuine ownership check**, on `PATCH /api/teacher/duties/:id`, which is scoped
   by `assignedBy === req.user.id`.

What is **not** enforced, confirmed by grepping `teacherRoutes.js`:

* **`schema.homework` is never referenced by `teacherRoutes.js` at all.** The scraped
  diary table is unreachable from the teacher API. Teachers and admins in the old
  system cannot read or write diary entries through these routes.
* **No route can edit or delete a teacher assignment.** The registered assignment
  routes are `GET /assignments`, `POST /assignments`,
  `GET /assignments/:id/submissions`, plus the student-facing
  `GET /assignments/student` and `POST /assignments/:targetId/submit`. There is no
  `PATCH /assignments/:id` and no `DELETE /assignments/:id`. A teacher can publish
  homework and then never amend or withdraw it.
* **No check anywhere ties a teacher to the class of work they read.** `GET
  /assignments` is filtered only by `teacherUserId = req.user.id`, which is an
  authorship filter wearing the clothes of an authorization filter. `GET
  /assignments/:id/attachment` falls through to `assignment.teacherUserId !== req.user.id && !isAdmin(req.user)`, which is again authorship plus an admin escape hatch.
* **Attendance, duties, announcements and leave authorize on a free-text section
  string** (`profile.classTeacherSections.includes(section)`) rather than on any
  referential relationship. `POST /api/teacher/attendance` also silently drops records
  whose `studentId` is not in the roster it just loaded, rather than rejecting.
* `GET /api/teacher/roster` filters requested sections by
  `profile.assignedSections.includes(section) || isAdmin(req.user)` and then loads
  *every user* in those sections and filters `role === "student"` in JavaScript.

## Legacy: what this phase deliberately does not reproduce

* **JSON-array columns.** `teacher_profiles.subjects`, `.assigned_sections` and
  `.class_teacher_sections` are `TEXT` holding a JSON array, defaulting to `'[]'`,
  serialised with `JSON.stringify` and read back with `parseList()` — which, on a
  parse failure, silently falls back to splitting on commas. Membership is a substring
  test in JavaScript, so `assignedSections.includes("9-C")` is a linear scan with no
  index, no foreign key, and no referential integrity: a section renamed in
  `teacher_profiles` and one in `users.section` are two unrelated strings that must be
  kept in sync by hand. R5 replaces this with a real join table. This was already
  recorded in `AUDIT.md` ("JSON-array columns → proper join tables, when those features
  land"); R5 is when they land.
* **`ensureTeacherProfile` auto-creates an empty profile.** Any user who reaches
  `GET /api/teacher/profile` gets a fresh row with three empty arrays if they had none,
  and is then refused every section. Provisioning is implicit and self-healing in a way
  that makes "assigned to nothing" indistinguishable from "never configured".
* **A parallel homework concept.** `teacher_assignments` +
  `teacher_assignment_targets` + `teacher_assignment_attachments` is a second,
  independent answer to "what work does this class have". A student's diary feed and a
  teacher's assignment list are two views of two different tables, and a student sees
  the teacher's work only because the student-side view happens to have its own
  `/api/teacher/assignments/student` feed. R5 collapses this into the single R2
  `homework` table with `author_id`.
* **Per-student fan-out rows.** `teacher_assignment_targets` materialises one row per
  student at creation time, so the assignment's audience is a frozen snapshot: a student
  who joins the section afterwards never receives it. R5 stores class-level rows and
  derives visibility, which is what makes "teacher writes → student sees" automatic
  rather than a second code path.
* **Free-text `subject` and `due_date` on assignments.** `subject` is `TEXT` with no
  referential check and `due_date` is unvalidated text — the same "Jul 23, 2026" class
  of problem R2 removed from `homework`.
* **Base64 bytes in SQLite.** `teacher_assignment_attachments.data` holds a data URL,
  capped at 8 MB by `normalizeAttachment` in application code. R2's rule — bytes never
  in SQLite, metadata and a `storage_key` only — is preserved.
* **`teacher_student_notes` is a different relationship and is not implemented.** A
  teacher writing a private note *about an individual student* is user→user, not
  class→work, and it needs its own visibility question. R5 does not touch it. `AUDIT.md`
  already deferred it to "the teacher phase"; it remains deferred *past* R5, because
  the brief for R5 is specifically structured homework creation.
* `teacher_grades`, `attendance_*`, `teacher_duties`, `teacher_announcements`,
  `leave_requests`: all untouched by R5. Attendance additionally depends on EduSecure
  (explicitly out of scope).

## What R5 does differently

### Assignment schema

`migrations/0003_teacher_classes.sql`:

```sql
CREATE TABLE teacher_classes (
    teacher_id INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    class_id   INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (teacher_id, class_id)
);
CREATE INDEX idx_teacher_classes_class ON teacher_classes (class_id);
```

The composite primary key is the whole duplicate-prevention story: a repeated insert
collides on the key instead of both succeeding. The primary key serves the
teacher→classes direction; the extra index serves the reverse "who teaches this class"
lookup, which the primary key cannot provide. Both foreign keys cascade, so deleting a
teacher or a class leaves no orphaned assignment and needs no cleanup code.

`users.class_id` is untouched and remains a **student's** class. It is never
reinterpreted as a teacher assignment; `testTeacherUser()`'s `section: "Staff"` and
the old `role: 'class_teacher'` distinction have no analogue in the new model.

### The role invariant, honestly

**"teacher_id must belong to a user with `role = 'teacher'`" is not expressible as a
SQLite `CHECK`.** A `CHECK` constraint may only reference columns of the row being
checked, never another table, so `users.role` is out of reach. Two options existed:

* enforce it in the service layer — smaller, but it holds only for callers who
  remember to call that service, and the deferred admin management CRUD is exactly
  such a caller;
* enforce it in the schema — holds for **every** writer, including test fixtures and
  the `sqlite3` CLI, because there is only one door into the table.

A trigger was chosen (`trg_teacher_classes_role_insert` on `BEFORE INSERT`,
`trg_teacher_classes_role_update` on `BEFORE UPDATE OF teacher_id`, both
`RAISE(ABORT, …)`).

Two gaps, stated rather than papered over:

1. The failure surfaces as a `sqlx` error, therefore a logged 500 with a flat body,
   not a 400 naming the field. Nothing in the current API writes this table, so no
   client can reach it; when the admin CRUD lands it should translate the cause to a
   400 at that boundary.
2. **A user whose role changes *after* being assigned is not covered.** That would need
   a trigger on `users`, and changing a teacher's role is an admin decision (also
   deferred) rather than a self-service one.

### Authorization rules

Everything below is server-side and derived from the authenticated session plus the
database.

| Case | Result | Enforced in |
| --- | --- | --- |
| teacher A → create for class A | allowed | `teacher_classes.teaches` |
| teacher A → create for class B | **403** | `teacher_classes.teaches` |
| teacher A → read own homework | allowed | `Actor::may_manage` / `find_readable` |
| teacher A → read teacher B's homework in a class A teaches | allowed | `find_readable` |
| teacher A → read teacher B's homework in an untaught class | **404** | `find_readable` |
| teacher A → edit/delete teacher B's homework | **403** | `Actor::may_manage` |
| admin → read/edit/delete any homework | allowed | `Actor::Admin` |
| student → any teacher route | **403** | `Actor::of` |
| anonymous | **401** | `auth.rs` extractor |
| forged `authorId` / `teacherId` / `role` | never wins | not deserializable |

`classId` in a body or query string is the **target resource, not a credential**. It is
checked against `teacher_classes`, never obeyed; naming a class you do not teach is
refused rather than silently answered with your own classes, because quietly answering
a different question than the one asked is how data-leak bugs stay invisible.

On create, `author_id` is unconditionally `principal.user_id`. `CreateHomeworkBody` has
no `authorId` or `teacherId` field at all, so a forged author is **unrepresentable**
rather than merely ignored — there is no code path where a body value competes with the
session and then loses.

An unassigned teacher listing homework gets an **empty list**, never "no restriction".
This is the mirror image of the R4 rule where a missing class meant no access: without
it, an empty class list would read as "every class" and hand the teacher the whole
school.

### Read is scoped by teaching duty; write is scoped by authorship

These differ deliberately. A covering teacher must be able to **see** a colleague's
entry for a class they teach — it is the same record the students of that class see,
and hiding it would leave them managing a class while blind to its homework — but must
not be able to **change** it. Collapsing the two rules into one would either leak
another teacher's draft or hide real homework from a colleague standing in. So:

* `list` / `get` → assigned classes (teacher) or everything (admin);
* `create` → the target class must be taught (teacher) or any (admin);
* `update` / `delete` → `author_id == principal.user_id` (teacher) or anything (admin).

403 rather than 404 for "exists but not yours" on write: a teacher can already see the
entry in their own list, so a 404 would be a lie that costs nothing to break. This
differs from the student path on purpose — a student cannot list another class's
homework at all, so there 404 is the honest answer.

### Structured input only

`classId`, `subjectId`, `dueDate`, `homework`, `classwork`, optional `attachments`.
There is deliberately **no free-form diary blob and no parser for one**. Homework and
classwork are separate fields on one entry; merging them and guessing them apart again
is exactly the scraped-diary anti-pattern R2 removed. No AI, no regex extraction, no
EduSecure-compatible formatting.

`homework` and `classwork` are independent: homework only, classwork only, or both. Both
blank after trimming is a 400, matching the R2 database `CHECK` rather than duplicating
it — but rejecting it in the service means the client gets a named 400 instead of a 500
from a constraint violation. Text is trimmed at the ends and length-capped; interior
whitespace is untouched, because meaningful spacing inside a teacher's content is not a
formatting defect to be normalised away.

`dueDate` is `YYYY-MM-DD`, validated at the boundary by the existing
`validate::CalendarDate`. No timezone is attached: a due date is a school day, and
`2026-10-10` is the same day for everyone. The date-picker in the future teacher UI
converts to this format; the backend never accepts `10/10/26`, `Oct 10, 2026`, `tomorrow`
or `next Monday`.

**Date handling is R2's, not re-derived here.** `AUDIT.md` owns the whole story: the old
`homework.date` display string (`"Jul 23, 2026"`) was parsed by ~155 lines of regex, and
R2 replaced it with `due_date TEXT 'YYYY-MM-DD'` guarded by a `CHECK (due_date GLOB …)` —
sortable, range-scannable, one format — plus the `homework_progress` / `notes` /
`attachments` tables this phase reuses. R5 accepts that shape unchanged and adds nothing
date-specific: the same `CalendarDate` parser the student feed uses validates teacher
input too, so there is no second date story to keep in sync.

`classId` and `subjectId` are validated as existing entities before any write, so no
arbitrary subject or class name can enter a homework record.

Target checks run **before** content checks: a caller who may not write to that class
learns nothing about whether their prose would have been acceptable.

### PATCH semantics

Uniform, and the uniformity is the point:

* **omitted** → unchanged
* **explicit `null`** → clear that field
* **a value** → validated and written

`null` means *clear*, never "ignore". The alternative — treating `null` as "leave
alone" — makes a client that means to clear something fail silently, which is the
worse of the two mistakes. The double `Option<Option<T>>` with a custom deserializer is
what lets serde distinguish the three cases; a plain `Option<T>` collapses "absent" and
"null" into one value.

The two text halves are read out of the **existing row** and only the supplied ones
replaced, so clearing `classwork` cannot accidentally null out `homework` — the failure
mode a `COALESCE`-based update invites. A PATCH that would leave the entry with neither
half is refused with a 400 *before* the write rather than being caught by the R2
`CHECK` as a constraint violation. `classId`, `subjectId` and `dueDate` are non-nullable
in the schema, so `null` for those is refused as a client bug rather than ignored.
`updated_at` moves on every successful mutation, via the R2 `clock::now_ms()` convention.

Moving an entry to another class re-checks the destination, because `classId` names a
target. A PATCH that both moves and edits writes two rows and runs in a transaction, so
a move cannot land while the edit fails and leave the entry in a class its author is no
longer assigned to teach.

### Delete

Author allowed, admin allowed, any other teacher refused. Dependent rows are **not**
deleted by hand: `homework → attachments, notes, progress` are already
`ON DELETE CASCADE` from R2, and a second copy of that list in application code is a
second thing to forget when the schema changes. File bytes are likewise untouched —
`storage_key` resolution belongs to the storage service, which is deferred, so this
drops metadata only.

### Attachments

Metadata only. No upload endpoint, no bytes in SQLite, no invented temporary storage.
`storageKey` on the request is a caller-supplied key that a future storage service
resolves; this process neither reads nor writes it. The R2 `attachments` table is
reused as-is, so the teacher path is already compatible with whatever storage backend
lands later.

### Transaction boundaries

A transaction is opened exactly where more than one row is written, and nowhere else:

* create **with** attachment metadata → one transaction (entry + N attachment rows).
  Committed only after every attachment row exists, so a failure part way through
  cannot leave an entry with half its files described.
* create with **no** attachments → a single insert runs directly, rather than opening a
  transaction to make one statement atomic with itself.
* PATCH that moves the class *and* edits → one transaction (update + move).
* PATCH that only edits → one statement, no transaction.

Concurrency otherwise relies on what R1 already configured: SQLite in WAL mode with a
busy timeout. No additional locks or coordination primitives were introduced, because
nothing here requires them.

### Compatibility decisions

| Decision | Why |
| --- | --- |
| No legacy compatibility work at all | teachers do not use MMSS64; there is no contract to preserve (contrast `STUDENT_API_AUDIT.md`) |
| camelCase JSON throughout | consistent with R4 and with the frontend |
| `{count, items}` for the teacher list, not the student feed's `{count, homework}` | it is a management list, not a class feed, and no client reads it, so there is no legacy name to keep |
| `updatedAt` as **epoch milliseconds**, not ISO-8601 | nothing about the future teacher UI needs a rendered date; one format means one thing to compare. The student view's ISO string exists only because the shipped client already parses it |
| No `displayDate` on the teacher view | same reason — the server does not own locale formatting for an unwritten client |
| `author` is `{id, displayName}` or `null`, never a bare id | the id is already authoritative on the row; the name is presentation |
| A dangling author renders as `null` | rather than a half-built object |
| No `attachment` legacy slot, no `url` on metadata | there is no storage layer; emitting a URL that returns JSON would make attachment views fail confusingly, exactly as in R4 |
| 400 for malformed input, 401 anonymous, 403 wrong role or not authorized, 404 not found / not readable | never leaking internal database detail; `ApiError::Internal` serialises a fixed body |

## Why this replaces the scraped-diary flow

Today the only way any work reaches a student's screen is the EduSecure scraper writing
one row per student into `homework` (522 live rows = 1 student × 522 entries, per
`AUDIT.md`). A teacher posting work was invisible to that pipeline and went into
`teacher_assignments` instead — a second table set with its own student-side feed at
`GET /api/teacher/assignments/student`.

After R5 there is exactly one homework concept: the R2 `homework` table, with
`author_id` distinguishing teacher-authored entries from diary-imported ones
(`author_id IS NULL`). A teacher creating homework through the teacher API and the
scraper importing a portal diary write **the same rows a student already reads**, with no
second feed, no per-student fan-out, and no sync step between the two.

That is the point of `teacher_classes`: it makes MMSS64 the source of truth for
teacher-created work. The old design had to route teacher work around the diary tables
because the diary tables were per-student copies owned by a scraper. Once homework is a
single class-level row, a teacher can write into it directly, and the student feed needs
no knowledge of who authored an entry. The integration stays an *integration* — EduSecure
writes in, MMSS64 owns what it wrote (`AUDIT.md`: "the EduSecure integration writes these
tables; it does not shape them").

## Deliberately deferred

Admin management CRUD — granting, revoking and listing `teacher_classes` assignments —
is **not** in this phase, by decision. The data model and fixtures are in place and the
role trigger already covers that future caller; only the HTTP surface is missing.

Also out, and unchanged from the brief: EduSecure in any form, AI / Laya / Gemma,
moderation, final attachment file storage, the student classwork-upload approval
lifecycle, teacher notes about individual students, password reset/change, frontend
migration, deployment and rate limiting, and any migration of the old database.

`teacher_student_notes`, `teacher_grades`, `attendance_*`, `teacher_duties`,
`teacher_announcements` and `leave_requests` all still exist only in the old backend.
The old `/api/teacher/*` surface is frozen and untouched, exactly like the student one.