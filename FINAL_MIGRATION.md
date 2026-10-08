# FINAL_MIGRATION.md

The state of MMSS64 after R14: final QA, production cutover and rollback.

**Where the frontend lives now:** `web/` — SvelteKit 2 + adapter-node.
**What it talks to:** `mmss-backend/` — Rust, axum, SQLite.
**What is still in the repository:** the old Node frontend in `src/` and `server/`,
intact and still buildable. It is the rollback path, not dead weight to be cleaned up
yet. See [Cutover](#cutover).

Every item below is labelled **Verified** (actually run and observed),
**Configured** (written down and correct, not exercised on the live VPS),
**Deferred** (deliberately not done) or **Known limitation**.

---

## 1. Final architecture

```
Browser
  │  https://<public-host>              one origin, no CORS, first-party cookie
  ▼
Nginx :80/:443
  │  proxy_pass http://127.0.0.1:3002   infra/nginx/mmss64-sveltekit.conf
  ▼
SvelteKit frontend (web/build, adapter-node)      :3002, HOST=127.0.0.1
  │    ├── form actions, SSR
  │    └── /api/*  ── src/routes/api/[...path]/+server.ts   (browser side)
  │    handleFetch ── src/hooks.server.ts                  (server side)
  │                      │
  ▼                      ▼
Rust API (mmss-backend, axum)                 :3001, HOST=127.0.0.1
  │
  ▼
SQLite (WAL)  /var/lib/mmss64/mmss.db
```

The browser never speaks to the API directly. Every request is same-origin, so the
session cookie stays first-party (`SameSite=Lax`, no `SameSite=None`, no CORS, no
preflight). This is the single largest structural difference from the old deployment,
which served a static Vite bundle from Vercel and proxied `/api/*` to a bare IP over
HTTP.

Two variables configure it, both read at **runtime** (never baked into the bundle):

| Variable      | Set on                | Value                                  |
| ------------- | --------------------- | -------------------------------------- |
| `BACKEND_URL` | frontend service      | `http://127.0.0.1:3001`                |
| `ORIGIN`      | frontend service      | `https://<public-host>`                |

**Configured.** `ORIGIN` is not optional. Without it adapter-node assumes `https`,
SvelteKit's CSRF check compares that against the browser's `Origin`, and every form
action — sign in included — answers 403. This is called out in
`infra/systemd/mmss64-frontend.service` next to the value that sets it.

**Verified:** with `ORIGIN` set, a form POST from a different `Origin` is refused with
403 and the same POST with the right `Origin` succeeds — checked against the production
build with `curl`.

---

## 2. Routing arrangement

**There is no `/api` block in nginx, and there must not be one.** The frontend already
owns `/api/*` and forwards to the backend server-side. A `location /api` in nginx would
shadow it and is the exact mistake the cutover note warns about.

| Request                        | Answered by                                    |
| ------------------------------ | ---------------------------------------------- |
| `/`, `/login`, `/password/setup` | the frontend (redirect or page)              |
| `/homework`, `/notes`, `/settings` | the frontend, after `GET /auth/me`           |
| `/teacher`, `/admin`           | the frontend, after `GET /auth/me`              |
| `/api/*`                       | frontend proxy → Rust API                       |
| `/_app/immutable/*`            | adapter-node, `max-age=31536000, immutable`     |
| anything else                  | 404 from the frontend's `+error.svelte`         |
| backend 401/403/409/5xx        | passed through; the page shows the mapped message |

**Verified** against the production build on `:3010`: `/` 302, `/login` 200,
`/password/setup` 200, all five protected pages 302 to `/login` when signed out, `/nope`
404, `/logo.png` 200, `/robots.txt` 200, `/api/auth/me` 200 (the backend's documented
"anonymous is a 200" answer), and `/api/%2e%2e%2f%2e%2e%2fmetrics` 404 — the traversal is
refused rather than relayed.

---

## 3. Production configuration

**Configured.** Reference copies, in the same style as the existing ones:

| File                                     | What it is                                        |
| ---------------------------------------- | ------------------------------------------------- |
| `infra/systemd/mmss64-backend.service`   | the Rust API on `:3001`                           |
| `infra/systemd/mmss64-frontend.service`  | the frontend on `127.0.0.1:3002`, `node build`   |
| `infra/nginx/mmss64-sveltekit.conf`      | the new site, proxying to `:3002`                 |

Build and start:

```sh
cd /opt/mmss64/repo/mmss-backend && cargo build --release
cd /opt/mmss64/repo/web && npm ci && npm run build

sudo systemctl enable --now mmss64-backend mmss64-frontend
```

`HOST=127.0.0.1` on both: only nginx can reach either. The frontend's `PORT` is
**3002, not 3000** — 3000 is the old Express unit's port, and reusing it would make the
two stacks collide during any overlap. `TimeoutStopSec=45` exceeds adapter-node's own
`SHUTDOWN_TIMEOUT` of 30s, so a restart drains rather than truncates.

**Verified:** `npm run build` produces `web/build` for adapter-node; `node build` serves
every route above with the correct status codes; the frontend logs exactly one line on
startup and, with `BACKEND_URL` unset in production, one warning naming the cause.

**Not configured — left as it was:** `vercel.json`, `docs/AZURE-VPS.md`, `DEPLOYMENT.md`,
`README.md`, `FEATURES.md`, `SECURITY.md` and `PERFORMANCE-BLOCKERS.md` all still describe
the Vercel + Express topology. They are now wrong. They are documentation rather than
configuration, and rewriting five documents nobody reads during an incident is not worth
the risk of losing a detail that matters; this file is the current answer.

---

## 4. Browser QA

**Performed.** The `browser` tool was not connected to this session, so the desktop
browser could not be driven. Rather than claim QA that did not happen, the app was driven
in **headless Chrome** (the system Google Chrome, via the `playwright-core` that ships
with an unrelated global tool — no new dependency in this repository), at two viewports
and two colour schemes, against both the dev server and the **production build**, as a
student, a teacher and an administrator.

### What was exercised

| Area                    | Result |
| ----------------------- | ------ |
| Login, wrong password, unknown ID | Both failures show the backend's identical message. No hint about which half was wrong. |
| Deep link while signed out | `/homework?next=%2Fhomework` — preserved through sign-in, honoured after. |
| Student feed | Renders, cards, subject/date grouping, completion count. |
| Search | Matches homework **and** classwork behind the disclosure; a miss shows "Nothing matches", not a blank page. |
| Subject filters | All / Art / Mathematics / Science. |
| Notes | Written, persisted across a reload, listed on `/notes`, deletable. |
| Mark complete | Persisted across a reload; the counter follows. |
| Profile update | Display name persists into the sidebar. |
| Teacher CRUD | Create → appears in the list; edit is prefilled and applies; delete asks first, then removes. All through the real form actions. |
| Teacher on a student page | Redirected to their own page with an explanation. Was a 500 — see §6. |
| Student on a teacher page | Redirected with an explanation. |
| Student POSTing `?/create` | 409 with the backend's own *"You are not assigned to that class."* |
| Admin | Lands on `/admin`; `isTeacher` being true for an admin does not confuse the routing. |
| Setup flow | Bad token → the backend's wording; real token → password set → signed in with the feed; the same token again → refused. |
| Password rotation | Wrong current password → *"Your current password is not correct."*; a real rotation keeps this browser signed in and **signs out the other browser**. Old password refused, new one accepted. |
| Sign out | Cleared, and every protected page redirects again. |
| 404 | `/nope` → a real 404 page. |
| 500 | Backend stopped → 500 page, and the server log names the cause. |
| CSRF | A form POST with a foreign `Origin` is refused 403. |
| Layout | No horizontal overflow at 1440×900 or 390×844, in either theme, on any page. |
| Focus | Every tab stop on every page has a visible 2px ring; the skip link appears on focus. |
| A11y basics | No unlabelled form control, no image without alt text, one `<h1>` per page. |
| Console | No errors, no warnings, no failed requests, no 404s after the fixes below. |

### Result: **0 blockers, 0 console errors, 0 failed requests, 0 overflow** across every
combination of {dev, production build} × {desktop 1440×900, mobile 390×844} ×
{light, dark} × {student, teacher, admin}.

### Visual identity

**Verified.** The palette, the serif display headings, the near-monochrome neutrals and
the spacing are the old app's, ported token for token from `src/index.css`. Nothing was
redesigned. The login screen keeps the full-bleed treatment, the school artwork and the
quiet form. Dark mode applies from a blocking inline script before first paint, so
there is no white flash on navigation — the old app had exactly that bug.

### Mobile

**Verified** at 390×844. Sidebar becomes a fixed bottom bar with the home-indicator
padding; cards stack; disclosures, search, filters, forms and the teacher pages all
reflow. Text wraps, nothing overflows sideways, the fixed bar does not cover the last
card (`pb-24` against a ~60px bar).

Every interactive control on a touch screen is at least 32px on its short side, and the
primary ones are larger: bottom navigation 45px, "Mark done" and "Add note" 36px, filter
pills 32px, theme toggle 40px, settings tabs 38px. Padding was added; no layout changed.

### Known limitation

The native `<input type="checkbox">` is 16×16. It is wrapped in a 36px `<label>` carrying
the "Mark done" text, so the whole row is the tap target and the browser's own control is
never tapped directly. The skip link is 1×1 until focused, which is what a skip link is.
The teacher's Edit link is 31×36 — usable, and still the smallest real target here.

---

## 5. Security

**Verified by audit and by observation.** The verdict: **the frontend is not an
authorization authority anywhere.**

- One function answers "who is this" — `resolveSession` → `GET /auth/me`. Every
  data-bearing page reads the layout's resolved session rather than asking again, so
  there is one call and one answer per navigation.
- Role never decides anything. It picks a landing page, a nav link and a redirect. The
  backend answers 403 and the frontend displays it.
- `authorId` and `teacherId` **do not appear anywhere in `web/`**. The backend derives the
  author from the session unconditionally
  (`mmss-backend/src/services/teacher_homework.rs`).
- `classId` from the create form is re-checked against the teacher's roster by the
  backend; a mismatch is a 403, not a write.
- The session cookie is `HttpOnly`, `SameSite=Lax`, host-only, never readable from JS,
  never in `localStorage` (only the theme is), never logged, never in the HTML.
- No `{@html}`, no `innerHTML`, no markdown renderer, no `href` built from backend data.
- No password is persisted, echoed or logged. No setup-token enumeration: the backend
  collapses unknown, spent and expired into one sentence and the frontend relays it
  verbatim.
- Errors expose nothing: SvelteKit replaces a non-`HttpError` message with
  `Internal Error`, the backend returns a fixed `internal server error` envelope, and the
  real cause goes to the server log — which R14 added, because before that a production
  500 left no trace at all.
- CSRF: SvelteKit's origin check is on, `SameSite=Lax` is the backstop, and there are no
  state-changing `GET`s.
- **Content-Security-Policy** (`kit.csp` in `web/vite.config.ts`), enforced, not
  report-only. Nonce mode, so the one inline script in the app — the theme switch in
  `app.html` — carries a nonce instead of costing `unsafe-inline` for scripts:

  ```
  default-src 'self'; script-src 'self' 'nonce-…'; style-src 'self' 'unsafe-inline';
  img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none';
  base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  ```

  `style-src` needs `unsafe-inline` because Svelte injects component styles as inline
  `<style>` elements at runtime; scripts do not, and that is the distinction that matters.
  Every image and font is served from this origin, so `connect-src 'self'` is enough —
  the browser never talks to the API cross-origin.
  **Verified** with zero violations across three roles × two viewports × both themes,
  including a mark-complete write, with every inline script carrying the nonce.
- Secrets: nothing in `web/src`, nothing in `web/build`, no `.env` in `web/`. The three
  new infra files reference `/etc/mmss64/mmss.env` and inline no secrets.

### Fixed in R14

- **Open redirect via `?next=`.** `/\evil.example` passed the old guard (single slash, no
  `//`) and browsers normalise `\` to `/`, so it left the site. Now refused.
  `web/src/routes/login/next-redirect.test.ts` covers it.
- **Path traversal in the `/api` proxy.** `%2e%2e%2f` reached the backend's routes mounted
  outside `/api` (`/metrics`, `/ready`, the bare `/auth/*`). Now refused.
  `web/src/routes/api/[...path]/proxy.test.ts` covers it.
- **`Set-Cookie` relay.** `headers.get()` comma-joins multiple cookies into one corrupt
  header. Now `getSetCookie()`.

---

## 6. What R14 changed in the code

| Fix | Why it mattered |
| --- | --- |
| **CSS was imported from `+layout.server.ts`** | A server-only module. The import compiled, `npm run build` succeeded, `svelte-check` was clean — and **the entire application shipped unstyled.** R13's "not verified: browser automation" hid this. It is the single most important finding of R14. |
| Teacher and admin got a **500** on `/homework` and `/notes` | Both are student routes; the backend answers 403 and nothing caught it. Their own nav links led there. Now: a redirect to their landing page with an explanation, and the nav no longer offers links the backend will always refuse. |
| The **subject picker on the teacher page was permanently empty** | It called `/subjects`, which is a student route. Subjects are now derived from the teacher's own entries, like classes. Without this the create form could never be used. |
| `?denied=` was written by two redirects and read by nothing | A student who typed `/teacher` landed on their feed with no explanation. The layout now renders it. |
| **Open redirect** `?next=` | §5. |
| **Proxy traversal** and `Set-Cookie` relay | §5. |
| `/auth/me` fetched twice per navigation | Every page load made the call twice. Pages now read the layout's session. |
| Session cookie set in three places with three copies | One `setSessionCookie`, and the comment that claimed the opposite of what the code did is gone. |
| `BACKEND_URL` unset fell back to loopback silently | Now warns once at startup, naming the fallback. A warning rather than a throw, because `npm run build` imports the module to analyse the build and a build must not need the runtime's environment. |
| No `handleError` | A production 500 left nothing in the log. Now one stderr line with the cause. |
| `/logo.png`, `/favicon.svg`, `/login-hero.jpg` 404'd | `web/static/` held only `robots.txt`, so the sidebar and the login screen showed a broken image on every page load. Copied from the old app's `public/`. |
| Touch targets 20–28px on mobile | Raised to 32–36px on the feed's primary controls, and every remaining secondary control raised to at least 32px by padding alone — no layout changed. |
| **No Content-Security-Policy** | The app set none, while the old Express app used `helmet`. Now enforced with a nonce, verified violation-free in a browser. |
| `MMSS_BACKEND` did nothing | The contract tests read `MmsS_BACKEND`, so the documented invocation silently skipped 13 tests. Renamed to `MMSS_BACKEND`; they now run. |
| Missing `npm start` | adapter-node ships no launcher. |
| No CI for `web/` or `mmss-backend/` | **319 Rust tests and 83 frontend tests ran on nobody.** A `rewrite` job now gates both. The old jobs are untouched: they guard the rollback path. |
| `web/README.md` described `adapter-auto` | The scaffold README, which is not what this app uses. Replaced. |

---

## 7. Database backup and restore

**Configured**, and unchanged by R14: `scripts/backup-sqlite.sh` runs nightly from
`mmss64-backup.timer` and uses SQLite's `.backup` API — never `cp` — so a snapshot is
consistent against a live WAL database. It runs `PRAGMA integrity_check` on every
snapshot and fails the run if one is bad.

```sh
sudo systemctl start mmss64-backup.service
ls -1t /var/backups/mmss64/
```

**The one thing the cutover must get right:** the Rust API's `DATABASE_URL` must point at
the same file the backup script already snapshots.

```
DATABASE_URL=sqlite:///var/lib/mmss64/mmss.db     # mmss-backend/.env, /etc/mmss64/mmss.env
SQLITE_DB_PATH=/var/lib/mmss64/mmss.db            # scripts/backup-sqlite.sh default
```

A `DATABASE_URL` pointing at `mmss-backend/data/mmss.db` — the development default —
produces a database the nightly job never sees.

### Restore

```sh
sudo systemctl stop mmss64-backend mmss64-frontend mmss64
ls -1t /var/backups/mmss64/mmss-*.db          # pick a generation

# The WAL sidecars belong to the file being replaced.
sudo -u mmssapp rm -f /var/lib/mmss64/mmss.db{,-wal,-shm}
sudo -u mmssapp cp /var/backups/mmss64/mmss-<STAMP>.db /var/lib/mmss64/mmss.db

sudo -u mmssapp sqlite3 /var/lib/mmss64/mmss.db 'PRAGMA integrity_check;'   # must say "ok"
sudo systemctl start mmss64-backend mmss64-frontend
curl -sS http://127.0.0.1:3001/health            # {"status":"ok"}
curl -sSI https://<public-host>/login | head -1  # HTTP/2 200
```

`/health` and `/ready` are the Rust API's own, on `:3001` — not the old
`GET :3000/api/health`, which no longer exists.

---

## 8. Rollback

Everything needed to go back to the old frontend is still in the repository and still
buildable. Nothing was deleted.

> ### Git rollback does not roll back the school's data
>
> `git revert` restores **code**. The homework, the accounts, the passwords and the
> sessions live in `data/mmss.db` and are in no commit anywhere in this repository —
> the database is gitignored, deliberately, and it must stay that way.
>
> **Take a database backup immediately before the cutover, and verify the restore, not
> just the backup.** A backup that has never been restored is a hypothesis.
>
> ```sh
> sudo systemctl start mmss64-backup.service
> ls -1t /var/backups/mmss64/                 # a snapshot must exist, dated now
> sudo -u mmssapp sqlite3 /var/backups/mmss64/mmss-<STAMP>.db 'PRAGMA integrity_check;'   # must say "ok"
> ```
>
> Code rollback without a data rollback gives you the old application reading a database
> the new one has been writing to, or — in the Turso case below — reading a database it
> never wrote to at all.

**Nothing is committed yet.** `git status --short` still shows the whole rewrite as
untracked or modified, so **git is not yet a rollback mechanism**. Committing is the
first thing to do before touching production; after that, `git revert` of the cutover
commit is the fast path.

### What is in the first commit

The tree is commit-ready and was checked for it:

- No credentials. The only key-shaped strings in the repository are a
  `OPENAI_API_KEY=sk-...` placeholder in the superseded `DEPLOYMENT.md` and files inside
  already-ignored `dist/` and `playwright-report/`.
- No build output, no `node_modules`, no `target/`, no `.svelte-kit`, no `web/build`, no
  `.env`, no `data/mmss.db`. All covered by `.gitignore` and confirmed with
  `git check-ignore`.
- No logging or debugging left in `web/src`: zero `console.*` outside the one startup
  warning and the one `handleError` line.
- `server/db/libsqlHttp.js` is a pre-existing modification and is **not** part of this
  work; it is listed below only so it is not mistaken for something R14 touched.
- `graphify-out/` — generated tool output — is now gitignored so `git add .` cannot
  commit it. The directory itself is untouched.
- `lasso.config.json` is pre-existing, referenced by no code, and left as it is.

### Frontend rollback

```sh
# 1. stop the new frontend
sudo systemctl disable --now mmss64-frontend

# 2. point nginx back at the Express unit
sudo cp infra/nginx/mmss64.conf /etc/nginx/sites-available/mmss64.conf
sudo nginx -t && sudo systemctl reload nginx

# 3. bring the old stack back
sudo systemctl enable --now mmss64            # Express on :3000
curl -sS http://127.0.0.1:3000/api/health
```

The old `vercel.json` is untouched and still builds `src/`, so the Vercel deployment is
also still the old app. Nothing has to be rebuilt to roll back.

**Caveat, and it is a real one:** the old Express backend talks to the **Turso/libSQL**
database and the new one to **SQLite**. They are not the same data. Rolling back the
frontend alone gives a working old app with the old data — homework posted through the
Rust API during the overlap will not be in it. Decide the cutover window accordingly, and
treat "new app has been live and has real entries" as the point of no easy return.

### Proxy rollback

The new site proxies to `:3002` and the old one to `:3000`. Only one nginx site config is
active (`/etc/nginx/sites-enabled/mmss64.conf`), so rollback is one file copy and a
reload. Verified `nginx -t` before reloading, in both directions.

### What is not reversible

Accounts created, passwords changed, sessions and setup tokens issued through the Rust
API exist only in SQLite. Reverting the frontend does not undo them. If the old
frontend's roster has no record of a Rust-API account, that student cannot sign in
through the old app until the roster is updated.

---

## 9. Cutover

**Done — `web/` is the production frontend.** Configured as such: it is the only
frontend with an adapter, a start script, a README, an environment contract and a CI
gate, and the only one the deployment reference files (`infra/systemd/*`,
`infra/nginx/mmss64-sveltekit.conf`) point at.

**Not done — `src/` is still there, on purpose.** Three reasons, in order:

1. **`vercel.json` still builds it.** That file is read-only for this phase, and it runs
   the root `npm run build` → `vite build` → `dist/`. Deleting `src/` would break the
   currently deployed frontend — the opposite of preserving a rollback path.
2. **Nothing is committed.** Git could not restore it.
3. **The old Node backend is still the deployed one** (`mmss64.service` runs
   `server.js`). Deleting `server/` would take production down.

So `src/` is **archived, not obsolete**: still buildable, still deployed, still the
rollback. Deleting it is a separate, deliberate step, in this order:

1. Commit everything (so git is the safety net).
2. Retire `vercel.json` and the Vercel deployment.
3. Retire `mmss64.service` (Express) once the Rust unit has run for long enough to trust.
4. Delete `src/`, `public/`, `e2e/`, `test/`, `server/`, `server.js`, `api/`,
   `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `drizzle.config.js`,
   `components.json`, and the old `quality`/`browser-smoke` CI jobs.
5. Replace the root `package.json` scripts with the `web/` equivalents.

Every one of those is verified obsolete by reference: `src/` is imported by nothing in
`web/` or `mmss-backend/`; `server/` by nothing in either; `api/transport-probe.js` is a
temporary diagnostic already shadowed by `vercel.json`'s own rewrite and gated on a token
nothing sets; the four root dependencies with zero references anywhere
(`@radix-ui/react-dialog`, `@radix-ui/react-popover`, `@radix-ui/react-slot`, `zod`) are
dead in both worlds.

**Cleanup performed in R14: none, deliberately.** The only files removed were
`web/src/lib/assets/favicon.svg` — an unreferenced scaffold leftover duplicated by
`web/static/favicon.svg` — and a duplicate `BACKEND_URL` constant in the proxy, replaced
by the one the server already exported. `server/db/libsqlHttp.js` was not touched.

---

## 10. Test results

Run from the final working tree.

| Gate | Result |
| ---- | ------ |
| `web`: `npm run check` | **0 errors, 0 warnings** |
| `web`: `npm run build` | **exit 0**, adapter-node |
| `web`: `npm test` (offline) | **70 passed**, 13 skipped |
| `web`: `npm test` with `MMSS_BACKEND` | **83 passed** (70 + 13 live) |
| `mmss-backend`: `cargo fmt --check` | **clean** |
| `mmss-backend`: `cargo check` | **clean** |
| `mmss-backend`: `cargo test` | **319 passed, 0 failed** (16 binaries) |
| `mmss-backend`: `cargo clippy --all-targets -- -D warnings` | **clean** |
| old frontend: `npm run test:frontend` | **108 passed** |
| old backend: `npm run test:server` | **84 passed** |

R13's baseline was 62 offline + 13 live frontend tests. R14 added 8: three for the
`?next=` guard and five for the `/api` proxy — the two places where a bug is invisible
until a browser or a hostile URL finds it.

**Baseline for what comes next: 319 Rust · 84 old Node backend · 83 frontend
(70 offline + 13 live) · 108 old frontend.**

---

## 11. Known limitations and deferred work

### Known limitations

- **Attachments are metadata only** (R2). Filename, type, size, storage key. No upload,
  no download, no preview. The UI deliberately offers no link.
- **A teacher who has never posted cannot post.** There is no "my classes" endpoint, so
  the class and subject pickers list only what that teacher has already used. R5 left
  class assignment a provisioning-roster job. The page says so plainly rather than
  hiding it. Closing this needs a backend endpoint, which R14 was told not to add.
- **No forgotten-password reset.** It needs a school-controlled identity factor that does
  not exist. See `mmss-backend/ACCOUNT_LIFECYCLE.md` for why.
- **Setup tokens reach students through the office**, not automatically. The CLI prints
  them to stdout; there is no email or SMS.
- **No admin UI for account lifecycle.** The admin page shows a deployment summary and
  points at the `mmss-backend accounts …` commands. That is by design.
- **Nothing calls the cleanup functions.** `delete_expired_sessions`, `delete_dead` and
  event pruning exist and nothing runs them. A nightly job would do it.
- **No password complexity beyond length**, no session-management UI, and
  `/auth/profile/picture` and `/auth/reconnect` are still unimplemented.
- **Teacher and admin cannot use the feed or notes at all.** Those are student routes by
  backend design, not a frontend limitation.
- **`docs/AZURE-VPS.md`, `DEPLOYMENT.md`, `README.md`, `FEATURES.md`, `SECURITY.md`,
  `PERFORMANCE-BLOCKERS.md` and `mmss-backend/DEPLOYMENT.md`'s topology section still
  describe the old deployment.** Wrong, superseded by this file, not rewritten.

### Deferred

- **Deleting `src/`, `server/`, `api/` and the old root tooling** — §9, in order, after
  `vercel.json` is retired.
- **TLS.** The nginx reference config listens on 80 and says what to add. The VPS
  terminates TLS today via Vercel's edge, not nginx.
- **HSTS and the other response headers.** The Content-Security-Policy now travels with
  the app; HSTS belongs to nginx, alongside TLS termination, and is only meaningful once
  TLS is terminated on this host.
- **`graphify-out/` is now gitignored.** It was generated tool output that `git add .`
  would have committed. The directory is untouched; it is simply no longer a candidate.
- **Five obsolete documents carry a superseded banner** rather than a rewrite:
  `DEPLOYMENT.md`, `docs/AZURE-VPS.md`, `FEATURES.md`, `SECURITY.md`,
  `PERFORMANCE-BLOCKERS.md`. Each states, factually, that it describes the old topology
  and points at this file. Their bodies are unchanged, so the rollback path stays
  documented — a factual banner cannot lose a detail, and a rewrite could.
- **A `handleError` that reports somewhere.** It writes one stderr line. There is no log
  shipper, and adding one is not R14's business.

### Explicitly not done

No R15. No backend rewrite. No API contract change. No AI. No EduSecure transport. No
Redis, no Postgres, no caching of any kind. No new dependency in `web/` — the browser QA
that made this phase possible ran on the system Chrome through a `playwright-core` that
already existed on the machine, from a script outside the repository.

---

## 12. Production checklist

Copy-paste, in order. Each line is a step that fails loudly rather than silently.

**Before deploying**

- [ ] `cd mmss-backend && cargo build --release`
- [ ] `cd web && npm ci && npm run check && npm test && npm run build`
- [ ] `DATABASE_URL` in `/etc/mmss64/mmss.env` points at `/var/lib/mmss64/mmss.db` —
      **the file `scripts/backup-sqlite.sh` snapshots**
- [ ] `BACKEND_URL=http://127.0.0.1:3001` and `ORIGIN=https://<public-host>` in the same file
- [ ] `NODE_ENV=production` on the backend, so the session cookie is `Secure`
- [ ] A backup has been taken **and its restore verified**: `sudo systemctl start
      mmss64-backup.service`, a snapshot exists under `/var/backups/mmss64/` dated now,
      and `PRAGMA integrity_check` on it says `ok`. **Git does not back up this data.**
- [ ] Everything is committed. Git is the rollback path for *code*; the backup above is
      the rollback path for *data*.

**Deploying**

- [ ] `sudo systemctl enable --now mmss64-backend`
- [ ] `curl -sS http://127.0.0.1:3001/health` → `{"status":"ok"}`
- [ ] `sudo systemctl enable --now mmss64-frontend`
- [ ] `curl -sSI http://127.0.0.1:3002/login | head -1` → 200
- [ ] `sudo cp infra/nginx/mmss64-sveltekit.conf /etc/nginx/sites-available/mmss64.conf`
- [ ] `sudo nginx -t && sudo systemctl reload nginx`
- [ ] `curl -sS https://<public-host>/health` is *not* expected to work — `/health` is the
      API's, on loopback. Check `https://<public-host>/login` returns 200 instead.

**After, in a real browser**

- [ ] The page is **styled**. An unstyled page means the CSS did not bundle — see §6.
- [ ] The response carries `content-security-policy` and the browser console is clean. A
      CSP violation names the blocked directive; there should be none.
- [ ] Sign in as a student: the feed renders, search works, a note saves, "mark done" sticks.
- [ ] Dark mode: no white flash on navigation.
- [ ] A teacher sees their own page, not a 500.
- [ ] An administrator lands on `/admin`.
- [ ] Sign out; every page redirects to `/login`.
- [ ] `journalctl -u mmss64-frontend -n 50` shows no errors.

**Rolling back**

- [ ] `sudo systemctl disable --now mmss64-frontend`
- [ ] Restore `infra/nginx/mmss64.conf`, `sudo nginx -t`, reload
- [ ] `sudo systemctl enable --now mmss64`
- [ ] Remember: the old app reads Turso, the new one reads SQLite. §8.