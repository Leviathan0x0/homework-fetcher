# SvelteKit migration (R13)

The frontend in `web/` replaces the React/Vite app in `src/`. It talks only to the Rust
backend in `mmss-backend/`, which has been the source of truth since R10.

**The old frontend is still there.** Nothing in `src/`, `server/` or `api/` was deleted or
edited in this phase. Deleting it is a separate, deliberate step once the new app has been
run in anger.

---

## What was built

| Route | For | What it does |
| --- | --- | --- |
| `/login` | everyone | Sign in. Full-bleed, no app chrome. |
| `/password/setup` | new accounts | R12 first-password setup with a setup token. |
| `/homework` | everyone | The class feed: search, subject filter, mark done, notes. |
| `/notes` | everyone | Free-standing notes, newest first, deletable. |
| `/teacher` | teachers | Homework CRUD over the classes you have posted to. |
| `/admin` | administrators | Deployment summary, and where lifecycle commands live. |
| `/settings` | everyone | Display name, password change, sign out. |
| `/api/[...path]` | — | Same-origin proxy to the backend (see below). |

`/` redirects to the landing page for the account's role. It reads the role from
`GET /auth/me` and nothing else.

---

## Three decisions worth explaining

### 1. One API client, one URL, no base-URL branch

`web/src/lib/api/client.ts` is the only place that knows how to talk to the API. It always
builds a **relative** URL (`/api/...`) — in the browser and on the server alike.

Two mechanisms make that work, and neither is a caller's problem:

- **In the browser**, `src/routes/api/[...path]/+server.ts` proxies to the backend.
- **On the server**, `handleFetch` in `src/hooks.server.ts` rewrites the same path to the
  backend directly, avoiding a pointless round trip through the proxy.

The obvious alternative — computing an absolute URL at each call site — needs two code
paths, and two code paths drift. The old app's duplicated session handling is what drift
looks like. This way there is one string in one file.

The reason it matters at all is the cookie. A cross-origin API call makes the session a
third-party cookie: `SameSite=None; Secure`, a preflight on every write, and browser
behaviour that varies. Same-origin means none of that, in development or production.

`BACKEND_URL` is read at **runtime** via `$env/dynamic/private`, not from `import.meta.env`,
which is baked in at build time — a `BACKEND_URL` set after the build would otherwise be
silently ignored and only fail once deployed.

### 2. Authorization stays on the backend

The frontend computes role *links* and *landing pages*. It does not compute role
*permissions*.

A student who types `/teacher` gets a redirect to their own feed, and a student who posts
to `?/create` gets `"You are not assigned to that class."` — both of which are the
backend's answer, relayed. The teacher form does not grey out classes client-side; it sends
what was asked for and shows what came back.

A client-side role check would be a second source of truth, and the one that drifts — which
is exactly how the old `AppShell` ended up with three notions of "who is this person".

### 3. Mutations are real forms

Ticking "done", saving a note, changing a password and posting homework are all `<form>`
elements with `use:enhance`, not `fetch` calls in an effect.

They therefore work with JavaScript disabled. That is not paranoia: school wifi drops, and
a student on mobile data should still be able to tick something off on the bus.

---

## Intentional UX differences from the old app

The old frontend had a lot of screens. Most of them had no endpoint behind them.

**Kept as-is (it was already good):**

- The neutral oklch palette, `--radius: 0.625rem`, light/dark via `.dark`. Ported verbatim
  from `src/index.css` into `web/src/routes/layout.css`. The calm, near-monochrome scale is
  the visual identity.
- The login screen: full-bleed school artwork, warm serif heading, quiet form. This was the
  strongest thing in the old app.
- Cached-first-paint with background revalidation, for the theme choice specifically — now
  done by a blocking inline script in `app.html`, because a component cannot run early
  enough and the old app flashed white on every navigation for anyone using dark mode.
- Both halves of an entry shown when homework *and* classwork are present.

**Deliberately dropped:**

| Old | Why |
| --- | --- |
| Calendar view, Exams, Leave, Messages, All-homework, Completed, Recent, Attachments, School portal, Holidays, Developers, Admin panel | No endpoint. R4 stopped scraping the portal, so these had no data source left. |
| `ForgotPasswordDialog` | **There is no forgotten-password flow, and that is deliberate.** It needs a school-controlled identity factor that does not exist. `ACCOUNT_LIFECYCLE.md` documents the prerequisite. A reset endpoint built now with verification filled in later is how unauthenticated takeover endpoints ship. |
| PWA install prompt, service worker, Sentry, offline banner, notification popover | R4 removed the scraping these existed for. |
| Sentry | The Rust backend has structured logs. A second error reporter would be one more place to look. |
| Upload / file preview / docx rendering | R2 stores attachment **metadata only**. There is no upload endpoint and no storage behind one. |
| Calendar-style date filtering | Replaced by in-memory subject pills and search over the loaded feed. `from`/`to` are still supported on the server side. |

**Changed on purpose:**

- **Search runs in memory.** The old app re-requested the whole feed on every keystroke —
  a request per character, which is why it felt laggy. For tens of entries, filtering
  locally is instant.
- **Search covers both halves.** The old search matched `homework` only, so the classwork
  half of an entry was invisible to it.
- **Note editing is not clobbered.** The old `useHomework` reset the note draft whenever the
  feed refetched, losing half-typed text. The draft is now seeded when the editor opens.
- **Settings is one page with three sections**, not a sidebar plus a modal plus a page.
- **Completion count is shown.** Students had no sense of progress at a glance.
- **A "Clear filters" affordance** exists, because "nothing matches" with no way out is a
  dead end.
- **Deleting homework asks first.** The old list deleted on a single click.

---

## What the API cannot do, and what that means for the UI

These are limits of R1–R12, not gaps in this phase. They are stated on the relevant screen
rather than hidden.

- **No "my classes" endpoint.** A teacher's create form offers only classes they have
  already posted to. R5 made class assignment a roster operation, so a brand-new teacher
  sees no options until they have an entry. The teacher page says so.
- **No admin listing endpoints.** No users, no classes, no roster. The admin page shows a
  deployment summary and points at the `mmss-backend accounts ...` commands, which is where
  enrolment, deactivation and first-password codes actually live — deliberately, since they
  are recorded in an audit trail and cannot be triggered by whoever reaches a URL.
- **No attachment bytes.** Attachments render as metadata: filename, type, size. No
  download link, because it would 404.
- **`schoolSessionExpired` and `isStale` are always false.** Kept for shape; R4 removed the
  scraping that could set them.

---

## Security notes

- **Passwords are never returned, stored or logged client-side.** They appear in exactly
  one place: the request body of a `POST`/`PATCH`. There is a test asserting a password
  never appears in a URL or a header.
- **A password change requires the current password**, so a stolen session alone cannot
  take an account over. The backend revokes every session on success and issues a
  replacement; the settings action takes that replacement cookie and re-sets it, so the
  student is not signed out by their own successful change.
- **No user id, `schoolId` or role is ever sent in a password body.** The target is always
  the session.
- **`Set-Cookie` is read, not re-issued with our own attributes.** Copying the value into a
  `cookies.set` call risks disagreeing with the server about `HttpOnly`, `SameSite` or
  `Max-Age`, and a cookie that disagrees with the server is a cookie that misbehaves.
- **Open redirect is blocked.** `?next=` is honoured only for a path beginning with `/` and
  not `//`.
- **CSRF**: SvelteKit refuses form `POST`s whose `Origin` does not match. Left on.
- **A wrong current password is reported as one**, not relayed verbatim. The backend answers
  every credential failure with one identical message on purpose — the text it uses for a
  setup token — so relaying it put *"That setup link is not valid or has expired"* in front
  of someone changing their password. The backend's opacity is correct; the frontend knows
  which screen it is on and picks a sentence that fits it.
- **The proxy forwards a short header list only**: `accept`, `content-type`, `cookie` in;
  `content-type`, `set-cookie`, `cache-control` out. No `Origin`, `Host` or `Authorization`,
  so it cannot be used to smuggle one origin's credentials to another. `Domain` is stripped
  from any `Set-Cookie` it relays, since the response is served on this origin.

---

## Testing

```sh
npm test          # 62 unit tests
npm run check     # svelte-check, 0 errors 0 warnings
npm run build     # adapter-node production build
```

Covered:

- **`feed.test.ts` (27)** — the mapper against **verbatim** backend responses. Classwork-only
  entries, the `homework: string | null` distinction, dedupe keys, search, filters, and the
  local-vs-UTC date parsing the old app got wrong.
- **`client.test.ts` (24)** — URL construction, cookie forwarding, `Set-Cookie` reading,
  and the error envelope. Includes the two cases that silently lie: a 502 with an HTML body,
  and a **200** with an HTML body.
- **`session.test.ts` (11)** — role landing pages, the admin-is-also-a-teacher trap, and
  `next=` preservation.
- **`contract.test.ts`** — 12 tests against the **running backend**, skipped unless
  `MmsS_BACKEND` is set. These pin the shapes the type system cannot: `homework` really is
  `null` and not `""`, `updatedAt` really is ISO-8601 in the feed and epoch-ms everywhere
  else, `/auth/me` really is 200 for an anonymous caller, and every protected route really
  is 401 without a session.

```sh
cd mmss-backend && DATABASE_URL=sqlite://$PWD/data/mmss.db ADMIN_PASSWORD=... PORT=3997 cargo run &
cd web && MmsS_BACKEND=http://127.0.0.1:3997 \
  MmsS_STUDENT_ID=2026001 MmsS_STUDENT_PASSWORD=student-pw-1234 npm test
```

---

## Running it

```sh
# backend
cd mmss-backend
DATABASE_URL=sqlite://$PWD/data/mmss.db ADMIN_PASSWORD=... PORT=3997 cargo run

# frontend
cd web
BACKEND_URL=http://127.0.0.1:3997 npm run dev
```

Production:

```sh
cd web && npm run build && BACKEND_URL=http://127.0.0.1:3997 ORIGIN=https://the-host node build
```

`BACKEND_URL` and `ORIGIN` are both runtime env vars. `ORIGIN` is required by adapter-node
for form actions.

---

## Verified against the running backend

Exercised over HTTP against `mmss-backend` on `:3997`:

- sign in → session cookie → feed renders the teacher's entry → `/auth/me` through the
  proxy
- wrong password → the backend's identical message, not a hint about which half was wrong
- deep link while signed out → `?next=` preserved through sign-in
- signed out on all six protected pages → all redirect to `/login`
- signed in as a student → `/teacher` and `/admin` both redirect away
- student posting to `?/create` → 409 with the backend's *"You are not assigned to that
  class."*; the same request straight at the backend gives 403 `FORBIDDEN`
- teacher create → appears in the student's feed
- mark done → count updates → per-entry note renders on the card
- display name update → reflected in `/auth/me`
- R12 setup: CLI issues a token → setup screen prefills it → password set → student is
  signed in and sees the feed; the same token is then refused as already used
- password rotation: mismatched confirmation refused, wrong current password refused, real
  rotation revokes the previous session while this browser keeps a replacement cookie
- `/nope` → 404

**Not verified:** browser automation and screenshots. The desktop browser was not connected
to this session, so responsive layout, theme switching and animation were reasoned about in
the markup rather than observed running. Worth doing before this replaces anything.

---

## Deliberately not done

- No R14.
- No AI, no EduSecure transport, no caching/Redis/Postgres.
- No Rust API change. No contract blocker was found; the `homework`/`classwork` null
  distinction and the admin-is-also-a-teacher flag are both things the frontend now handles
  correctly rather than something the backend should change.
- **No deletion of `src/`.** The old app is intact.
