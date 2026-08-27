# Loading delays outside the application

Last reviewed: 2026-08-27

This note separates work the application owns from waits imposed by EduSecure,
the hosted database, the hosting platform, or the user's connection. The
numbers below are exact configured ceilings from the current code. They are not
presented as production percentiles: this checkout has no production secrets,
and the deployed site was unreachable from the isolated test environment.

Every deployed API response now includes a standard `Server-Timing` header. The
server also writes a structured `[performance]` log with durations in
milliseconds when the request contains a measured external dependency or takes
at least 250 ms. Set `PERFORMANCE_TIMING_LOG_ALL=true` temporarily when every
fast request must be retained as a log. The relevant names are:

- `database_ready`: time waiting for cold-start database initialization.
- `database` / `database_batch`: one hosted libSQL HTTPS round trip.
- `edusecure_login`: the complete EduSecure WebForms login handshake.
- `edusecure_profile`: both profile pages, including retries and parsing.
- `edusecure_homework`: homework page load, retries, body download, and parsing.
- `edusecure_calendar`: calendar and dashboard page loads plus parsing.
- `edusecure_attendance`: attendance discovery and candidate page loads.
- `edusecure_notices`: circular or important-message page load and parsing.
- `edusecure_attachment`: complete proxied school-file download.
- `total`: complete API handling time.

Background homework prefetches are logged separately with
`"background":true`, because they can finish after the login response.

## Local baseline recorded on 2026-08-27

These five-run samples used the local Vite/Express process and local SQLite.
They show how little time the application itself needs when no network
dependency is involved; they must not be substituted for hosted production
measurements.

| Route | Five exact `total` values | Median |
| --- | --- | ---: |
| `GET /api/health` | 1.3, 0.8, 1.1, 1.1, 0.9 ms | 1.1 ms |
| `GET /api/auth/me` with a warm app session | 1.9, 0.7, 0.9, 0.7, 0.6 ms | 0.7 ms |
| Local admin `POST /api/auth/login` | 2.5, 2.7, 4.0, 2.4, 2.2 ms | 2.5 ms |

The same `GET /api/auth/me` runs recorded `database_ready` values of 0.1,
0.1, 0.0, 0.0, and 0.1 ms. Production libSQL and EduSecure timings require a
deployment with its hosted credentials and are intentionally recorded there,
not guessed from this local baseline.

## Exact wait budgets

| External wait | Exact configured delay | What a student experiences |
| --- | ---: | --- |
| Browser waiting for a bodyless API call | 20,000 ms | GETs and bodyless refresh POSTs stop waiting and show a retryable error at 20 seconds. |
| Browser waiting for a request with a body | 90,000 ms | Uploads, login, and JSON writes are allowed up to 90 seconds by the shared client. |
| EduSecure login page GET | 15,000 ms | This must complete before credentials can be submitted. |
| EduSecure login POST | 15,000 ms per school-year option | One sequential POST is required per attempted year. With the two fallback years, the EduSecure handshake can consume 45,000 ms: 15,000 + 15,000 + 15,000. |
| EduSecure profile pages | Two requests in parallel; 12,000 ms per attempt, two attempts, 500 ms retry pause | Exact critical-path ceiling is 24,500 ms. Because the two pages run together, it is 12,000 + 500 + 12,000, not twice that value. |
| EduSecure homework refresh | 20,000 ms per attempt, two attempts, 750 ms retry pause | Exact server-side ceiling is 40,750 ms. A cached list avoids this foreground wait; an empty cache or forced refresh does not. The bodyless browser request stops waiting after 20,000 ms. |
| EduSecure school notices | 20,000 ms per attempt, two attempts, 750 ms retry pause | Exact server-side ceiling is 40,750 ms for a circular or important-message page. The 15-minute in-memory cache normally moves this off the foreground path. |
| EduSecure attendance | Two sequential phases; every request in each phase runs in parallel with a 12,000 ms timeout | Exact server-side critical-path ceiling is 24,000 ms. The first phase discovers links; the second checks all candidate attendance pages. |
| EduSecure calendar | Calendar and dashboard pages run in parallel, with no server-side timeout | The browser stops waiting after 20,000 ms, but the server-side EduSecure fetch is currently unbounded. `edusecure_calendar` records the actual duration. |
| EduSecure attachment proxy | 120,000 ms total by default | The complete upstream file stream is allowed two minutes. `SCHOOL_ATTACHMENT_TIMEOUT_MS` can change the exact ceiling, with a 1,000 ms minimum. |
| Hosted libSQL query | 2,500 ms per attempt, three attempts, 150 ms then 300 ms retry pauses | Exact ceiling for one ordinary database round trip is 7,950 ms. A route with sequential queries can pay it more than once. |
| Hosted libSQL schema batch on a cold start | 10,000 ms per attempt, three attempts, 150 ms then 300 ms retry pauses | Exact ceiling for the schema batch is 30,450 ms. `database_ready` records how much of this the individual request actually waited for. |
| Session cache | 10,000 ms lifetime | Requests within ten seconds reuse the verified session and avoid another hosted database session lookup. This is a cache duration, not added latency. |
| Homework cache | 15 minutes by default | Existing homework can render without waiting for EduSecure; refresh happens in the background when stale. This is a freshness window, not added latency. |

## Changes the owner can make

1. Put the Vercel function and Turso/libSQL database in the same geographic
   region. This removes avoidable cross-region round trips; the `database`
   timings confirm the result after deployment.
2. Keep the frontend and API on the same origin. A separate static frontend
   adds DNS/TLS work and CORS preflight requests that do not occur on the
   current same-origin setup.
3. Use non-sleeping production tiers for the API and database if cold starts
   appear in `total` or `database_ready`. Compare warm and first-request values
   before paying for a tier change.
4. Ask EduSecure for a supported API or webhook, and ask them to allowlist the
   hosting provider's outbound traffic. The current WebForms integration must
   perform sequential HTML page loads and cannot remove that network time.
5. Keep `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` configured in production.
   Falling back to a serverless temporary SQLite file loses data and does not
   provide a shared cache.
6. After deploying, collect at least 24 hours of `[performance]` logs and rank
   p50/p95 by timing name. Make the next hosting or EduSecure decision from
   those observed values instead of reducing the timeout ceilings blindly.
