# Deployment

This project consists of two core components:
- A Vite/React single-page frontend (`src/`)
- An Express / Vercel Serverless API (`api/` and `server/`) backed by Appwrite Cloud & SQLite

## Deployment Architectures

### Option 1 — Vercel / Appwrite Cloud Serverless Deployment (Default)
- **Frontend**: Deployed as static SPA on Vercel / Appwrite Sites.
- **Serverless API**: Handled via `api/` serverless functions (`api/homework.js`, `api/messages.js`, `api/users.js`, `api/conversations.js`).
- **Persistence**: Appwrite Cloud Database & Storage (`COLLECTIONS.MESSAGES`, `COLLECTIONS.HOMEWORK`, `classwork-files`) + persistent `localStorage` caching to prevent data loss across redeployments.

### Option 2 — Node.js Host with Persistent SQLite
Run `npm run build`, then `npm start` on a Node host with a persistent disk (Railway, Render, Fly.io, or VPS).

Environment variables:
```bash
SQLITE_DB_PATH=/data/sqlite.db
UPLOADS_DIR=/data/uploads
SESSION_ENCRYPTION_KEY=<32-byte hex key>
NODE_ENV=production
```

## Environment Variables

| Variable | Example | Purpose |
| --- | --- | --- |
| `VITE_APPWRITE_ENDPOINT` | `https://sgp.cloud.appwrite.io/v1` | Appwrite Cloud Endpoint |
| `VITE_APPWRITE_PROJECT_ID` | `6a637cb9000e2ff291cf` | Appwrite Project ID |
| `VITE_APPWRITE_DATABASE_ID` | `6a637d61002bd18d3cd5` | Appwrite Database ID |
| `VITE_APPWRITE_BUCKET_ID` | `classwork-files` | Appwrite Storage Bucket ID |
