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
   SESSION_ENCRYPTION_KEY=<32-byte hex key>
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

## Environment variables

| Variable | Purpose |
| --- | --- |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Hosted libSQL database (required on serverless hosts) |
| `SQLITE_DB_PATH` | Local SQLite file location when not using a hosted database |
| `UPLOADS_DIR` | Directory for uploaded files (persistent volume) |
| `SESSION_ENCRYPTION_KEY` | AES key used to encrypt stored EduSecure session cookies |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed to call the API with cookies |
| `VITE_API_BASE_URL` | Only when the frontend is hosted separately from the API |
