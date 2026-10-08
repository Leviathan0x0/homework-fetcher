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
| `SESSION_TTL_DAYS` | `30` | Matches the old backend deliberately. |
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
verbatim Rust response body. Full frontend suite: **108 tests, 21 files, all passing**;
`tsc --noEmit` clean.

## Blockers

Ordered by what stops a production deployment.

1. **A real frontend account.** No account exists except the provisioned admin. The old
   backend authenticated students through EduSecure; R3–R9 authenticate against local
   argon2 credentials. **Provisioning accounts at volume is not implemented** — it is the
   remaining gap before students can sign in. `ADMIN_PASSWORD` only creates one admin.
2. **`vercel.json` points at a bare IP over HTTP.** Replace with a hostname so TLS is
   terminated at the edge and `COOKIE_SECURE` can be true. Not changed by R10 (explicitly out
   of scope), but it must change before production.
3. **Frontend endpoints the Rust backend does not implement.** All 404 with the standard JSON
   envelope, so the UI degrades rather than crashes:
   `/api/auth/profile*`, `/api/auth/reconnect`, `/api/homework/refresh`, `/api/calendar*`,
   `/api/school-updates*`, `/api/users/*`, `/api/conversations*`, `/api/messages*`,
   `/api/notifications*`, `/api/requests*`, `/api/section/members`, `/api/classwork*`,
   `/api/admin/*`.
   One of these is user-visible on a normal path: `AppShell` prompts a student with no
   display name to set one, and `PATCH /api/auth/profile` 404s. `/api/homework/refresh` is
   only reached when `isStale` is true, and R4 always returns `false`, so it is dead code
   today.
4. **Single-writer SQLite.** One instance, or one writer with readers on the same host. WAL
   permits concurrent readers but only one writer; the 5-second busy timeout absorbs brief
   contention and does not make multi-writer safe.
5. **No reverse-proxy config in this repo.** If Caddy/nginx fronts the process, it must set
   `X-Forwarded-Proto` and must not strip the `/api` prefix.

## What was deliberately not done

* The old `/api/teacher/*` surface (roster, attendance, duties, announcements, leave, student
  notes) is not reproduced. Those are separate features, not contract fixes, and
  `TEACHER_API_AUDIT.md` records which are unimplemented on purpose.
* No live EduSecure or AI transport. R7/R8 left the boundaries; the transports need a
  provider decision and a portal write endpoint that may not exist.
* No account-provisioning endpoint, no admin management CRUD for teacher assignments.

Not starting R11.