# Phase 9 — production hardening

Scope: the whole `mmss-backend` after R1–R8, plus the old `server.js` as the reference for
what hardening this application actually needed. Nothing outside `mmss-backend/` was
modified.

## Summary

R9 started with a router carrying exactly two layers: `TraceLayer` and `CatchPanicLayer`.
Everything below is a real gap found by reading R1–R8 against the old server's `helmet()`
call and its allowlist-based CORS, not a checklist worked through for its own sake.

Six findings were worth fixing. Four things that look like gaps were investigated and
deliberately **not** changed, and are listed at the end.

| # | Finding | Severity | Fix |
| --- | --- | --- | --- |
| 1 | `/health` reported **200 OK** when the database was unusable | **High** — operational | split into `/health` and `/ready` |
| 2 | No CORS layer at all | **High** — accidental safety only | explicit fail-closed allowlist |
| 3 | No security headers | Medium | `nosniff`, `X-Frame-Options`, `Referrer-Policy` |
| 4 | No request/correlation id | Medium | minted per request, echoed to the caller |
| 5 | Body limit 8× looser than the old contract | Medium | explicit 256 KB, clamped |
| 6 | `shutdown_signal` panicked on handler-install failure | Low | log and drain instead |

## 1. Liveness and readiness were conflated — the real bug

The single endpoint before R9:

```rust
let alive = sqlx::query_scalar::<_, i64>("SELECT 1").fetch_one(&state.db).await.is_ok();
Json(Health { status: if alive { "ok" } else { "degraded" } })
```

A JSON body, always **200 OK**. A load balancer reads the status code, not the body. So a
process that could not reach its database was reported healthy, kept receiving traffic, and
returned 500s to every caller — while the one signal that would have explained why
(`"status": "degraded"`) sat unread in a response nobody was parsing.

Worse in the other direction: because liveness touched the database, a slow database would
make the process look unhealthy and get an orchestrator to kill and restart it, straight back
into the same slow database.

Split into three:

| Endpoint | Touches the database? | Answers |
| --- | --- | --- |
| `GET /health` | **no** | liveness: is the process up |
| `GET /ready` | yes | readiness: **503** when the database is unusable |
| `GET /metrics` | no | Prometheus counters |

Readiness and metrics bodies never name the failure. A probe is unauthenticated, and a
database error message is exactly the internal detail that must not be readable by anyone
who can reach the port.

## 2. CORS: accidental safety replaced with an enforced policy

The old `server.js` ran `helmet()` plus an `ALLOWED_ORIGINS` allowlist, granting
`Access-Control-Allow-Credentials: true` to listed origins and failing closed for everything
else. The Rust backend had no CORS layer at all.

It was *not* exploitable as written — a browser will not attach cookies to a cross-origin
request without `Access-Control-Allow-Origin` plus credentials, so the absence of the layer
happened to deny everything. That is the problem: the protection was a side effect of the API
being cookie-authenticated, not a decision. Any future move to a token header, or any
non-browser client, would have removed it silently.

`ALLOWED_ORIGINS` is now honoured, comma-separated. Empty — the default — denies every
cross-origin browser call, which is correct for the shipped deployment because `vercel.json`
rewrites `/api/*` through same-origin. `allow_credentials(true)` is never combined with a
wildcard, and `Vary: Origin` is set so a cached response cannot be replayed across origins.

## 3. Security headers: three, chosen rather than wholesale

`x-content-type-options: nosniff` matters here specifically because an attachment's
`mimeType` is caller-supplied metadata. `x-frame-options: DENY` because there is nothing to
frame and this is a cookie-authenticated API. `referrer-policy: no-referrer` because request
URLs here carry ids.

Deliberately **absent**:

* **HSTS** — only safe to send from a process that knows it is served over HTTPS, and this one
  cannot know. `COOKIE_SECURE` exists for the same reason.
* **CSP** — theatre on a JSON API that serves no HTML of its own.
* `X-XSS-Protection` — removed from modern browsers; sending it is cargo cult.

Applied to error responses too, which is where they are easiest to forget.

## 4. Request ids

`tower-http`'s `request-id` feature was **enabled in `Cargo.toml` and never used**. The
process had no way to tie a user's 500 to a log line.

Now every response carries `x-request-id`, and it is exposed through CORS so a cross-origin
caller can actually read it.

**The subtle part.** `SetRequestIdLayer` deliberately *keeps* an id already present on the
request — the right default for a proxy forwarding an upstream id, and the wrong one here.
Left alone, a caller could pin `x-request-id: 0000…0001` on every request and make the
correlation worthless exactly when an incident needs it. A `strip_incoming_request_id` layer
sits outside it and removes the caller's value first.

This also exposed how easy the layer order is to get wrong: each `.layer()` wraps what came
before it, so the **last** call is the outermost. The stripping layer was initially placed
inside, silently did nothing, and was only caught because the test asserted the forged id
loses. The order is now documented on `middleware::apply` and pinned by a test.

## 5. Body limits

The old server: `express.json({ limit: "256kb" })`. The Rust backend: Axum's default, 2 MiB
for the whole body. So it silently accepted **eight times more** than the contract the
frontend was built against, with no deliberate decision anywhere.

`BODY_LIMIT_BYTES` now defaults to the old 256 KB and is clamped to `[1 KiB, 8 MiB]`, so a
hand-edited variable can neither disable the limit nor make it meaningless.

## 6. Shutdown

`shutdown_signal` used `.expect()` when installing the Ctrl+C and SIGTERM handlers. This
runs *after* the listener is open, so a failure would turn a degraded signal handler into a
dead process — and on a SIGTERM-less container, kill the app on a signal it merely could not
observe. Now logged, with the future resolving so `axum::serve` starts draining. Better a
fast shutdown than an unstoppable process.

`getrandom`'s `.expect()` in `cookies.rs` is **left as-is**: it is deliberate and documented
(R3), and failing to load OS entropy must fail the call rather than fall back to a
predictable session token.

## What was investigated and deliberately not changed

* **Rate limiting.** Out of scope for every phase so far, and needs a decision about what to
  do when the limit is hit (reject vs. shed) that is a product question, not a hardening one.
* **Session rotation on privilege change.** Sessions already expire, are revocable
  server-side, and store only a SHA-256 of the token. Nothing R9 added changes that.
* **`GET /metrics` has no path labels.** Deliberate: a per-path label would let an
  unauthenticated caller inflate a time-series database with arbitrary URL segments, which
  is a denial-of-service in everything but name.
* **No metrics backend.** Three atomic counters and the pool's own size answer the actual
  operational question — are requests succeeding, is anything stuck on the database — and
  cost nothing to keep.
* **Database pool and WAL.** R1's configuration (WAL, 5-second busy timeout, enforced foreign
  keys) is unchanged and was already correct for a single-writer SQLite deployment. No new
  locking was introduced; the pool is not the bottleneck.
* **Migration/startup failure.** `AppState::new` runs `sqlx::migrate!` and propagates, and
  `main` exits non-zero without opening a listener. Correct as built.

## Tests

`tests/hardening.rs`, 22 adversarial cases written as an attacker or a failing operator would
approach them:

* **Authorization survived the new layering** — anonymous is 401 and the wrong role is 403 on
  six surfaces, and the correct role gets *past* the guard. R9 inserted five layers between
  the socket and every extractor; this is what proves nothing shifted.
* **CORS** — unlisted origin refused, allowlisted origin granted with credentials and
  `Vary`, preflight fails closed, empty allowlist denies everything, and four hostile origin
  shapes including `null` and a suffix-confusion attempt cannot widen it.
* **Request ids** — present on success and error responses, unique per request, and a
  caller-supplied id is discarded.
* **Body limits** — 400 KB refused with a non-5xx status, a normal body still accepted.
* **Health/readiness** — liveness stays 200 with the database closed; readiness goes 503.
* **Leak checks** — six attack shapes against two differently-configured apps (one carrying
  secrets), plus both integration status endpoints, checked against a list of 13 forbidden
  substrings including `sqlite`, the configured AI key, the portal password, the internal
  hostnames and `app_session=`.
* **Configuration** — seven invalid configurations refused at boot, and values that would
  silently disable a protection are clamped.
* **Database failure** — pool closed underneath reads and writes; neither leaks nor panics.

### Two findings from the tests themselves

* `PORT=0` was asserted to be invalid. It is a valid ephemeral port; the case was wrong, not
  the code.
* The metrics counters are process-global, so parallel tests in the same binary share them.
  Every assertion is therefore a delta or a monotonicity check rather than an absolute value.

## Configuration added

| Variable | Default | Meaning |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | empty (deny all) | comma-separated browser origins |
| `BODY_LIMIT_BYTES` | `262144` | clamped to `[1024, 8388608]` |

No existing variable changed behaviour, and no API contract changed: `/health` keeps its
`{"status": "ok"}` shape, and `/ready` and `/metrics` are new routes.

Not starting R10.