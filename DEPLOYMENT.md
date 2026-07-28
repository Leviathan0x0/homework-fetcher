# Deployment

The app has two parts:

- a static Vite bundle (`dist/`)
- an Express API (`server.js` + `server/`) that owns all data: accounts, conversations, messages,
  notifications, requests and classwork

On Vercel the Express app runs as a single function (`api/index.js`) and `vercel.json` rewrites
every `/api/*` request to it.

## Required: a hosted database

Serverless platforms give each deployment — and each instance — a fresh, temporary filesystem.
A local SQLite file therefore cannot be the source of truth: data is wiped on redeploy and two
students can end up reading two different copies of the database (a registered classmate looks
"not found" in search, and messages sent to you never appear).

Point the API at a hosted libSQL database (Turso has a free tier) and everything is shared and
permanent. No extra npm package is needed — the app talks to libSQL over HTTPS.

1. Create a database, e.g. with the Turso CLI:

   ```bash
   turso db create homework-fetcher
   turso db show homework-fetcher --url        # libsql://...
   turso db tokens create homework-fetcher     # auth token
   ```

2. Add these environment variables to the deployment (Vercel → Settings → Environment Variables):

   ```bash
   TURSO_DATABASE_URL=libsql://<your-db>.turso.io
   TURSO_AUTH_TOKEN=<token>
   ENCRYPTION_KEY=<32-byte hex key>
   OPENAI_API_KEY=<openai-api-key>
   NODE_ENV=production
   ```

   See **Content safety** below for what `OPENAI_API_KEY` does.

3. Redeploy. Tables and migrations are created automatically on the first request.

Message attachments are stored in the database as well when a hosted database is configured and
no persistent upload volume is set, so photos and PDFs survive redeploys too.

## Alternative: one Node host with a disk

If the API runs on a host with a persistent volume (Render, Railway, Fly.io, a VPS), local SQLite
is fine — just keep the files outside the deployment bundle:

```bash
SQLITE_DB_PATH=/data/sqlite.db
UPLOADS_DIR=/data/uploads
```

## Local development

The database is `sqlite.db` and uploads go to `uploads/` in the project root. The only required
setting is the root secret:

```bash
ENCRYPTION_KEY=$(openssl rand -hex 32)
```

`npm run dev` serves the frontend, `npm start` serves both API and built frontend.

## Troubleshooting

`GET /api/health` reports what the deployment is actually using: which database, whether it is
persistent, and whether `ENCRYPTION_KEY` is set. Start there — `"persistent": false` means data
(including EduSecure sessions) is being written to a temporary filesystem and no hosted database
is configured.

`ENCRYPTION_KEY` is **required everywhere, including local development**. It is the root secret for
both the session cookie signature and the encryption of stored EduSecure session cookies, and there
is no fallback value: without it the API answers every `/api` request with `503` and refuses to
start under `npm start`. Generate one with `openssl rand -hex 32`. Changing it signs out every
student and forces a fresh school portal login, which is exactly what you want if the old value
ever leaked.


`500 A server error has occurred` from `/api/...` means the function crashed while loading.
The API no longer creates directories or opens a database at import time, so the usual causes are
a missing build or a misconfigured database; a misconfigured database now answers with
`503` and the exact reason in the JSON body. Check the function logs in Vercel → Deployments →
Functions for the logged message.

## Authenticating a native mobile client

The web app authenticates with the httpOnly `app_session` cookie. Native clients cannot rely on
cookie storage, so `POST /api/auth/login` also returns the same signed token in the response body:

```json
{ "authenticated": true, "token": "<session token>", "user": { "id": "…", "studentId": "…" } }
```

Store it securely on the device and send it on every request:

```
Authorization: Bearer <token>
```

Both transports resolve to the same session, so the web app is unaffected. The token expires after
30 days; treat any `401` as "signed out" and return to the login screen. When the API and the client
are on different origins, add the client origin to `ALLOWED_ORIGINS`.

## Limits and safeguards

| Safeguard | Value |
| --- | --- |
| Upload size | 4 MB on serverless hosts (the platform rejects larger bodies), 10 MB elsewhere |
| Photo uploads | Downscaled in the browser to 1600px/JPEG before sending |
| Message length | 4000 characters |
| Request title / details | 120 / 2000 characters |
| JSON request body | 256 KB |
| Rate limits | 600 API requests, 40 messages, 20 uploads, 10 requests, 120 searches per minute per user |
| Notification retention | Read notifications older than `NOTIFICATION_RETENTION_DAYS` (default 30) are pruned |

Rate-limit counters live in the process, so on serverless hosts each instance counts separately;
they are a guard against runaway clients, not a hard quota. A shared store would be needed for
strict enforcement.

## Backups

With a hosted libSQL database, backups are the provider's responsibility — Turso keeps
point-in-time recovery for its databases. To take your own copy:

```bash
turso db shell <database> ".dump" > backup.sql
```

On a Node host with a local database, copy the file with SQLite's own backup command (a plain `cp`
of a live database can be inconsistent):

```bash
sqlite3 /data/sqlite.db ".backup '/data/backup-$(date +%F).db'"
tar czf /data/uploads-$(date +%F).tar.gz /data/uploads
```

## Not implemented yet

- **Realtime messaging.** The client polls (messages every 3s, inbox every 6s, both paused when the
  tab is hidden). WebSockets need a long-lived process, so they only make sense on a Node host, not
  on serverless functions.
- **Scheduled backups.** These need a cron host; run the commands above from a machine you control,
  or add a systemd timer when the API moves to a VPS.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Hosted libSQL database (required on serverless hosts) |
| `SQLITE_DB_PATH` | Local SQLite file location when not using a hosted database |
| `UPLOADS_DIR` | Directory for uploaded files (persistent volume) |
| `ENCRYPTION_KEY` | **Required.** 32+ character root secret for session cookie signing and EduSecure session encryption |
| `OPENAI_API_KEY` | See **Content safety** below |

| `ALLOWED_ORIGINS` | Comma-separated origins allowed to call the API with cookies |
| `VITE_API_BASE_URL` | Only when the frontend is hosted separately from the API |
| `NOTIFICATION_RETENTION_DAYS` | How long read notifications are kept (default 30) |

## Content safety (`OPENAI_API_KEY`)

This is only about blocking bad text and NSFW images in **Messages**, **Requests**, and **Classwork**.

### What students can send
- Text that is not abusive / NSFW
- Homework files only: **PDF** and photos (**JPG / PNG / WebP**)
- No Word/Excel/PPT, GIF, etc.

### How filtering works (two layers)
1. **Rules (always on)** — `profanity-hindi` + local bad-word list + file-type allowlist. Works even without any API key.
2. **AI (needs key)** — OpenAI **Moderation API** model `omni-moderation-latest` checks text and images for sexual / hate / harassment / self-harm / violence content and **hard-blocks** it (student sees a generic error; nothing is saved).

**Photos are stricter than text:** every image upload must pass AI moderation. If `OPENAI_API_KEY` is missing or the check fails, the photo is **blocked** (not skipped). Score thresholds for sexual / graphic content are set lower than OpenAI’s default flags so borderline NSFW is rejected for school use.

This is **not** ChatGPT. It is OpenAI’s cheap moderation endpoint, so checking lots of homework photos stays affordable.

### Staff flag log (database only for now)
- Table `admin_flag_log` stores staff-facing events.
- **3-strike rule:** each blocked vulgar/abuse **text** attempt **or vulgar/NSFW image** increments `moderation_strikes`. At **3** strikes, a `strike_threshold` row is written and the counter resets. (Failed photo *verification* / wrong file type does not count.)
- **Report this chat:** from Messages (flag icon), a student can report a conversation → `chat_report` row (who, which chat, when).
- No teacher UI yet — query these tables in the DB when staff need a review trail.

### What you need to set
1. Create an API key at [platform.openai.com](https://platform.openai.com/api-keys).
2. Add this env var on the server / Vercel:

```bash
OPENAI_API_KEY=sk-...
```

3. Redeploy.

| Where | `OPENAI_API_KEY` |
| --- | --- |
| Production (school live site) | **Set it** — AI image/text checks run |
| Your laptop (local) | Optional — rules still block bad words and wrong file types; AI is skipped and the server logs a warning |

### What is not checked yet
- Inside of PDFs (no OCR) — only the file type is allowed
- Teacher dashboard for the flag log — data is stored; UI comes later

