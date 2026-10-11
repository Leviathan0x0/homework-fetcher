# Account lifecycle and credential management

How a student's account gets taken away when they leave, how they get their first
password, how they change it afterwards, and how the school runs all of that.

Read `ACCOUNT_PROVISIONING.md` first — this file assumes the roster format from there.

## What R11 left, and what closes it

R11 could enrol accounts. It could not do the four things that follow:

| R11 gap | R12 answer |
| --- | --- |
| No way to deactivate a leaver | `users.is_active`, plus a roster-driven CLI operation |
| No way to give a new student a password | A setup token: 256-bit CSPRNG, single-use, expiring, stored hashed |
| No way to change a password | `PATCH /api/auth/password`, self-service |
| No record of who did what | `account_events`, append-only |
| No forgotten-password reset | **Still not built.** See [Why there is no reset](#why-there-is-no-reset) |

## The active state

`users.is_active` is `INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))`.

**A deactivated account is not deleted.** It keeps its school ID, its class, its role, its
notes and its homework progress. That is the whole reason deactivation exists instead of
deletion: `users::delete` cascades to notes and progress, so deleting a leaver would
destroy their own work, and deleting a student who is merely on a break would destroy their
history. A student who comes back is reactivated and gets the same account, not a new one.

Two checks, and they are not the same check:

* **At login** — a deactivated account is refused in `AuthService::authenticate`, with the
  *same* 401 body as a wrong password, after the same dummy-hash work. So the login
  endpoint cannot be used to discover which school IDs exist or which have been switched
  off.
* **On every request** — `validate_session` re-reads the user and refuses a deactivated
  one, deleting the session row on the way past. This is the check that makes deactivation
  mean something: a student holding a live cookie is signed out on their **next request**,
  not on their next login.

`/api/auth/me` answers `200 {authenticated:false}` rather than 401 in both cases, because
the frontend checks `res.ok` before it reads the body and would otherwise show a session
*error* instead of a signed-out state.

## Deactivation revokes, and that is part of the operation

Deactivating an account:

1. sets `is_active = 0`,
2. **revokes every session it holds**, on every device,
3. **revokes every unused setup token it holds**,
4. writes one `account_events` row.

Steps 2 and 3 are not follow-ups. An account that kept its session would be fully usable,
and one that kept a setup token could set a password and sign in again — both of which
would make deactivation decorative.

### CLI only, on purpose

Deactivation has **no HTTP route.** The same reasoning as R11's provisioning: a privileged
operation reachable by request is a request someone can replay, and a leavers list an
operator can *read before running* is safer than a `DELETE` already in flight. There is no
`POST /api/admin/users/{id}/deactivate`, for a teacher or an administrator, and
`tests/account_lifecycle.rs::no_request_can_deactivate_an_account_or_mint_a_token` asserts
that across nine plausible paths, three methods, four bodies and three session states.

## Setup tokens: the first password

This is the flow that lets a student choose their own password instead of the school
inventing one.

```
mmss-backend accounts setup-tokens --roster new-students.csv
```

```
1   moO2vxarEuCQpHHt8KNuq-iivKHBPvDotokZvr2LR0c
2   -1UEPbFQtEmNzz6l7V6VjRi38Q7hQGqKVy7mZLz-XE0
{
  "tokens_issued": ["2026001", "2026002"],
  ...
}
```

The student then posts the token and a password:

```
POST /api/auth/password/setup
{"token": "moO2vxarEu...", "newPassword": "chosen-by-the-student"}
```

…and is signed in on the spot, because they have just proved control of the account.

### What makes it safe

| Property | How |
| --- | --- |
| Unguessable | 256 bits from the OS CSPRNG, via the *existing* `new_session_token`. There is no second generator: a 43-character token is the same primitive whether it authorises a session or a first password, and a second implementation is a second thing to get wrong. |
| Not stored | `token_hash` is a SHA-256 digest. A database dump yields nothing an attacker can submit. Asserted against the whole `mmss.db` file, not just the column. |
| Single-use | Consumed by one `UPDATE ... WHERE used_at IS NULL AND expires_at > ?` that returns the row. Not read-then-write, so **two concurrent submissions cannot both win** — tested. |
| Expiring | 24 hours, stored in `expires_at` so an operator can see the deadline. |
| Closed | `Debug` is hand-written to print `<redacted>`, so the one type whose `Debug` would leak a usable credential cannot leak through a log line or a failed assertion. |

### Tokens are only ever issued for an account with **no** password

There is no override, and no `--force`. A token for a working account is a second way in,
and an operator with read access to the database would be able to mint one for the
administrator. This is the single most important safety rule in R12.

### One live token at a time

Asking again for an account that already has an unused token **revokes the old one** and
issues a new one. A lost slip is the normal reason to ask, and five live tokens make "which
slip is valid" unanswerable. The superseded rows are kept and marked used, so "how many
slips did this student lose" is still answerable.

### Every failure looks the same

Unknown, already used, expired, and belonging to an account that already has a password all
return the identical body:

```json
{"error":"That setup link is not valid or has expired.","code":"BAD_REQUEST"}
```

Byte-identical, asserted in tests. So the endpoint cannot be used to learn whether a token
exists.

Request-shape errors ("Expected a setup token and a new password") and password-policy
errors ("Your password must be at least 8 characters") are deliberately *different* answers.
They say nothing about the token, and the password message is the one thing here a student
can act on — collapsing it into the generic failure would make the flow unusable.

## The school still has to deliver the token

**This system cannot do it, and does not pretend to.** There is no email, no SMS, no reset
link. The school already runs a process for telling students things; a token fits into it:

* print a slip with the token and the school ID, hand it over;
* read the token out over the phone, having recognised the student;
* hand it over at enrolment.

What the operator must do:

1. `accounts setup-tokens --roster … > slips.txt`
2. deliver the slips **through a school channel**
3. **delete `slips.txt`.**

If the school has no such channel, the prerequisite is unmet and this flow should not be
used yet — see [Remaining gaps](#remaining-gaps).

### Password rules

At least 8 characters, at most 1024, ends trimmed. Length only, no composition rules. This
is a roll number and a first-time setup, not a banking password, and a rule that can be
explained in one line is the one that survives being taught. The message says what is
needed.

## Password change

```
PATCH /api/auth/password        (any signed-in caller)
{"currentPassword": "...", "newPassword": "..."}
```

The **current password is required.** A session alone is not authority to change a
credential: whoever holds a stolen session could otherwise change the password and lock the
real owner out permanently. Session plus current password is what it takes.

Every session the account holds is then revoked, and a replacement is issued for the
caller's browser in the same response. Dropping all of them — *including* the caller's — is
what evicts an attacker who already had one; re-issuing is what stops the person who just
changed their password being logged out by it.

Changing to the password you already have is refused, because it would revoke every session
while leaving the credential identical: all of the disruption, none of the benefit.

### A user can never change another's password

There is no user id, school id or role in the body. The target is always the session, and
`userId` is not a deserializable field — so a client that sends one has it ignored rather
than honoured. Tests send `userId`, `id`, `schoolId` and `studentId` in turn and assert the
victim's credential is untouched after each, including on the one iteration where the
change genuinely succeeds.

Changing your own password *does* succeed, which is the endpoint working. What is asserted
is that the write lands on the session holder and only on the session holder.

## Audit trail

`account_events` is append-only: no update, no delete, so the trail cannot be edited after
the fact by whoever performed the action.

| `kind` | Recorded when | `actor` |
| --- | --- | --- |
| `password_set` | A first password, via a setup token | the account's own school ID |
| `password_changed` | A self-service change | the account's own school ID |
| `deactivated` | An operator switched an account off | `cli` |
| `reactivated` | …and back on | `cli` |

The distinction is deliberate. A self-service event naming the account holder and an
operator event naming `cli` are not the same fact, and collapsing them would make "who
deactivated this student" unanswerable.

`actor` is `cli`, never `NULL`, so "nobody in particular" is never stored as if a person's
ID had been lost.

`detail` is the operator's reason, bounded to 200 characters and stripped of control
characters **by the service**, not by its callers — a reason containing a newline could
forge a log line, and one caller forgetting to strip it is all it takes.

```sql
SELECT u.school_id, e.kind, e.actor, COALESCE(e.detail,'-'), e.created_at
  FROM account_events e JOIN users u ON u.id = e.user_id
 ORDER BY e.created_at DESC;
```

## School operating procedure

### Enrolling a cohort

```bash
# 1. The school supplies a roster with NO passwords -- see ACCOUNT_PROVISIONING.md.
mmss-backend import --roster term-start.csv

# 2. Mint one setup token per new student.
mmss-backend accounts setup-tokens --roster new-students.csv > slips.txt
#    -> prints "<user_id>\t<token>" per line, then the JSON report

# 3. DELIVER slips.txt through a school channel, then DELETE IT.
#    The report above is safe to keep; the tokens in slips.txt are not.
```

### Day-to-day

| Situation | Command |
| --- | --- |
| Student forgets their password | **Nothing to run.** Ask them to use the self-service change. If they cannot sign in at all, see [Why there is no reset](#why-there-is-no-reset). |
| A slip is lost or over-shared | `accounts setup-tokens --roster …` again — it replaces the token |
| A token should never have been issued | `accounts revoke-tokens --roster …` |
| A student leaves | `accounts deactivate --roster leavers.csv --reason "moved to another school"` |
| A student comes back | `accounts deactivate --roster returners.csv --reactivate` |
| "Why can't this student sign in?" | Read `account_events` |

The input format for all three is the smallest thing that can work — a CSV with an `id`
column, one school ID per row:

```csv
id
2026001
2026002
```

Nothing else is accepted. A file with a second *value* in any column is refused. That is the
safety property: **a leavers file is incapable of changing a role, a class, or a
password**, because the format has no way to express one. Tested against four smuggling
attempts.

School IDs are normalised the way a login normalises them, so surrounding whitespace,
surrounding quotes and the school email domain are all forgiven — leaving a leaver active
over a capital letter is the wrong direction for a failure.

### Idempotency

Every operation converges on a rerun. An account already in the requested state is counted
as `unchanged`, not written and not re-audited. A leavers list is expected to overlap
reality from time to term, so re-running one is the normal case rather than an error. Exit
code is **0 only if `issues` is empty**, so a script cannot mistake a partial run for a
complete one.

## Why there is no reset

**This is the one R11 gap R12 deliberately does not close.**

A reset that works without a session has to authenticate the requester some other way. The
only factors a school actually has are:

* an identity document, checked in person — real, and an offline process, not an endpoint;
* a phone number, needing an SMS gateway this system does not have and R1–R12 were told not
  to add;
* a school email, needing a mail server and a domain with SPF and DKIM;
* a teacher or the office knowing the student — which needs a trusted staff identity, i.e.
  the admin management CRUD that is still deferred.

None of those exists. Building the endpoint now and filling in the verification later is
exactly how unauthenticated account-takeover endpoints ship, and a half-verified reset is
worse than no reset at all, because the school's staff will believe it is safe.

**What is available today instead:** a student who cannot sign in at all is a
school-channel problem. An administrator can issue a fresh setup token by deactivating the
account and reactivating it — both of which revoke every credential path to it — but that
requires the school to have positively identified the person in front of them. That is the
realistic operational procedure, and it is a person-to-person check rather than an
automated one.

**The prerequisite, stated plainly:** a school-controlled identity factor. Until the school
has one, no password reset should be built, and this document should be read as saying so.

## Security properties, and where they are proven

| Property | Test |
| --- | --- |
| A deactivated account cannot authenticate | `a_deactivated_account_cannot_authenticate_and_is_indistinguishable` |
| Deactivation is byte-identical to a wrong password | same |
| Live sessions die on the next request | `an_existing_session_stops_working_the_moment_the_account_is_deactivated` |
| Deactivation keeps notes and progress | `deactivating_keeps_the_account_and_everything_it_owns` |
| A session alone cannot change a password | `a_stolen_session_alone_cannot_take_over_an_account` |
| One user cannot change another's password | `a_user_can_never_change_another_users_password` |
| A change revokes every session and re-issues one | `a_user_can_change_their_own_password` |
| Tokens are unguessable and never stored | `a_setup_token_is_random_single_use_expiring_and_stored_only_as_a_hash` |
| A token cannot be spent twice, or twice at once | `a_setup_token_cannot_be_spent_twice`, `..._concurrently` |
| An expired token is refused | `an_expired_setup_token_is_refused` |
| Token failures are indistinguishable | `token_failures_are_indistinguishable_while_usable_errors_are_not` |
| No token for an account with a password | `a_setup_token_is_refused_for_an_account_that_already_has_a_password` |
| A deactivated account cannot use a token | `a_deactivated_account_cannot_use_a_setup_token` |
| A leavers file cannot change roles/classes/passwords | `a_leavers_file_cannot_change_a_role_a_class_or_a_password` |
| No request can deactivate or mint a token | `no_request_can_deactivate_an_account_or_mint_a_token` |
| Bulk operations are idempotent | `a_leavers_list_is_applied_in_one_run_and_is_idempotent` |
| Every operation is audited, with no secrets | `every_lifecycle_operation_leaves_an_audit_record_naming_who_did_it` |
| A deactivation reason cannot forge a log line | `a_deactivation_reason_is_bounded_and_control_free` |
| Provisioning → setup → login → change → deactivate | `enrolment_then_a_terms_worth_of_lifecycle_over_the_real_boundary` |

## Remaining gaps

Honest, and ordered by what they block.

1. **No forgotten-password reset.** The blocker above. Needs a school-controlled identity
   factor; nothing else.
2. **No cleanup job.** `sessions::delete_expired`, `setup_tokens::delete_dead` and
   `account_events` pruning exist and nothing calls them. Expired rows grant nothing, so
   this is storage, not security — but a school running for years will notice.
3. **No admin UI for any of this.** Every lifecycle operation is a CLI command by design.
   An admin who cannot reach a shell has no way to deactivate a leaver.
4. **No password complexity history.** The 8-character minimum is a floor, not a policy.
   There is no check against the student's own name, roll number or the school name, which
   is the most common real-world weakness. Doing it properly needs a breach corpus, which
   is not something to hand-roll.
5. **No session management UI.** A student cannot see or revoke their own devices. R12
   revokes sessions; it does not display them.
6. **`/auth/profile/picture` and `/auth/reconnect` remain unimplemented** — a multipart
   upload with no storage design, and EduSecure re-authentication, which was explicitly out
   of scope.

None of these block a first deployment. (1) is the one the school will ask about first.

## Schema

`migrations/0005_account_lifecycle.sql`:

```sql
ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1
    CHECK (is_active IN (0, 1));

CREATE TABLE setup_tokens (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER
);

CREATE TABLE account_events (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL,
    actor      TEXT    NOT NULL,
    detail     TEXT,
    created_at INTEGER NOT NULL
);
```

`NOT NULL DEFAULT 1` means every existing row is active without a data migration, and an
insert that forgets to mention the column produces a working account rather than a `NULL`
that every query has to special-case.