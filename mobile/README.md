# Homework — native mobile app

Expo (managed) + React Native + TypeScript client for the school homework and
messaging API in this repository.

> **Status: increment 2 of 3.**
> Done: scaffold, design system, typed API client, auth, **Homework (Today)**,
> **Messages list**, **Chat thread**, **New chat**, Settings.
> Next: Classwork, Requests, Notifications (the tab badge is already live).
> See [Roadmap](#roadmap).

---

## Setup

Requirements: Node 20+, and Expo Go or a dev build on a device/simulator.

```bash
cd mobile
npm install
npm start          # then press i / a, or scan the QR code
```

Run the API from the repository root in another terminal:

```bash
npm install
npm start          # Express on http://localhost:3000
```

### Pointing the app at an API

Base URL comes from `EXPO_PUBLIC_API_BASE_URL`.

```bash
cp .env.example .env.local
```

| Where the API runs | What to set |
| --- | --- |
| Same machine, iOS Simulator / Android emulator | Leave blank — in development the app derives `http://<metro-host-ip>:3000` automatically. |
| **Android device over USB** | Leave blank and run `adb reverse tcp:3000 tcp:3000`, which makes `localhost:3000` on the phone reach your machine. |
| Physical device over Wi-Fi | `EXPO_PUBLIC_API_BASE_URL=http://192.168.1.42:3000` — your machine's LAN IP. `localhost` resolves to the phone itself and always fails. |
| Deployed | `EXPO_PUBLIC_API_BASE_URL=https://homework.example.com` |

Restart Metro after editing an env file — `EXPO_PUBLIC_*` values are inlined at
build time, not read at runtime. `GET /api/health` is used to tell "API down" from
"wrong address".

### Secrets

None in the repo. `EXPO_PUBLIC_*` values are compiled into the client bundle and
are public by definition, so only the API address lives there. The session token
is obtained at runtime and stored in the device keychain/keystore via
`expo-secure-store`. `.env*` and native build output are gitignored.

---

## Architecture

```
mobile/
  app/                        expo-router routes (typed routes enabled)
    _layout.tsx               providers, session gate, native splash handoff
    (auth)/login.tsx          sign in
    (tabs)/                   authenticated shell, glass tab bar
      index.tsx               Homework (Today)
      messages.tsx            conversation list
      settings.tsx            display name, section, appearance, sign out
      classwork|requests|notifications.tsx   placeholders
    chat/[id].tsx             chat thread
    new-chat/index.tsx        debounced classmate search
  src/
    api/                      the only place that touches the network
      client.ts               bearer auth, timeouts, error mapping, 401 funnel
      endpoints.ts            one typed function per endpoint + local validation
      files.ts                authenticated downloads, size/MIME helpers
      errors.ts               ApiError kinds -> human sentences
      session.ts              SecureStore token
    auth/                     AuthProvider, cached user, AuthedStack guard
    design/                   tokens + GlassSurface, Icon, Button, Sheet, Avatar,
                              AuthedImage, AuthedFileRow, ImageLightbox, …
    features/
      homework/               query hooks, date grouping, swipeable row
      media/                  picker + image compression, source sheet
      messages/               queries, outbox, timeline, bubble, composer
    query/                    QueryClient, persistence, AppState/NetInfo bridges,
                              useScreenActive
    utils/                    date formatting, slow-operation warning
```

---

## Authentication

`POST /api/auth/login` returns `{authenticated, token, user}`. The token goes in
SecureStore and every request — including image and file loads — carries
`Authorization: Bearer <token>`. Tokens last 30 days.

The server accepts the same token via the `app_session` cookie for the web app
(`server/auth/requireAuth.js`), but this client is deliberately **bearer-only**:
native image and file loaders do not share the React Native cookie jar, so a
cookie-based session could not authenticate an attachment download.

Startup order, which is what makes relaunch instant and offline usable:

1. Read token + cached user snapshot from secure storage.
2. If both exist, enter the signed-in state immediately — no login flash.
3. Revalidate `/api/auth/me` in the background. Rejected → sign out.
   Unreachable → stay signed in and expose `revalidationError` for a banner.

Any 401 anywhere funnels through one `setUnauthorizedHandler`, which clears the
token, wipes the cache (including persisted lists, so the next account cannot see
the previous one's data) and returns to login. **A 401 is never retried.**

### Authenticated media

`attachmentUrl` and `fileUrl` are not public. There is exactly one sanctioned way
to display or open them:

- **`<AuthedImage path=… />`** — expo-image with the auth header attached, plus
  disk caching so a chat thread does not re-fetch photos on every 3s poll.
- **`<AuthedFileRow path=… />`** — downloads with the header via
  `FileSystem.downloadAsync`, then hands the local file to the OS share sheet.
- **`<ImageLightbox />`** — full-screen viewer with pinch-zoom, pan and
  double-tap-to-zoom.

A plain `<Image source={{ uri }} />` renders nothing against this API. If you find
a hand-built file URL anywhere else in the app, it is a bug.

---

## Cross-cutting behaviour

### Server state

TanStack Query owns all of it; nothing fetches in a `useEffect`.

- **Timeouts on every request** — 15s default, 45s for the slow portal re-scrape
  and for login, 60s for uploads. No spinner can hang forever.
- **Retries** back off twice and are skipped for failures that cannot succeed on
  retry: 401, 403, 404, 400, 413 and **429**.
- **Precise invalidation.** Sending a message writes the confirmed message
  straight into `["messages", id]` and invalidates only `["conversations"]`.
  Completing homework or saving a note writes the optimistic value and invalidates
  nothing — the value sent *is* the new state, and refetching would re-trigger the
  slow portal scrape.

### Polling

There is no realtime channel. Cadences live in one place (`POLL_INTERVALS`):
messages 3s, inbox 6s, unread badge 20s.

Every interval is gated on `useScreenActive()` — **focused AND foregrounded**.
Screen focus alone is not enough: a focused screen keeps polling after the user
switches apps. When the gate returns `false`, TanStack Query clears the timer, so
backgrounding the app stops all traffic. This is directly verifiable in a network
log, and there are no manual `setInterval`s to leak.

`AppState` also drives TanStack's `focusManager` globally as a second line of
defence, with `refetchIntervalInBackground: false`.

### Offline

`homework`, `classwork` and `conversations` persist to AsyncStorage (7-day max
age), so those screens open with real content offline behind a banner. Message
threads, search and the unread badge are intentionally **not** persisted — a stale
thread shown as current is worse than showing nothing, and a stale badge is just
wrong.

**Nothing is queued silently.** Mutations are never persisted; a send that fails
fails visibly and keeps its content.

### Optimistic updates

| Action | Optimistic behaviour | On failure |
| --- | --- | --- |
| Complete homework | Checkbox flips instantly | Previous cache snapshot restored, banner explains |
| Save note | Text applied on blur | Snapshot restored, **draft stays on screen** |
| Send message | Bubble appears immediately in a "sending" state | Bubble turns to "Not sent" with **Retry** and **Edit**; Edit returns the text and attachment to the composer |
| Mark read | Row badge *and* tab badge clear together | Both restored |

Sending uses a dedicated outbox rather than an optimistic cache write: the 3s poll
would overwrite an optimistic cache entry and make the bubble flicker out and
back. The outbox lives beside the query and is merged at render time.

### Errors

`describeApiError` maps every failure to a human sentence. A raw error object is
never rendered.

| Condition | Copy |
| --- | --- |
| 401 | "Signed out" — session cleared, back to login |
| `SCHOOL_SESSION_EXPIRED` | "School session expired — sign in again to reconnect" |
| 413 / local oversize | States the actual size **and** the 4 MB limit |
| 429 | "Slow down a moment" with the `Retry-After` seconds |
| 502/503/504 | "School portal unreachable" — explicitly *not* a password problem |
| Network, offline | "You're offline" vs "Can't reach the server", told apart via NetInfo |

### Lists

`FlatList`/`SectionList` with stable keys and memoised rows. The conversation list
has a fixed row height and supplies `getItemLayout`; homework and chat rows are
variable-height, so they use tuned `initialNumToRender`/`windowSize` instead. The
chat list renders `inverted`.

### Accessibility

44pt minimum targets (`MIN_TOUCH_TARGET`), labels on every control, Dynamic Type
with a 1.6× cap so dense rows degrade instead of shattering, and Reduce Motion
collapsing every spring to 0ms. Swipe-to-complete on homework is a shortcut, never
the only path — the row's leading checkbox is the accessible equivalent. Glass
surfaces always paint a legibility scrim, which is what holds contrast at AA over
arbitrary scrolling content.

---

## Backend alignment

The contract deviations flagged in increment 1 have since been **resolved
server-side** (`server/auth/requireAuth.js`, `server/limits.js`):

- Bearer tokens are accepted on every route, and login returns `token`.
- `PATCH /api/auth/profile` exists and enforces 2–40 characters.
- `GET /api/health` exists.
- Rate limits are real and send `Retry-After`: messages 40/min, search 120/min,
  classwork uploads 20/min, requests 10/min.
- `messages[].senderName` and `senderStudentId` are returned, so the client no
  longer infers them.

One intentional difference remains: the server allows **10 MB** uploads on a
normal Node host but only **4 MB** when deployed serverless (the platform rejects
a larger body before the function runs). The client enforces 4 MB everywhere, so
an upload cannot succeed in development and then fail in production.

---

## Roadmap

Increment 3: Classwork (upload sheet reusing `AttachmentSourceSheet`, inline
previews via `AuthedImage`, PDF viewer, owner-only delete), Requests (Open/
Completed segments, create sheet, complete, delete) and Notifications (grouped,
deep-linked via `link`, mark all read).

Structured so the v1 non-goals drop in without a rewrite: push notifications sit
beside `AuthProvider` and reuse the notification link parser; realtime replaces
the `refetchInterval` in the message hooks with a subscription writing into the
same query keys; an offline write queue becomes a persisted mutation cache. None
of those require touching a screen.

## Scripts

```bash
npm start        # Metro
npm run ios
npm run android
npm run typecheck
npm run lint
```
