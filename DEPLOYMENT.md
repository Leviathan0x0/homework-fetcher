# Deployment

## Why sign-in works locally but fails on Appwrite

This project is two pieces:

- a Vite/React single-page app in `src/`
- an Express API in `server/` (`server.js`) that logs into the EduSecure school
  portal, stores sessions in SQLite and issues the `app_session` cookie

Locally these run in the same process: `vite.config.ts` registers a dev plugin
that hands every `/api/*` request to the Express app, so the SPA's relative
`fetch('/api/auth/login')` calls resolve on `http://localhost:5173`.

An Appwrite **Site** built with `npm run build` publishes only the static
`dist/` output — `server.js` never runs. A `POST /api/auth/login` against that
deployment is answered by the SPA fallback (HTML), the client then fails to parse
it as JSON, and the login form shows an error even though the credentials are
correct.

Two deployment topologies are supported:

## Option 1 — static frontend (Appwrite Sites) + Express API elsewhere

The Express API must be deployed to a Node host (Appwrite Function with a Node
runtime, Railway, Fly.io, a VPS, ...) because it needs a writable filesystem for
SQLite and outbound network access to `edusecure.in`.

Frontend build environment (baked in at build time):

| Variable | Example | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `https://homework-api.example.com` | Origin of the Express API. Without it the build has no API to talk to. |

API environment:

| Variable | Example | Purpose |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | `https://homework.appwrite.network` | Comma-separated frontend origins allowed to call the API with cookies. Enabling this also switches the session cookie to `SameSite=None; Secure` so the browser keeps it across origins. |
| `SQLITE_DB_PATH` | `/data/sqlite.db` | Writable, persistent path for the SQLite database. |
| `ENCRYPTION_KEY` | (random 32+ chars) | Key used to encrypt stored EduSecure session cookies. |
| `NODE_ENV` | `production` | Enables `Secure` cookies. |

Both origins must be HTTPS: `SameSite=None` cookies are rejected otherwise.

## Option 2 — one Node host serving both

Run `npm run build`, then `npm start`. Express serves `dist/` and `/api` from the
same origin, so `VITE_API_BASE_URL` and `ALLOWED_ORIGINS` stay unset and cookies
remain `SameSite=Lax`. Still set `ENCRYPTION_KEY`, `NODE_ENV=production` and, if
the app directory is read-only, `SQLITE_DB_PATH`.

## Troubleshooting

- **"No homework API is reachable at …"** — the build has no `VITE_API_BASE_URL`
  and nothing is serving `/api` on the frontend origin (Option 1 misconfigured).
- **"Could not reach the school portal …"** — the API host cannot make outbound
  requests to `edusecure.in`, or the portal is down. This is reported separately
  from wrong credentials.
- **Login succeeds but the app returns to the sign-in screen** — the
  `app_session` cookie was dropped. Check `ALLOWED_ORIGINS` matches the frontend
  origin exactly (scheme included) and that both sides are HTTPS.
- **"database is not writable"** — set `SQLITE_DB_PATH` to a writable volume; the
  automatic temp-directory fallback is wiped on every restart.
