# Deployment

The app is split in two parts:

- a static Vite bundle (`dist/`)
- an Express API (`server.js` + `server/`) backed by SQLite (`better-sqlite3`) and local file uploads

## Why messages disappear after a Vercel redeploy

Vercel builds a **new, read-only, ephemeral filesystem on every deploy** and every serverless
invocation may run on a different instance. The SQLite file (`sqlite.db`) and the `uploads/`
folder live on that filesystem, so:

- users, conversations and messages are wiped on each redeploy,
- two users can end up talking to two different instances, which makes a registered student
  look like they "do not exist" in search and hides messages sent by someone else.

Static hosting on Vercel is fine, but the API needs a host with persistent storage.

## Recommended setup

1. Deploy the Express server (`npm start`) on a host that supports a persistent disk, e.g.
   Render, Railway, Fly.io or any VPS.
2. Mount a volume (for example at `/data`) and point the app at it:

   ```bash
   SQLITE_DB_PATH=/data/sqlite.db
   UPLOADS_DIR=/data/uploads
   SESSION_ENCRYPTION_KEY=<32-byte hex key>
   NODE_ENV=production
   ```

3. Keep the frontend on Vercel and proxy `/api/*` to the API host, or serve the built
   `dist/` folder directly from the Express server (it already does this).

Both variables are optional in local development: without them the database is written to
`sqlite.db` and uploads to `uploads/` in the project root.

## Fully serverless alternative

If the API must stay on Vercel, SQLite on disk cannot be used. Move the data to a hosted
database (for example Turso/libSQL) by installing `@libsql/client` and swapping the driver in
`server/db/client.js` for `drizzle-orm/libsql`. Note that the libSQL driver is asynchronous,
so the route handlers have to be awaited as well.
