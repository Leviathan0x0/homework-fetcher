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

## Environment variables

| Variable | Purpose |
| --- | --- |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Hosted libSQL database (required on serverless hosts) |
| `SQLITE_DB_PATH` | Local SQLite file location when not using a hosted database |
| `UPLOADS_DIR` | Directory for uploaded files (persistent volume) |
| `ENCRYPTION_KEY` | **Required.** 32+ character root secret for session cookie signing and EduSecure session encryption |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed to call the API with cookies |
| `VITE_API_BASE_URL` | Only when the frontend is hosted separately from the API |
