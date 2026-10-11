# Phase 7 — EduSecure integration audit and boundary

Sources: `server/edusecure/{edusecureAuth,homeworkService,htmlParser,attendanceService,calendarService,schoolNoticesService}.js`,
`server/auth/sessionService.js`, `server/routes/teacherRoutes.js`,
`mmss-backend/src/{config,state}.rs`, `mmss-backend/migrations/`.
The old backend and the frontend were **not modified**.

## The finding that shapes the whole phase

**The old EduSecure integration is read-only. There is no write path anywhere in it.**

Grepping the old `server/edusecure/` tree for anything that POSTs an announcement,
homework or diary entry finds nothing. Every EduSecure module in the old system *reads*:
`homeworkService` fetches homework, `attendanceService` fetches attendance,
`calendarService` fetches the calendar, `schoolNoticesService` fetches notices. The only
POST in the entire integration is `edusecureAuth`'s login handshake, which authenticates a
*student* so their *parents* can read.

That matters enormously for the "publish MMSS homework to EduSecure" goal, because:

* there is no endpoint to port, and
* the portal is `ParentApp` — a parent-facing read-only application. Nothing in this
  repository, and nothing in any artefact this repository holds, demonstrates that it
  exposes a create-announcement operation at all.

So R7 builds the **boundary and the semantics** — the trait, the publication ledger, the
non-destructive failure model, the duplicate prevention, the transform — and leaves the
concrete write transport unimplemented rather than inventing a URL and hoping. See
"Cannot be safely reproduced" below.

## 1. Authentication and credential requirements

`edusecureAuth.loginToEduSecure` is an ASP.NET WebForms handshake against a **hardcoded**
school URL:

```
GET  https://edusecure.in/ManavMangalMohali/ParentApp/Login.aspx
```

* The GET scrapes three hidden fields with cheerio: `__VIEWSTATE`, `__VIEWSTATEGENERATOR`,
  `__EVENTVALIDATION`. The POST cannot be constructed without them.
* Cookies from the GET are collected into a map and replayed as a `Cookie` header.
* The POST is `application/x-www-form-urlencoded` with `txtusername`, `txtpassword`,
  `btnLogin`, and `drpSession` — the **session year**.
* The session year is chosen by hardcoded preference for `"2026-2027"`, falling back to
  `"2025-2026"`, then to whatever `<option>` values the page offered. A new academic year
  therefore requires a **source edit** in the old system.
* Invalid credentials are detected by substring-matching the response for
  `"Invalid username and password"` / `"Invalid username"` / `"Invalid password"`.
* Transport failures are mapped to a distinct `portal_unreachable` code so they are not
  reported as bad credentials. A 15-second `AbortController` timeout prevents a stalled
  portal from hanging the login.

**Credentials are per-student, not a service account.** The old code reuses the end user's
own school ID and password, signs in as them, stores the resulting cookie string, and never
stores the password itself. There is no server-side EduSecure account, no API key, and no
`EDUSECURE_*` configuration variable anywhere — `server/config.js` contains no EduSecure
settings at all, because every EduSecure setting was hardcoded in source.

That last point is the direct opposite of what R7 requires, and is one of the things this
phase exists to fix.

## 2. Endpoints and request/response shapes

| Operation | Method | URL | Response |
| --- | --- | --- | --- |
| Login | GET | `/ManavMangalMohali/ParentApp/Login.aspx` | HTML with viewstate fields + `Set-Cookie` |
| Login | POST | same | HTML; cookie jar becomes the session |
| Homework | GET | `/ManavMangalMohali/ParentApp/Announcement.aspx?Type=Homework` | HTML grid |

Homework fetch policy: 20-second timeout, **2 attempts** with a 750 ms·attempt backoff,
retrying 429 and 5xx.

Session expiry is inferred three separate ways, which is worth noting because it is the
fragile part of any faithful port:

1. HTTP 301/302 whose `Location` contains `login`;
2. response body containing `txtusername`;
3. response body containing `Login.aspx` or `loginWrapper`.

The old code also folded attendance, calendar and notices onto the same cookie jar, and
`teacherRoutes.js` exposes `/api/teacher/attendance/student` which reads EduSecure
attendance through it.

## 3. How existing EduSecure homework is represented

`htmlParser.parseHomeworkHtml` selects rows in `#ctl00_ContentPlaceHolder1_grdDashContents`
and emits:

```js
{ type, date, homework, attachment }
```

* `type` — text of `[id$="_lbltype"]`, defaulting to `"Homework"`.
* `date` — text of the row's first `<small>`, **a display string**, e.g. `"Jul 23, 2026"`.
* `homework` — the row's first `<p>` with `<b>` children stripped. **One merged string.**
* `attachment` — `href` of `[id$="_HyperLink1"]`, resolved to an absolute URL against the
  page. At most one per row.

Three properties of this shape were already rejected in earlier phases and are recorded
here so the port does not reintroduce them:

* the merged blob is what R2 split into `homework_text` + `classwork_text`
  (`AUDIT.md`: 378 of 522 live rows carried both markers in one `content` column);
* the display-string date is what R2 replaced with `TEXT 'YYYY-MM-DD'`;
* `type` was `"School Diary"` on every one of the 522 live rows — `STUDENT_API_AUDIT.md`
  calls it a scraper artifact and drops it;
* a single remote `attachment` URL is what R2 replaced with metadata rows and a
  `storage_key`.

The ID selector `#ctl00_ContentPlaceHolder1_grdDashContents` is an ASP.NET-generated
control id containing a deployment-specific prefix. It is a hard coupling to one school's
one portal build.

## 4. What must be preserved for migration

Only three things, and only for the historical import:

1. **The row extraction** — from the announcement grid to `(date, body, attachment url)`.
2. **The `Homework:` / `Classwork:` split** — needed because upstream sends one merged
   string and R2 stores two columns.
3. **The date display-string parse** — `"Jul 23, 2026"` → `"2026-07-23"`.

Everything else about the old representation is deliberately **not** preserved: no `type`,
no merged blob, no remote-URL attachment slot, no per-student duplicate rows.

## 5. Cannot be safely reproduced

Stated plainly, because these are the places where a port would be guesswork:

* **Publishing.** There is no write endpoint to port and no evidence one exists. R7
  defines the client boundary and the ledger semantics but ships no HTTP write path. This
  is the single largest thing a future phase needs from the school/portal vendor.
* **The HTML scrape.** The grid id embeds a deployment-specific control prefix and the
  session-expiry check is three substring tests against markup that is regenerated per
  academic year. Reproducing this couples the Rust backend to one portal build's markup.
  R7 therefore transforms **HTML supplied to it**, rather than fetching that HTML, so the
  fragile part is the caller's problem to refresh and the parsing stays testable.
* **Session-year selection.** Hardcoded `["2026-2027", "2025-2026"]` in the old source. Not
  ported; a real client must read the options from the page.
* **Attendance, calendar, notices.** All read-only EduSecure features, all out of scope.
  `teacherRoutes.js` reaches attendance through the same cookie jar; R7 does not.

## The boundary R7 defines

```
routes/edusecure.rs  ──►  services::edusecure::EduSecureService
                                │
                                ├── EduSecureClient (trait)   ◄── the only way out
                                │      ├── DisabledClient      (no credentials)
                                │      └── fakes in tests
                                │
                                ├── repositories::edusecure   (the publication ledger)
                                └── repositories::homework    (the source of truth)
```

Decisions, each of which the phase brief requires:

* **SQLite stays authoritative.** Publication is a *side effect* of a record that already
  exists locally. Every failure path leaves the local `homework` row byte-identical.
* **Failures are recorded, not thrown away.** A failed attempt writes a ledger row with the
  error, so a retry is possible and an operator can see what happened. It never rolls back
  or invalidates the local record.
* **Duplicate publication is prevented by the ledger**, keyed on `homework_id`. A second
  publish of an already-published entry is a no-op that reports the existing state rather
  than pushing a duplicate to the portal.
* **Credentials live in `config::EduSecureConfig` and nowhere else.** No domain module
  reads an environment variable. The password is never logged, never serialised, and the
  `Debug` impl is hand-written so it cannot be printed by accident.
* **The integration is optional.** With no credentials configured the client is
  `DisabledClient`, every EduSecure route answers a clear "not configured", and every
  non-EduSecure route behaves exactly as it did in R1–R6. Tests need no credentials and
  no network.

| New table | Why |
| --- | --- |
| `edusecure_publications(homework_id PK/FK CASCADE, status, external_id, last_error, attempts, created_at, updated_at)` | one row per local entry, giving duplicate prevention, retry state, and an audit trail without touching the source-of-truth row |

`source_identifier` from R2 is *not* resurrected: provenance is not domain data. The ledger
is integration state and lives in its own table.

Not starting R8.