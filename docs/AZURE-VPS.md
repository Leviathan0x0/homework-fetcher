# Azure VPS production runbook

> **Superseded.** This runbook is written for the Vercel + Express + libSQL
> deployment. Production is now nginx → `web/build` (SvelteKit, adapter-node,
> `:3002`) → `mmss-backend` (Rust, `:3001`) → SQLite, all on this VM.
> **`FINAL_MIGRATION.md` is the current runbook**, and `infra/systemd/
> mmss64-backend.service`, `infra/systemd/mmss64-frontend.service` and
> `infra/nginx/mmss64-sveltekit.conf` are the reference configuration.
>
> Kept for the rollback path and for the VPS facts that are still true: the
> `/etc/mmss64/` layout, the SQLite backup procedure, and the TLS story. The
> topology, ports, processes and health checks below are not current — note
> especially that `GET :3000/api/health` is now `GET :3001/health`.

Old architecture (frontend stays on Vercel, backend + data move to the VPS):

```
Browser → https://mmss64.vercel.app            (permanent public URL)
            ├── /        → Vercel serves the Vite build (dist/)
            └── /api/*   → Vercel external rewrite (server-side proxy)
                            → http://57.155.88.204 (Nginx :80)
                              → Express 127.0.0.1:3000 (systemd: mmss64)
                                → SQLite /var/lib/mmss64/mmss.db (WAL, local disk)
```

Future (school domain): DNS → Nginx → static `dist/` + Express → same SQLite.
Nothing in the app may hardcode the VPS IP or Vercel specifics — frontend API
URLs stay relative (`/api/...`), backend config stays environment-based.

Reference configs live in the repo:

| File | On the VPS |
| --- | --- |
| `infra/nginx/mmss64.conf` | `/etc/nginx/sites-available/mmss64.conf` |
| `infra/systemd/mmss64.service` | `/etc/systemd/system/mmss64.service` (already installed) |
| `infra/systemd/mmss64-backup.service` / `.timer` | `/etc/systemd/system/` |
| `scripts/backup-sqlite.sh` | `/opt/mmss64/repo/scripts/backup-sqlite.sh` |
| `scripts/migrate-remote-to-local.js` | run once for the Turso → VPS copy |

---

## 1. VPS setup and verification

```bash
# Code + dependencies (as the app user)
cd /opt/mmss64/repo && git fetch && git pull
sudo -u mmssapp npm ci --omit=dev        # backend-only; use plain `npm ci`
                                          # plus `npm run build` if the VPS
                                          # should also serve dist/ directly

# better-sqlite3 native binding loads
sudo -u mmssapp node -e "require('better-sqlite3'); console.log('better-sqlite3 OK')"

# The env file exists with correct ownership (values must never be echoed)
sudo stat -c '%U:%G %a' /etc/mmss64/mmss.env        # expect: root:root 600

# Directories
sudo mkdir -p /var/lib/mmss64 /var/backups/mmss64 /var/log/mmss64
sudo chown mmssapp:mmssapp /var/lib/mmss64 /var/backups/mmss64 /var/log/mmss64
```

Manual start (foreground; Ctrl-C to stop — systemd reads the root-only env
file, this shells into it without printing any values):

```bash
sudo bash -c 'set -a; . /etc/mmss64/mmss.env; set +a; \
  exec runuser -u mmssapp -- /usr/bin/node /opt/mmss64/repo/server.js'
```

Then, in a second terminal:

```bash
curl -sS http://127.0.0.1:3000/api/health     # expect HTTP 200, "ok": true
```

systemd + restart-on-failure:

```bash
sudo systemctl enable --now mmss64
sudo systemctl is-active mmss64               # active
sudo systemctl kill -s SIGKILL mmss64         # simulate a crash
sleep 5 && systemctl is-active mmss64         # active again (Restart=always)
```

Nginx:

```bash
sudo cp infra/nginx/mmss64.conf /etc/nginx/sites-available/mmss64.conf
sudo ln -sf /etc/nginx/sites-available/mmss64.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
curl -sS http://127.0.0.1/api/health           # via Nginx
curl -sS http://57.155.88.204/api/health       # public (HTTP)
```

Azure NSG: only **80**, **443** (when a certificate exists) and **22**
restricted to the admin IP. Port 3000 stays closed; Express binds
`127.0.0.1` (`HOST` overrides).

### Which database is production?

```bash
# The running process must have this file open:
sudo lsof -p "$(pgrep -f 'node /opt/mmss64/repo/server.js')" | grep '\.db'

# And it must be in WAL mode:
sqlite3 /var/lib/mmss64/mmss.db 'PRAGMA journal_mode;'     # expect: wal
sqlite3 /var/lib/mmss64/mmss.db 'SELECT COUNT(*) FROM users;'
```

There must be exactly one production database file. Never let
`TURSO_DATABASE_URL` / `LIBSQL_URL` / `DATABASE_URL` leak into
`/etc/mmss64/mmss.env` — with a remote URL set, the app would silently bypass
`SQLITE_DB_PATH` and talk to Turso again.

---

## 2. Environment variables

### A. Backend secrets — `/etc/mmss64/mmss.env` (root:root, chmod 600)

| Variable | Purpose |
| --- | --- |
| `ENCRYPTION_KEY` | **Required.** Session-cookie signing + EduSecure session encryption. Already set. Rotating it signs out every student. |
| `TYPESAFE_API_KEY` | Remote Jev classification/profanity provider (fallback behind local Laya). |
| `AI_STUDIO_API_KEY` (or `GEMINI_API_KEY`) | Remote Gemma formatter (fallback behind local Gemma). |
| `OPENAI_API_KEY` | Image moderation — photo uploads fail closed without it. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Admin sign-in; there is no source fallback password. |
| `TEACHER_TEST_USERNAME` / `TEACHER_TEST_PASSWORD` | Demo teacher portal; refused in production without a password. |

### B. Backend configuration — same file

| Variable | Value / purpose |
| --- | --- |
| `SQLITE_DB_PATH` | `/var/lib/mmss64/mmss.db` (already set). |
| `UPLOADS_DIR` | `/var/lib/mmss64/attachments` — keeps uploads out of the repo and inside the backup set. |
| `ALLOWED_ORIGINS` | `https://mmss64.vercel.app` — required behind the proxy: CORS, the cross-site POST check and `SameSite=None; Secure` cookies all key off it. |
| `NODE_ENV` | `production` |
| `HOST` / `PORT` | Defaults `127.0.0.1` / `3000` — nothing to set. |
| `SENTRY_ENABLED`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_BROWSER_ENABLED`, `SENTRY_TRACES_SAMPLE_RATE` | Optional, as on Vercel. |
| `EDUSECURE_TEACHER_IDS`, `EDUSECURE_ATTENDANCE_URL` | Optional, unchanged from before. |
| `CACHE_MAX_AGE_MINUTES`, `NOTIFICATION_RETENTION_DAYS`, `ENABLE_PAST_DAYS_RECLASSIFY`, `RECLASSIFY_*`, `TYPESAFE_TIMEOUT_MS`, `FORMATTER_TIMEOUT_MS` | Optional tuning, unchanged from before. |
| `LAYA_ENABLED`, `LAYA_URL`, `GEMMA_ENABLED`, `GEMMA_URL`, `AI_LOCAL_TIMEOUT_MS` | Local AI layer — **default off**; see §6. |

Never set: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `LIBSQL_URL`,
`LIBSQL_AUTH_TOKEN`, a remote `DATABASE_URL`.

### C. Frontend / build-time — Vercel project settings only

| Variable | Purpose |
| --- | --- |
| `VITE_SENTRY_ENABLED`, `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT`, `VITE_SENTRY_RELEASE`, `VITE_SENTRY_TRACES_SAMPLE_RATE` | Browser Sentry. |
| `VITE_API_BASE_URL` | **Must stay unset.** Unset keeps every API URL relative (`/api/...`), which is what makes the Vercel → VPS proxy work and keeps the VPS IP out of the bundle. |

### D. Development-only — local `.env`, never production

`ENCRYPTION_KEY` (dev value), `ADMIN_PASSWORD`, `TEACHER_TEST_PASSWORD`,
`TYPESAFE_API_ENDPOINT`, `AI_STUDIO_API_KEY`, `GEMINI_API_KEY`,
`VITE_LASSO_API_KEY`, `VITE_APPWRITE_*` (no code references remain).

### E. Obsolete after this migration

`TURSO_*`, `LIBSQL_*`, remote `DATABASE_URL`, `TRANSPORT_PROBE_TOKEN`,
`VERCEL*`/Lambda platform flags (platform-provided, not ours to set). Keep the
Turso database itself alive and paid-free until §5's rollback window closes —
just stop pointing at it.

---

## 3. Data migration: Turso → `/var/lib/mmss64/mmss.db`

The script copies every table with `INSERT OR IGNORE` (existing local rows are
never overwritten), pages large attachment tables, defers nothing it cannot
prove, and finishes with `PRAGMA foreign_key_check`. It is covered by
`test/scripts/migrate.test.js`.

```bash
sudo systemctl stop mmss64
cd /opt/mmss64/repo

# Read credentials without putting them in shell history:
read -rp 'TURSO_DATABASE_URL: ' TURSO_DATABASE_URL
read -rsp 'TURSO_AUTH_TOKEN: ' TURSO_AUTH_TOKEN; echo

sudo -u mmssapp env TURSO_DATABASE_URL="$TURSO_DATABASE_URL" \
  TURSO_AUTH_TOKEN="$TURSO_AUTH_TOKEN" \
  SQLITE_DB_PATH=/var/lib/mmss64/mmss.db \
  node scripts/migrate-remote-to-local.js --dry-run     # row counts only

# Same command without --dry-run to copy.
unset TURSO_DATABASE_URL TURSO_AUTH_TOKEN

sudo systemctl start mmss64
curl -sS http://127.0.0.1:3000/api/health
```

Re-running is safe (idempotent). Verify counts afterwards with the queries in
§1, and spot-check a login + homework load before deleting anything anywhere.

---

## 4. Vercel cutover

`vercel.json` now contains a documented Vercel **external rewrite**
(`rewrites` to an external origin = server-side proxy; the browser never sees
the IP) plus `x-vercel-enable-rewrite-caching: 0` so no API response —
especially `Set-Cookie` — is ever CDN-cached:

```json
{ "source": "/api/:path*", "destination": "http://57.155.88.204/api/:path*" },
{ "source": "/(.*)", "destination": "/index.html" }
```

`api/index.js` (the old serverless entry) is removed on purpose: Vercel checks
the filesystem *before* rewrites, so leaving it would keep routing `/api` and
`/api/index` to the dead Turso-backed function. `api/transport-probe.js` is a
temporary diagnostic (token-gated) — delete it when probing is done.

Deploy = push to the connected repo (or `vercel --prod`). Frontend build,
SPA fallback and relative API URLs are unchanged.

---

## 5. Verification checklist

Run in order; do not call the migration done until all pass.

1. `npm ci` succeeds on the VPS.
2. `sudo -u mmssapp node -e "require('better-sqlite3')"` → OK.
3. `sqlite3 /var/lib/mmss64/mmss.db 'PRAGMA journal_mode;'` → `wal`; `lsof` shows the service holds that file.
4. Manual start (§1) reaches the listen line.
5. `curl -sS http://127.0.0.1:3000/api/health` → 200.
6. `systemctl is-active mmss64` → `active`.
7. `systemctl kill -s SIGKILL mmss64`; 5 s later → `active` again.
8. `curl -sS http://127.0.0.1/api/health` (Nginx) → 200.
9. `curl -sS http://57.155.88.204/api/health` (public) → 200.
10. `vercel build` / CI build passes (`npm run check` locally).
11. `curl -sS https://mmss64.vercel.app/api/health` → 200 (proxied; `Server-Timing`/JSON proves it came from Express, not Vercel).
12. Login (fresh browser, devtools open: one `POST /api/auth/login`, `Set-Cookie: app_session` visible, no CORS errors).
13. `GET /api/auth/me` → 200 with the same cookie.
14. Homework list loads.
15. Homework refresh (`POST /api/homework/refresh`) returns; note its Server-Timing total — the remote-DB 12–20 s tail should be gone.
16. Calendar loads.
17. Conversations + messages send/receive.
18. Attachment upload **and** download (proves `client_max_body_size 12m` and `UPLOADS_DIR`).
19. Notes (homework note PATCH) save.
20. Logout clears the cookie.
21. Restart the service; homework/messages still present (SQLite persists).
22. `sudo reboot`; after boot: service active, health 200, data present.
23. Set `LAYA_ENABLED=true` with the service *not running* → homework flows still work (failure returns null in ≤ `AI_LOCAL_TIMEOUT_MS`, background pass falls through).
24. With local AI off/unavailable, a subject/format pass still reaches remote Jev/AI Studio when their keys are set.
25. `npm run check` (lint, typecheck, server+frontend tests, build, both audits).
26. `npm run audit` / `audit:production` clean at `--audit-level=high`.

Also confirm from the browser network tab: **every** request stays on
`mmss64.vercel.app` — no request ever targets `57.155.88.204`.

---

## 6. Backups and restore

`scripts/backup-sqlite.sh` (nightly via `mmss64-backup.timer` at 03:17 ±15 m):

- `sqlite3 .backup` — the SQLite **backup API**, consistent against a live WAL
  database (never a plain `cp`).
- `PRAGMA integrity_check` on the snapshot; a bad snapshot fails the run.
- Attachments tar'd from `UPLOADS_DIR`.
- Newest `BACKUP_KEEP` (default 14) generations kept, older pruned.
- Optional off-VM upload while Azure credits last: set `BACKUP_AZURE_URL`
  (container URL + SAS) in a root-only `/etc/mmss64/backup.env`. Unset it and
  the whole stack still works — no Azure dependency anywhere in the app.

Install:

```bash
sudo cp infra/systemd/mmss64-backup.service infra/systemd/mmss64-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mmss64-backup.timer
sudo systemctl start mmss64-backup.service     # first run now; check /var/backups/mmss64
```

### Restore procedure

```bash
sudo systemctl stop mmss64
ls -1t /var/backups/mmss64/mmss-*.db           # pick a generation

# Replace the primary (WAL sidecars of the old file go too):
sudo -u mmssapp rm -f /var/lib/mmss64/mmss.db /var/lib/mmss64/mmss.db-wal /var/lib/mmss64/mmss.db-shm
sudo -u mmssapp cp /var/backups/mmss64/mmss-<STAMP>.db /var/lib/mmss64/mmss.db

# Attachments (only if files are missing/lost):
sudo -u mmssapp tar -xzf /var/backups/mmss64/uploads-<STAMP>.tar.gz -C /var/lib/mmss64

sudo systemctl start mmss64
curl -sS http://127.0.0.1:3000/api/health
sqlite3 /var/lib/mmss64/mmss.db 'PRAGMA integrity_check;'
```

Restore to a different host the same way (any Linux + Node ≥22): copy the
repo, restore the snapshot to `SQLITE_DB_PATH`, restore uploads to
`UPLOADS_DIR`, set the env file — nothing Azure-specific involved.

---

## 7. Optional local AI layer (phase 2 — after the backend is stable)

The backend already contains the routing; no model is installed yet:

```
applyAiToRows (background pass, never on the HTTP path)
  classify: localClassify (Laya)  → null → remote Jev → deterministic regex/defaults
  format:   localFormat  (Gemma)  → null → remote AI Studio → pass-through
```

Any local failure (disabled, connection refused, timeout, malformed JSON, 3
consecutive failures → 60 s cooldown) returns `null` and the remote/deterministic
path runs unchanged — proven by `test/ai/localAi.test.js`.

To enable later, run two HTTP services **bound to `127.0.0.1 only`** (loopback,
never `0.0.0.0`; NSG already blocks the ports, loopback makes it certain):

| | Laya Multilingual (~322M) | `google/gemma-4-E2B-it` |
| --- | --- | --- |
| Role | classifier: subject, homework-vs-not, formatting verdict, light filtering | formatter: messy teacher text → structured homework/classwork |
| Port | `127.0.0.1:8001` (`LAYA_URL`) | `127.0.0.1:8002` (`GEMMA_URL`) |
| Runtime | CPU, quantized (GGUF Q4–Q8 via llama.cpp/Ollama-style server + tiny shim) | CPU, **quantized** Q4_K_M — never BF16 on this box |
| Endpoint | `POST /classify` | `POST /format` |

Contracts (JSON):

```jsonc
POST http://127.0.0.1:8001/classify
{ "text": "...", "section": "10-A" }
→ { "subject": "Mathematics", "is_formatted": false }
// subject: a canonical subject name or "School Diary"
// is_formatted: false only when the text genuinely needs rewriting

POST http://127.0.0.1:8002/format
{ "text": "...", "subject": "Mathematics" }
→ { "homework": "Ex 4, 5 on p. 32", "classwork": null }
```

Rules both services must honor:

- p95 well under `AI_LOCAL_TIMEOUT_MS` (default 3000 ms) — the caller aborts at
  that budget and falls back.
- Return valid JSON only; anything else is treated as a failure.
- One model process per service, bounded concurrency ≤ 4 (the caller's limit),
  lazy load at startup so boot stays fast.
- 16 GiB budget: quantized Laya (~0.4 GiB) + quantized E2B (~2 GiB) fits with
  the Node process comfortably; never run both at BF16 (~6+ GiB each).

Then in `/etc/mmss64/mmss.env`:

```
LAYA_ENABLED=true
LAYA_URL=http://127.0.0.1:8001
GEMMA_ENABLED=true
GEMMA_URL=http://127.0.0.1:8002
AI_LOCAL_TIMEOUT_MS=3000
```

Remote `TYPESAFE_API_KEY` / `AI_STUDIO_API_KEY` stay configured — they are the
fallback and the service that guarantees behavior parity if local AI is off.

---

## 8. Moving off Vercel later (school domain)

1. Build the frontend on the VPS (`npm ci && npm run build` → `dist/`).
2. Point DNS (school domain) at `57.155.88.204`; Nginx already proxies
   everything to Express, which already serves `dist/`.
3. Add the domain to `ALLOWED_ORIGINS` (or drop it entirely once same-origin).
4. Remove the external rewrite / delete the Vercel project.

Rollback window for the cutover itself: `git revert` of the `vercel.json`
commit restores `/api/*` → `api/index.js` → Turso (stale data, but online) as
long as the Turso credentials remain in Vercel's env and the Turso database is
not deleted.
