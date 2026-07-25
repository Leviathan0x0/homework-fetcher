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
   NODE_ENV=production
   ```

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

No configuration needed: the database is `sqlite.db` and uploads go to `uploads/` in the project
root. `npm run dev` serves the frontend, `npm start` serves both API and built frontend.

## Troubleshooting

`GET /api/health` reports what the deployment is actually using: which database, whether it is
persistent, and whether `ENCRYPTION_KEY` is set. Start there — `"persistent": false` means data
(including EduSecure sessions) is being written to a temporary filesystem and no hosted database
is configured.

Session cookies are signed with a key derived from `ENCRYPTION_KEY`, so **set `ENCRYPTION_KEY` in
production**: without it the public default key is used and the warning is logged on startup.


`500 A server error has occurred` from `/api/...` means the function crashed while loading.
The API no longer creates directories or opens a database at import time, so the usual causes are
a missing build or a misconfigured database; a misconfigured database now answers with
`503` and the exact reason in the JSON body. Check the function logs in Vercel → Deployments →
Functions for the logged message.

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
| `ENCRYPTION_KEY` | AES key used to encrypt stored EduSecure session cookies |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed to call the API with cookies |
| `VITE_API_BASE_URL` | Only when the frontend is hosted separately from the API |
| `NOTIFICATION_RETENTION_DAYS` | How long read notifications are kept (default 30) |
