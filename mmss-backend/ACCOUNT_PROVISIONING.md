# Account provisioning and identity migration

How MMSS64 gets the school's students, teachers, classes and subjects into its database,
and exactly what the school has to hand over to make it happen.

## The audit that produced this

R10 closed with one real blocker: **only the bootstrapped administrator exists.** R3–R10
authenticate against local argon2 credentials; the old system authenticated students
through EduSecure. Nothing bridges the two, so a student cannot sign in.

Before writing an importer I looked for a source to import *from*. There isn't one:

| Candidate | Verdict |
| --- | --- |
| The old database's `users` table | **Not a roster.** `sessionService.findOrCreateUser` created a row the first time somebody signed in, with `section: ""`. It records who happened to log in, not who the school has. A student who never opened the app is not in it. |
| An EduSecure roster endpoint | **Does not exist.** `EDUSECURE_AUDIT.md` records the portal as `ParentApp`, a read-only parent application. There is no endpoint that lists students. |
| A bulk export script in the old codebase | **None.** The only CSV exports are `attendance.csv` and `assignments.csv`, and both are derived *from* the `users` table — so they inherit the same gap. |
| The school itself | **The only authoritative source.** The school holds the admission register. |

So: **the school supplies the roster.** This module ingests it. Nothing here reaches for a
system that does not exist, and EduSecure is not made a runtime dependency again.

## What has to be provided

One CSV file. A header row is required; the columns may be in any order, trailing columns may
be omitted entirely, and trailing empty fields are fine — a spreadsheet exporting a
seven-column template and filling five produces exactly that, and it is the normal shape of
this file. A row with a **value** in a column the header does not declare is refused.

```
kind,id,name,role,section,password
```

| Column | Meaning |
| --- | --- |
| `kind` | `class`, `subject`, `user`, or `assignment`. **Required.** |
| `id` | The identifier of whatever the row names: a class label, a subject name, a school ID, or (for an assignment) the **teacher's** school ID. |
| `name` | A user's display name. Ignored by the other kinds. |
| `role` | `student`, `teacher`, or `admin`. Blank means `student`. |
| `section` | For a user: the student's class. For an assignment: the class being taught. |
| `password` | A plaintext password, hashed on the way in. See [Passwords](#passwords). |
| `password_hash` | An argon2id PHC string, stored verbatim. Mutually exclusive with `password`. |

Any column not listed is **rejected by name**:

```
unknown column "displayname" in the header. The columns are:
kind, id, name, role, section, password, password_hash
```

That is deliberate. A typo'd header is how a whole column of names silently imports as blank,
and a file that says `displayname` instead of `name` should stop the import rather than
quietly discard every student's name.

### Worked example

```
kind,id,name,role,section,password
class,9-A,,,,
class,9-B,,,,
class,10-A,,,,
subject,Mathematics,,,,
subject,Science,,,,
subject,English,,,,
user,2026001,Aarav Sharma,student,9-A,
user,2026002,Bhavya Rao,student,9-A,
user,t001,Ms Rao,teacher,,,
user,t002,Mr Iyer,teacher,,,
assignment,t001,,,9-A
assignment,t001,,,9-B
assignment,t002,,,10-A
```

That file provisions 3 classes, 3 subjects, 4 accounts and 3 teaching assignments, and gives
every account **no password** — see below for why that is often the right first run.

## Running it

```bash
export DATABASE_URL="sqlite://./data/mmss.db"
cargo run --release -- import --roster ./roster.csv
```

The subcommand runs against the configured database and exits. **It never opens the HTTP
listener**, so there is no window in which a request could reach account creation.

Output is a JSON report:

```json
{
  "classes_created": 3, "classes_reused": 0,
  "subjects_created": 3, "subjects_reused": 0,
  "users_created": 4, "users_existing": 0,
  "credentials_set": 0, "credentials_preserved": 0,
  "assignments_created": 3, "assignments_existing": 0,
  "rejected": [], "conflicts": []
}
```

Exit code is **0 only if `rejected` and `conflicts` are both empty**. Anything left out is
a failure the operator has to look at, so a script cannot mistake a partial import for a
complete one.

### There is no `--dry-run`, on purpose

It looks like a missing feature, so: a rehearsal would have to be *exact* to be worth
anything, and being exact means writing. The repositories take a `&SqlitePool` rather than an
executor, so there is no transaction to roll back, and a "rehearsal" against production that
creates rows and then deletes them is briefly visible to real requests.

The report is the feedback loop instead. Every write is keyed on an existing `UNIQUE` column
or is already `INSERT OR IGNORE`, so **running the import is itself the dry run**: run it,
read the counts, fix the roster, run it again. See [Idempotency](#idempotency).

## Idempotency

Rerunning a roster converges. A second run of the example above creates nothing:

| Record | Keyed on | Second run |
| --- | --- | --- |
| class | `classes.name` (`UNIQUE`) | `classes_reused` |
| subject | `subjects.name` (`UNIQUE`) | `subjects_reused` |
| user | `users.school_id` (`UNIQUE`) | `users_existing`, no writes |
| credential | `credentials.user_id` (PK) | `credentials_preserved` — **never replaced** |
| assignment | `teacher_classes` composite PK, `INSERT OR IGNORE` | `assignments_existing` |

Two consequences worth stating plainly:

* **An interrupted import is completed by running it again.** There is no transaction
  spanning thousands of rows, and there does not need to be: recovery and routine reruns are
  the same operation.
* **A class name is matched case-insensitively.** A roster that spells a section `9-a`
  reuses the class the school already calls `9-A` rather than creating a second one that
  only half the application can see. This is the opposite of the choice made for school IDs,
  and deliberately so — see below.

## What an import will never do

**It never overwrites an existing account.** Not the role, not the class, not the display
name, not the password. A roster is a statement about who *should* exist; it is not a
migration and has no authority to demote anybody. Where a roster disagrees with the database,
the database wins and the disagreement is reported as a **conflict**.

The specific case that matters: if an existing account has already changed its password, a
stale spreadsheet cannot reset it. That would let an outdated file lock every student out of
an account they are actively using.

There is no exception, no `--force`, and no admin override, because every one of those is a
way to turn "run the roster" into "demote the maths teacher".

## Passwords

**No password is generated, and none is delivered.** This module hashes what it is given and
hands the rest of the problem back to the school, which already runs the process of telling
students their passwords. Inventing a delivery mechanism here — an email, a reset link, a
printed slip — would be a claim about a system that does not exist.

Three options, in the order they should be considered:

| Column | When to use | Trade-off |
| --- | --- | --- |
| *neither* | **The recommended first run.** Accounts exist and are authorised, but cannot sign in. | The roster file contains no secret at all. Safe to keep, to diff, to email. Students cannot log in until a later run supplies credentials. |
| `password_hash` | The school can hash offline. | The roster file contains a hash, which cannot be replayed as a password. Still not a secret worth keeping. |
| `password` | The school already has the passwords in a spreadsheet. | **The roster file now contains every student's plaintext password.** Hash it, import, then destroy the file. |

An account with **no credential** is a real, supported state: it exists, it is authorised, it
appears in every roster, and it is refused at login with the *same* answer as a wrong
password — so "not yet given a password" is not a distinguishable state to anyone probing
the login. It is the safe state for a student who is enrolled but has not been handed
credentials yet.

For a pre-hashed credential, generate the PHC string wherever the school already runs code:

```bash
python3 -c "from argon2 import PasswordHasher; print(PasswordHasher().hash('the-password'))"
```

**The value must be wrapped in double quotes in the CSV.** An argon2id PHC string always
contains commas in its parameter list (`m=19456,t=2,p=1`), and an unquoted one is read as
several columns. The importer rejects the result rather than storing half a hash.

## Validation

Two classes of problem, handled differently.

**A malformed row stops the whole import.** One typo in a roster of three thousand students
should not produce a half-applied database that then has to be corrected by hand. The error
names every offending line and nothing is written:

```
3 of the roster's rows could not be read. Nothing was imported.
  line 2: `id` is required
  line 3: a student must name a section
  line 7: unknown role "studnet"; expected student, teacher or admin
```

**A well-formed row that disagrees with reality is reported and skipped**, and the rest of
the roster still lands. These are different problems with different fixes: a typo needs the
file edited, a disagreement needs a human decision. Every such row appears in `rejected`
with its line number and a reason, and the exit code is non-zero.

Rules enforced:

* **Students must name a section.** A student with no class lands on a permanently empty
  feed with no explanation anywhere. Refused, and named in the error.
* **Staff must not name a section.** A teacher inside a section contradicts
  `users.class_id`, which is documented as `NULL` for staff with duties in
  `teacher_classes`. Silently dropping the column would import a roster the school did not
  write.
* **An assignment to an unknown section is refused** rather than creating the class — this is
  the one place where quietly inventing a class *is* wrong, because a typo would produce a
  section that appears in no roster.
* **An assignment names an existing teacher.** Checked here as well as by the migration's
  trigger, so the operator gets a line in the report naming the row rather than a trigger
  error naming a table.
* **A duplicate school ID inside one file is refused** and the report names the earlier line.
  Checked *before* the database, because "this spreadsheet repeats itself" and "the import
  is idempotent" are different things and the operator needs to know which happened.
* **A school ID differing only in case is a conflict, never a second account.** This one is a
  genuine trap: `users.school_id` is `UNIQUE` under SQLite's binary collation, so `2026A001`
  and `2026a001` are two perfectly legal rows — and then `AuthService` finds two matches on a
  case-insensitive login and, correctly, refuses to answer for either. An account nobody can
  ever sign in to. Catching it here turns that into a line in a report.
* **`2026001` and `2026001@manavmangalschool.com` are the same account**, because school IDs
  go through `AuthService::normalize_school_id` exactly as a login does. This is what keeps
  a roster and a login agreeing about who a person is.

## Scale

A whole school imports in one run. The importer loads the existing classes, subjects and
school IDs into memory up front and reconciles against those, so there is **no per-row
lookup query** — the cost is one insert per new record. Classes and subjects referenced only
by a student row are created on the fly and reported in `classes_created`, so a typo in a
section name shows up in one line of the output rather than failing a third of the file.

Argon2 at its default parameters costs roughly 30–50 ms per new credential, so a roster that
supplies three thousand passwords takes a couple of minutes. This is a one-shot operator
command against a local SQLite file, and it is deliberately not parallelised.

## `/auth/profile`

`PATCH /auth/profile` is new in R11, and is the one frontend endpoint the old system had that
the Rust backend was missing. `AppShell` prompts any student with no display name to set
one; without this route that prompt produced a 404 and a toast saying their name could not
be saved.

It is **self-service only**, and the scope is the caller's own row. There is no
`displayName`-accepting field anywhere else in the API, so there is no second door through
which a caller could name somebody else — which is also why there is no admin-only variant.
Renaming another account is an admin feature, and admin features were not asked for.

```bash
curl -X PATCH localhost:3001/api/auth/profile \
  -H 'Content-Type: application/json' \
  -H "Cookie: app_session=$TOKEN" \
  -d '{"displayName":"Aarav S."}'
```

```json
{"user":{"id":1,"studentId":"2026001","displayName":"Aarav S.","classId":1,
         "section":"9-A","role":"student","isAdmin":false,"isTeacher":false}}
```

The response is the **whole** account, not just the name: the client rebuilds its session
state from it through `mapAuthUser`.

## Deployment prerequisites

These are things this code cannot do for the school.

1. **The roster itself.** A register of students with school IDs, names and sections; a list
   of sections; a list of subjects; a list of teachers with the sections they teach. Any
   spreadsheet that exports to CSV is sufficient.
2. **A decision about how students get passwords.** Not decided here. The school already
   distributes passwords; this system does not generate or deliver them. The recommended
   first import supplies no credentials at all, so the roster contains no secret.
3. **A channel for the roster file.** Whoever produces it needs somewhere to put it that the
   operator can read. Nothing in this system receives the file over the network.
4. **`ADMIN_PASSWORD` set.** `bootstrap::ensure_admin` still creates the administrator. A
   roster can create one too (`role: admin`), but the bootstrapped account is the one to keep.
5. **Frontline teacher enrolment.** A class is taught by a teacher through `teacher_classes`.
   The roster carries those assignments, so this is covered — but a teacher who leaves needs
   their assignment removed, and **an import will not remove one**. That is a deliberate
   consequence of "never overwrite": removing a row from a roster cannot revoke a permission.
   Revocation is a separate, explicit, audited operation and is not implemented. See
   *Remaining gaps*.

## Remaining gaps

Honest, and ordered by how much they block.

1. ~~**No revocation.**~~ **Closed in R12.** See `ACCOUNT_LIFECYCLE.md`: accounts now have
   an active/deactivated state and a roster-driven CLI operation, audited in
   `account_events`. Deactivation deliberately preserves the account and its data.
2. ~~**No password rotation.**~~ **Partly closed in R12.** `PATCH /api/auth/password` lets a
   signed-in user change their own password, revoking every session. Rotating a password for
   someone who cannot sign in is still not possible — see the reset note below.
3. ~~**No password self-service.**~~ **Closed in R12** for accounts that have a password. The
   first password arrives via a setup token instead; see `ACCOUNT_LIFECYCLE.md`.
4. ~~**No bulk deactivation.**~~ **Closed in R12.** `mmss-backend accounts deactivate
   --roster leavers.csv`.
5. **No forgotten-password reset, anywhere.** Deliberately not built: it needs a
   school-controlled identity factor that does not exist. `ACCOUNT_LIFECYCLE.md` explains why
   inventing one is worse than the gap.
6. **No diff or apply report before committing.** The report describes what happened, not a
   preview of what would happen; see the note on `--dry-run` above for why.
7. **`/auth/profile/picture` and `/auth/reconnect` remain unimplemented.** The first is a
   multipart upload with no storage design. The second is EduSecure re-authentication, which
   this phase was explicitly told not to build.

None of these block a first deployment of the account system. (5) is the one a school will
raise first, and the answer is a person-to-person check by the office rather than an endpoint.