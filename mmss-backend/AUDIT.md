# Phase 2 — old backend audit (reference: Node/Next.js implementation)

Facts gathered by reading `server/db/schema.js`, `server/routes/*`,
`server/homework/*`, `server/edusecure/*` and the live `sqlite.db`.
The old backend was **not modified**.

## What the existing app actually needs

| Domain fact | Where it comes from in the old code |
| --- | --- |
| A user is a school login (`guranshbir126`), a display name, a section label (`9-F`) and a role | `users.student_id / display_name / section / role` |
| A diary entry has a **school day**, a **subject**, a body, and at most **one** attachment | `homework.date / subject / content / attachment_url` |
| The diary body mixes two logical things: `Homework: ...` and `Classwork: ...` | 378 of 522 live rows contain both markers in one `content` column |
| A student ticks an entry off and writes a private note on it | `homework_user_state.completed / note` |
| The student's "Today / Recent / Calendar" views filter by school day, sometimes by subject | `homeworkDateUtils.hasTodayEntry`, `homeworkRoutes` |
| Teachers post subject + text + due date to a set of sections | `teacher_assignments` (+ `teacher_assignment_targets`) |
| Students upload classwork files that classmates see | `classwork_uploads` + `classwork_attachments` (base64 bytes in the DB on serverless) |

## Old concept → new concept

| Old | New | Why |
| --- | --- | --- |
| `users.id` = UUID text | `users.id` = `INTEGER` rowid | Smallest, fastest SQLite key; FKs stay narrow |
| `users.student_id` | `users.school_id` (`UNIQUE`, not the key) | External identifier kept separate from the PK, as required |
| `users.section` free text (`"9-F"`, `"Staff"`, `"Admin"`) | `classes` table + `users.class_id` | Section is a real entity that homework and classwork both belong to; a free-text column could not be a FK |
| `homework.subject` free text, polluted with the pseudo-subject `"School Diary"` | `subjects` table + `homework.subject_id` | A real FK; `"School Diary"` becomes an ordinary subject *row*, not a special case in the schema |
| `homework.user_id` — one copy of every diary row per student (522 rows = 1 student × 522 entries) | `homework.class_id`, no user column | The diary is class-level data. Per-student copies duplicated identical rows and made "one entry, one identity" impossible |
| `homework.content` = `"Homework: x\nClasswork: y"` | `homework.homework_text` + `homework.classwork_text` | Required by the brief; they are logically separate and separately displayed |
| `homework.date` = `"Jul 23, 2026"` display string, parsed by 155 lines of regex | `homework.due_date` = `TEXT 'YYYY-MM-DD'` | Sortable, range-scannable, one format. Format guarded by a `CHECK` |
| `homework.type` = `"School Diary"` for all 522 rows | *no column* | Parsing artifact of the EduSecure "Type" cell, not a domain type |
| `homework.source_identifier` = `"edusecure"` | *no column* | Integration provenance, not domain data. The EduSecure integration writes these tables; it does not shape them |
| `homework.attachment_url` — one nullable URL, remote-only | `attachments` rows (`filename`, `mime_type`, `size_bytes`, `storage_key`) | Many attachments per entry, real metadata, bytes never in SQLite |
| `homework_user_state.completed` | `homework_progress.completed` | Same requirement, now against a class-level entry |
| `homework_user_state.note` | `notes` (`user_id`, `homework_id` nullable, `body`) | Notes get their own entity, so a user-scoped note is representable too |
| `teacher_assignments` + `teacher_assignment_targets` (parallel homework concept) | the same `homework` table with `author_id` | One homework concept, whether teacher-authored or diary-imported |
| `teacher_student_notes` (teacher note about a student) | *deferred* | A different relationship (user → user); belongs to the teacher phase |
| `classwork_uploads` / `classwork_attachments` (student file sharing + approval) | *deferred* | Real feature, but its lifecycle is moderation/approval, which Phase 2 explicitly excludes. `classwork_text` + `attachments` already cover the classwork *concept* |
| `is_muted` / `muted_reason` / `muted_at` on `users` | *deferred* | Messaging-moderation state, out of scope for this phase |
| `role = 'class_teacher'` | *dropped* | The distinction lives in the teacher profile (which sections a teacher is class teacher for), not in the user role |
| `created_at` TEXT ISO-8601 on some tables, `expires_at` INTEGER on others | `INTEGER` Unix epoch **milliseconds**, everywhere | One format, native `i64` in Rust, no string parsing |
| JSON-array columns (`teacher_profiles.subjects`, `assigned_sections`, …) | proper join tables, when those features land | No JSON blobs in lookup data |
| 33 tables, ~20 of them messaging/moderation/attendance/AI/calendar | 7 tables | Only the data layer the current student experience and the future teacher API need |

## Preserved on purpose

* Diary entries stay **per school day + subject + class**, and a day's homework
  and classwork stay on the *same* row — they are two fields of one entry, not
  two entries. Two nullable columns model that; a single blob did not.
* `school_id` keeps its exact, user-typed spelling (no lowercasing) and stays
  case-insensitively *findable* at the service layer, matching what the old
  login did.
* The student `completed` tick and private note are per user **per entry** and
  survive re-imports of the diary.
* The "at least one of homework/classwork must be non-blank" invariant is now
  enforced by the database, not by scraper dedup logic.

## Deliberately not carried over

Duplicate-copy-per-student storage, the merged `content` blob, the
`"School Diary"` pseudo-subject, the display-string date, the always-`"School
Diary"` `type`, `source_identifier`, base64 file bytes in SQLite, and the
JSON-array subject/section columns.
