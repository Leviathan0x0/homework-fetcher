# Phase 3 — old authentication audit (reference: Node/Express implementation)

Read from `server/routes/authRoutes.js`, `server/auth/sessionService.js`,
`server/auth/requireAuth.js`, `server/config.js`, `server/teacher/teacherService.js`
and the frontend client `src/services/api.ts`. The old backend was **not modified**.

## Credential source today

There is no password column anywhere in the old schema, and no password file.
Three separate sources, in the order `POST /auth/login` tries them:

| Account | Verified against | Notes |
| --- | --- | --- |
| Administrator | `ADMIN_USERNAME` (default `admin_mmss`) + `ADMIN_PASSWORD` env | Plain `!==` compare. **Unset `ADMIN_PASSWORD` refuses the login** rather than allowing any. Alias `admin` also accepted. ID compared case-insensitively. |
| Demo teacher | `TEACHER_TEST_USERNAME` + `TEACHER_TEST_PASSWORD` env | Constant-time compare (`crypto.timingSafeEqual`). Unset password ⇒ account **disabled** (503, distinct from a wrong password) so a missing env var is not reported as bad credentials. |
| Everyone else | **EduSecure** (`edusecure.in/.../Login.aspx`) via `loginToEduSecure` | The school portal owns the real credential. On success the returned session cookies are encrypted into `edusecure_sessions.encrypted_session_data`. |

`findOrCreateUser` then creates the local `users` row on first successful login —
the local database is a cache of people, never of passwords.

## Behaviour the frontend depends on

| Behaviour | Old shape | Why it matters |
| --- | --- | --- |
| Cookie name | `app_session` | The frontend never names the cookie (`credentials: "include"`), but keeping the name costs nothing and matches the docs. |
| Cookie flags | `httpOnly`, `path: "/"`, `secure` when cross-site or production, `sameSite: "none"` when cross-site else `"lax"` | Cross-origin hosting needs `None; Secure` together. |
| `GET /auth/me` with no session | **HTTP 200** with `{"authenticated": false}` | `authService.getCurrentUser` does `if (!res.ok) throw` *before* it looks at `authenticated`. A 401 makes the app treat "signed out" as a hard error, so 200 is what the client was written against. |
| `POST /auth/login` body | `{"studentId": "...", "password": "..."}` | `studentId`, not `schoolId` / `username`. |
| Login success | `{"authenticated": true, "token": "...", "user": {...}}` | `token` is returned in the body as well as set as a cookie, for clients that cannot store cookies. |
| Login failure | non-2xx + `{"authenticated": false, "error": "..."}` | The client prefers the server's own wording over any status-code guess. |
| `POST /auth/logout` | always 200 `{"success": true, "authenticated": false}`, errors swallowed client-side | Logging out twice, or out with no cookie, must be a no-op. |
| User object | `id, studentId, displayName, section, profilePictureUrl, isAdmin, isTeacher, role, teacherProfile` | `mapAuthUser` reads exactly these. |
| Roles | `student` (default), `teacher`, `admin`, plus legacy `class_teacher` | The client treats `class_teacher` as a teacher. R2 folded `class_teacher` into `teacher` (class-teacher duty is a profile fact, not an account role) — a superset of what the client accepts. |
| Protected routes | 401 `{"code": "UNAUTHENTICATED", "message": "Not authenticated."}` | The client maps a 401 on data routes to `UNAUTHENTICATED`. |

## School ID handling

Three distinct normalisations, all deliberate:

1. **Login input**: `studentId.trim().replace(/@manavmangalschool\.com/gi, "")` — a student
   pasting their school email address still signs in. Otherwise trim only.
2. **User lookup**: exact match on the stored `student_id` first, then
   `lower(trim(student_id)) = lower(input)`. The stored value is never rewritten, so
   the first account to claim an ID keeps its spelling. Exact-first matters: without it
   two IDs differing only in case could resolve to the same account.
3. **Admin / demo-teacher match**: case-insensitive on both sides.

**Empty ID and empty password are 400, not 401**, and are answered *before* any
credential check. They are client mistakes, not authentication failures, and the
client shows the message verbatim.

## Session architecture

```
token = base64url(payload) + "." + base64url(HMAC-SHA256(payload, key))
payload = { jti, uid, sid, exp }        jti = random UUID
app_sessions.token (PRIMARY KEY) = jti
```

* TTL `SESSION_TTL_MS` = **30 days**, chosen explicitly to survive normal browser
  returns *and server restarts*; only an explicit logout revokes.
* The signature proves the token was issued by this API. It does **not** prove the
  session is live: the `app_sessions` row is what makes revocation real, and
  `getAppSession` deletes the row on expiry. A deleted row stops working even though
  the cookie is still cryptographically valid.
* Legacy opaque tokens, where the cookie value *was* the row key, are still accepted.
* A 10-second in-process cache sits in front of the lookup, so revocation is
  "effectively immediate" rather than "immediate".
* Token transport: `Authorization: Bearer <token>` if present, else the cookie.
  The bundled frontend uses **only** the cookie; no first-party client sends `Bearer`.

## Role enforcement today

Roles are *read* everywhere but enforced in almost no places: `requireAuth` only checks
that a session exists, then each route re-derives `isAdminAccount(user)` /
`isTeacher(user)` from the role string itself. The strings are compared inline in a
dozen places. The demo-teacher secret comparison is the only constant-time check;
the admin comparison is not.

## Not carried over

* The signed `payload.signature` token. The payload puts `uid` and `sid` (the school
  ID) in the client's hands in a merely-encoded form, and the signature is redundant
  next to a 256-bit random opaque token whose row already decides validity.
* The legacy opaque-token branch. One token format, from day one.
* The 10-second session cache and the in-memory `memUsers` / `memAppSessions`
  fail-safe stores. Both are latency workarounds for a hosted database; the new
  backend is a local SQLite file, and the cache only delays revocation.
* `class_teacher` as a role.
* Inline role string comparisons.
