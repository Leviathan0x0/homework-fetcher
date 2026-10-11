# Phase 10 — deployment topology and configuration

Scope: running the Rust backend against the existing Next.js frontend. This file documents
what R10 verified, what it changed, and what an operator must set.

The old deployment notes are at the repository root (`DEPLOYMENT.md`, `docs/AZURE-VPS.md`)
and describe the Node backend. They are **not** updated by R10 — the Node backend is frozen
reference. This file supersedes them for the Rust service.

## Topology

```
  Browser
     │
     │  https://<app>.vercel.app          same origin
     ▼
  Vercel  ── vercel.json rewrite ──────────►  Rust / Axum  :3001
   static assets   /api/:path*  ─────────►    │
   (dist/)                                     ▼
                                          SQLite (WAL)
                                       data/mmss.db
```

The frontend is a static build. `vercel.json` rewrites `/api/*` to the Rust process **without
stripping the prefix**, so the backend really does own `/api/*` and every request arrives
same-origin.

### The two topologies, and why the choice matters

| Topology | Config | Consequence |
| --- | --- | --- |
| **Rewrite (recommended, current)** | `VITE_API_BASE_URL` unset; `ALLOWED_ORIGINS` unset | Requests are same-origin. No CORS headers, no `SameSite=None`, cookie works with the default `SameSite=Lax`. |
| Separate origins | `VITE_API_BASE_URL=https://api.example.com` | `credentials: "include"` makes this a **cross-origin cookie** request. Requires **all three** of: `ALLOWED_ORIGINS=https://<frontend>`, `COOKIE_SAME_SITE=none`, and `COOKIE_SECURE=true` (R1 refuses `SameSite=None` without `Secure`). `X-Request-Id` must be readable, which R9 already exposes via CORS. |

The current `vercel.json` points at a bare IP (`http://57.155.88.204`). That works but loses
the hostname for TLS termination and log correlation. **Change it to a hostname before
production** — see "Blockers".

## Environment variables

### Required

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite://./data/mmss.db` | Created if missing, parent directory included. WAL, `foreign_keys=ON`, 5 s busy timeout. |
| `ADMIN_PASSWORD` | unset | Provisions the admin account on first boot. **Unset means nobody can sign in as an admin.** Idempotent — never overwrites a changed password. |
| `ADMIN_USERNAME` | `admin_mmss` | |

### Required in production only

| Variable | Default | Notes |
| --- | --- | --- |
| `COOKIE_SECURE` | `true` when `NODE_ENV=production` | Must be `true` for a cross-origin deployment. |
| `COOKIE_SAME_SITE` | `lax` | `none` **requires** `COOKIE_SECURE=true`; R1 refuses the combination at boot. |
| `HOST` / `PORT` | `127.0.0.1` / `3001` | Behind a reverse proxy, keep the bind on loopback. |

### Optional

| Variable | Default | Notes |
| --- | --- | --- |
| `SESSION_TTL_DAYS` | `30` | Matches the old backend deliberately. Absolute lifetime. |
| `SESSION_IDLE_DAYS` | `7` | Idle lifetime, checked against `sessions.last_used_at`. Must not exceed `SESSION_TTL_DAYS`; boot refuses the reverse. |
| `CREDENTIAL_ENCRYPTION_KEY` | unset | **Required for any EduSecure credential to be stored.** 64 hex characters (`openssl rand -hex 32`). See below. |
| `ALLOWED_ORIGINS` | empty = deny all cross-origin | Comma-separated. See the table above. |
| `BODY_LIMIT_BYTES` | `262144` | Clamped to `[1024, 8388608]`. |
| `EDUSECURE_BASE_URL` / `_USERNAME` / `_PASSWORD` / `_SESSION` | unset | Integration disabled unless base URL + username + password are all set. |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | unset | AI layer disabled unless all three are set. |
| `AI_TIMEOUT_MS` | `5000` | Clamped to `[100, 60000]`. |
| `RUST_LOG` | `info` | `tracing_subscriber` filter. |

Nothing here is required to boot. A missing AI or EduSecure credential disables that
integration and changes no other behaviour.

### Secrets

* `ADMIN_PASSWORD`, `EDUSECURE_PASSWORD` and `AI_API_KEY` are read from the environment and
  never logged. R9 asserts no error body, status probe or integration status endpoint echoes
  any of them.
* A deployment **with no `ADMIN_PASSWORD` has no administrator**. `mmss-backend` will start
  and serve, and every admin route will be unreachable. This is the intended fail-closed
  state, but it is the first thing to check if the admin console appears empty.

#### `CREDENTIAL_ENCRYPTION_KEY`

The EduSecure credential is the one secret this system must be able to **read back**: the
backend hands the real password to the school portal to fetch homework. So it is encrypted
(AES-256-GCM) rather than hashed, and the key lives here, outside the database.

```sh
# Once, on the host. Store it wherever the other secrets live.
openssl rand -hex 32
```

Rules the code enforces, each because the alternative is silently worse:

* **64 hex characters, exactly.** A key that is present but malformed **fails the boot**,
  rather than being truncated or padded into a predictable one.
* **Unset is a supported, safe state.** The process starts, every other feature works, and
  only the endpoints that would have to *store* a credential answer `503
  CREDENTIAL_STORAGE_UNAVAILABLE`. There is no plaintext fallback anywhere — that is the
  whole point, and `credential_storage_fails_closed_without_a_key` asserts it.
* **Do not reuse `ENCRYPTION_KEY`.** That is the legacy Node backend's signing key and it
  is a different purpose under a different threat model. This key is dedicated.
* **Rotating it orphans every stored credential.** There is no re-wrapping tool; the honest
  procedure is to have each user re-submit it through
  `POST /auth/security/edusecure`, which verifies the replacement before storing it.

### Blocked: EduSecure credential verification

`POST /auth/security/password` (set up a separate MMSS64 password),
`POST /auth/security/edusecure` (replace a stored credential), reauthentication for a
legacy account, and legacy sign-in all require the school portal to confirm a password.

**No Rust portal client exists yet.** `services::edusecure::client_for` returns
`DisabledClient` in every configuration, so `verify_credentials` answers
`PortalError::Disabled` and each of those endpoints answers `503 EDUSECURE_UNAVAILABLE`.
There is deliberately no weaker fallback: the portal holds the password hash and exposes no
offline check, so the only honest implementation is the login POST it already expects.
`server/edusecure/edusecureAuth.js` is the reference for that ASP.NET WebForms handshake.

Until that client lands, a deployment can:

* use **MMSS64 passwords alone** — set-up, change, device management and every existing
  route work fully, because none of them touch the portal; and
* run **legacy sign-in** only if every account already holds an MMSS64 password, since a
  legacy account cannot be verified without the portal.

The safeguard is deliberate in one more place: when verification is unavailable, a login
for an account with no local password falls through to the same generic `401` as a wrong
password rather than a `503`. A `503` there would tell a caller that a school ID exists
and has no credential here, which is an account-enumeration oracle.

## Operational endpoints

| Endpoint | Purpose | Behaviour |
| --- | --- | --- |
| `GET /health` | liveness | **Never touches the database.** Stays 200 with the database down, so a slow database cannot get a healthy process restarted in a loop. |
| `GET /ready` | readiness | **503** when the database is unusable. Point the load balancer here. |
| `GET /metrics` | Prometheus scrape | `mmss_requests_total`, `mmss_errors_total` (5xx only), `mmss_requests_in_flight`, `mmss_db_pool_connections`, `mmss_db_pool_idle`. No path labels, deliberately. |

Suggested probe config:

```yaml
livenessProbe:  { httpGet: { path: /health, port: 3001 } }
readinessProbe: { httpGet: { path: /ready,  port: 3001 } }
```

All three are unauthenticated, and all three bodies are asserted by R9 to contain no
internal detail — an unauthenticated probe is exactly where a SQL error message would leak.

## Vercel preview deployments

The backend also compiles as a Vercel Function so that pushes and pull requests get a
preview URL where the real router can be exercised, without changing the production
topology. This uses Vercel's officially supported Rust runtime
(<https://vercel.com/docs/functions/runtimes/rust>): the root `Cargo.toml` builds one
binary from `api/mmss.rs`, which mounts the existing `mmss_backend::app` router (same
middleware, auth extractors, error envelopes and body limits) behind a prefix:

```
  curl https://<project>-git-<branch>-<team>.vercel.app/api/preview/health   # {"status":"ok"}
  curl https://<project>-git-<branch>-<team>.vercel.app/api/preview/ready    # 503, see below
```

`vercel.json` rewrites only `/api/preview(/:path*)` to the function; every other
`/api/*` request still goes to the Azure VPS, so the frontend's behaviour is identical
on previews and production.

**The preview has no database, by design.** Vercel Function instances have no
persistent filesystem, so `AppState::preview` hands the router a lazy pool that can
never open a file — no SQLite file is created, migrations do not run, and every
database-backed route (login, sessions, homework, …) fails closed with the standard
`500` error envelope. The preview is for testing routing, middleware, validation and
error shapes. It cannot host logins or sessions, and it must never be pointed at the
production database. Persistent storage stays where it belongs: SQLite on the Azure
VPS, exactly as this file describes above.

## Reproducible local production-like run

```bash
cd mmss-backend
export PATH=$HOME/.cargo/bin:$PATH

# Production-shaped, local database.
export DATABASE_URL="sqlite://./data/mmss.db"
export ADMIN_PASSWORD="a-local-admin-password"
export COOKIE_SECURE=true
export COOKIE_SAME_SITE=lax
export RUST_LOG=info,sqlx=warn

cargo run --release
```

```bash
# In another terminal -- exactly what the probes and a load balancer would see.
curl -sS localhost:3001/health   # {"status":"ok"}
curl -sS localhost:3001/ready    # {"status":"ok"}
curl -sS localhost:3001/metrics  | head -6

# The frontend boundary.
curl -sSi -X POST localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"studentId":"<roll>","password":"<password>"}' | grep -i set-cookie
```

Run the frontend against it:

```bash
cd <repo root>
npm run dev -- --port 5173
# then point the browser at http://localhost:5173
```

To exercise the **cross-origin** topology locally, run the backend on one port and the
frontend on another, then set `VITE_API_BASE_URL` before starting the frontend, together with
`ALLOWED_ORIGINS=http://localhost:5173`, `COOKIE_SAME_SITE=none` and `COOKIE_SECURE=true`. A
browser on plain HTTP will refuse that `Secure` cookie, so use a real HTTPS tunnel for this
check — which is the practical reason the rewrite topology is the recommended one.

## What R10 verified

`mmss-backend/tests/frontend_boundary.rs`, 14 tests over a **real TCP socket** using the real
Axum router, the real cookie name, and request bodies written exactly as
`src/lib/api.ts` writes them.

| Journey | Result |
| --- | --- |
| login → `/api/auth/me` → logout | pass, including server-side revocation |
| failed login shape (`authenticated:false` + `error`) | pass |
| student feed, and the frontend's own dedupe replayed over it | pass |
| legacy `PATCH /api/homework/:id/status` and `/note` (incl. `note: null`) | pass |
| filters narrow; malformed filters 400; `classId` of another class 403 | pass |
| teacher create → read → patch-one-field → delete → 404 | pass |
| teacher → unassigned class **403**; nonexistent class **400** | pass |
| forged `authorId`/`teacherId`/`role` | session wins |
| admin edits and deletes any homework | pass |
| cross-user and cross-class isolation | pass |
| role boundaries over the socket | pass |
| `/health`, `/ready`, `/metrics` + hardening headers on the wire | pass |
| error bodies carry `error` and `code`; unknown route is JSON 404 | pass |
| oversized body refused, non-5xx | pass |

Frontend side: `src/test/homeworkFeedContract.test.ts` (5 tests) pins the mapper against a
verbatim Rust response body. Full frontend suite: **136 tests, 23 files, all passing**;
`tsc --noEmit` and `eslint --max-warnings=0` clean.

## Blockers

Ordered by what stops a production deployment.

1. **A real frontend account.** No account exists except the provisioned admin. The old
   backend authenticated students through EduSecure; R3–R9 authenticate against local
   argon2 credentials. **Provisioning accounts at volume is not implemented** — it is the
   remaining gap before students can sign in. `ADMIN_PASSWORD` only creates one admin.
2. **`vercel.json` points at a bare IP over HTTP.** The browser-to-Vercel hop is TLS, but
   the Vercel-edge-to-VPS hop named at `vercel.json:8` is cleartext over the public
   internet. Everything on it is readable and rewritable in flight: the sign-in body
   (MMSS64 password, EduSecure password, the old and new password on
   `PATCH /auth/password`), the `Cookie:` request header, and the `Set-Cookie` /
   `token` response. Cookie `SameSite`/`Secure` still hold for the user agent, because
   that leg is HTTPS — the exposure is strictly the second hop. It needs a DNS A record
   and a certificate on the host; `infra/nginx/mmss64.conf` currently has `listen 80`
   only, no `ssl_certificate`, and `server_name _`, and `docs/AZURE-VPS.md` §8 still
   lists the domain as future work. **There is no in-repo change that fixes this** — it
   is a provisioning decision, so `vercel.json` is left untouched rather than pointed at
   a hostname nobody has registered. A repo-wide search for a registered domain returns
   only `*.vercel.app`, so there is nothing to point a certificate at. Full cutover plan,
   including the nginx configuration, certificate renewal, plaintext retirement and the
   verification commands: **`HTTPS-CUTOVER.md`**.

   **Related, and easy to miss:** `infra/nginx/mmss64.conf:24` proxies to
   `127.0.0.1:3000`, which is the *legacy Express* process (`server.js:318`), while the
   Rust API listens on `3001`. Enabling TLS without correcting the upstream would encrypt
   traffic to the old, non-hardened backend — the appearance of a fix without the fix.
   Which process the host actually serves today is **UNKNOWN** without SSH access.
3. **Production cookie mode is unverified, and possibly off.** `COOKIE_SECURE` defaults to
   `NODE_ENV == production` (`src/config.rs:203`), and the reference unit
   `infra/systemd/mmss64-backend.service` sets no `Environment=` line at all — it inherits
   everything from `EnvironmentFile=/etc/mmss64/mmss.env`. That file is `root:root 0600`
   and is **not in this repository**, so whether `NODE_ENV=production` (or an explicit
   `COOKIE_SECURE=true`) is set there is **UNVERIFIED**. If it is not, production cookies
   are minted without `Secure`.

   Note the two failure directions, because they differ: without `Secure`, cookies are
   still sent to the browser but an on-path observer on the plaintext Vercel hop can read
   them. `DEPLOYMENT.md` line 187 sets `COOKIE_SECURE=true` explicitly for local runs —
   the deployment recipe should do the same rather than relying on `NODE_ENV` being
   remembered. Explicit beats inferred: an explicit `COOKIE_SECURE=true` survives someone
   editing `NODE_ENV` later. See `HTTPS-CUTOVER.md` §5 for the verification command that
   reads the effective value back without printing a secret. **Not changed here** — the
   live unit and env file are owner-authorised surfaces.
4. **Frontend endpoints the Rust backend does not implement.** All 404 with the standard JSON
   envelope, so the UI degrades rather than crashes:
   `/api/auth/profile*`, `/api/auth/reconnect`, `/api/homework/refresh`, `/api/calendar*`,
   `/api/school-updates*`, `/api/users/*`, `/api/conversations*`, `/api/messages*`,
   `/api/notifications*`, `/api/requests*`, `/api/section/members`, `/api/classwork*`,
   `/api/admin/*`.
   One of these is user-visible on a normal path: `AppShell` prompts a student with no
   display name to set one, and `PATCH /api/auth/profile` 404s. `/api/homework/refresh` is
   only reached when `isStale` is true, and R4 always returns `false`, so it is dead code
   today.
5. **Single-writer SQLite.** One instance, or one writer with readers on the same host. WAL
   permits concurrent readers but only one writer; the 5-second busy timeout absorbs brief
   contention and does not make multi-writer safe.
6. **No reverse-proxy config in this repo.** `infra/nginx/mmss64.conf` is a reference copy
   for the *pre-HTTPS* topology and points at the wrong upstream (see Blocker 2). If
   Caddy/nginx fronts the process, it must set `X-Forwarded-Proto`, must not strip the
   `/api` prefix, and must bind the backend to loopback only.
7. **EduSecure authentication is unavailable and stays disabled.** No positive
   authentication signal has been observed; the legacy predicate in
   `server/edusecure/edusecureAuth.js:198` is a hand-maintained *deny*-list, so an
   unfamiliar portal response is accepted as success. `client_for` returns `DisabledClient`
   for every configuration and that is correct. The investigation plan, the criteria a safe
   predicate must meet, and the owner inputs required: **`EDUSECURE-INTEGRATION-PLAN.md`**.
   Do not port the legacy predicate, and do not auto-create an account from an unverified
   signal.

## What was deliberately not done

* The old `/api/teacher/*` surface (roster, attendance, duties, announcements, leave, student
  notes) is not reproduced. Those are separate features, not contract fixes, and
  `TEACHER_API_AUDIT.md` records which are unimplemented on purpose.
* No live EduSecure or AI transport. R7/R8 left the boundaries; the transports need a
  provider decision and a portal write endpoint that may not exist.
* No account-provisioning endpoint, no admin management CRUD for teacher assignments.

Not starting R11.