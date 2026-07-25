# Homework — native mobile app

Expo (managed) + React Native + TypeScript client for the existing school homework
and messaging API in this repository. The backend is **not** modified by this app.

> **Status: increment 1 of 3.** Scaffold, design system, typed API client and the
> full auth flow are done, plus the Today / Homework screen as a working end-to-end
> proof. Classwork, Requests, Messages, New chat and Activity render an explicit
> "Coming next" placeholder inside the real chrome. See
> [Roadmap](#roadmap) and [Backend contract deviations](#backend-contract-deviations)
> — the second one needs your input.

---

## Setup

Requirements: Node 20+, and Expo Go (or a dev build) on a device or simulator.

```bash
cd mobile
npm install
npm start          # then press i / a, or scan the QR code with Expo Go
```

Run the API from the repository root in a separate terminal:

```bash
npm install
npm start          # Express on http://localhost:3000
```

### Pointing the app at an API

The base URL comes from `EXPO_PUBLIC_API_BASE_URL`.

```bash
cp .env.example .env.local
```

| Where the API runs | What to set |
| --- | --- |
| Same machine, iOS Simulator / Android emulator | Leave blank. In development the app derives `http://<metro-host-ip>:3000` automatically. |
| Same machine, **physical device** on the same Wi-Fi | `EXPO_PUBLIC_API_BASE_URL=http://192.168.1.42:3000` — your machine's LAN IP. `localhost` resolves to the phone itself and will always fail. |
| Deployed | `EXPO_PUBLIC_API_BASE_URL=https://homework.example.com` |

Restart Metro after changing an env file — `EXPO_PUBLIC_*` values are inlined at
build time, not read at runtime.

If the URL is missing in a production build the app says so explicitly on the
login screen rather than firing requests at an unknown host and timing out.

### Secrets

There are none. `EXPO_PUBLIC_*` values are compiled into the client bundle and are
therefore public by definition, so only the API address lives there. The session
credential is created at runtime and stored in the device keychain/keystore via
`expo-secure-store`. `.env`, `.env.local` and native build output are gitignored.

---

## Architecture

```
mobile/
  app/                       expo-router routes (typed routes enabled)
    _layout.tsx              providers, session gate, native splash handoff
    (auth)/login.tsx         sign in
    (tabs)/                  authenticated shell: glass tab bar
      index.tsx              Today / Homework
      settings.tsx           display name, section, appearance, sign out
      classwork|requests|messages|notifications.tsx   placeholders
  src/
    api/                     typed client — the only place that touches the network
      config.ts              base URL resolution, limits, poll cadences, timeouts
      client.ts              auth headers, timeouts, error mapping, 401 funnel
      endpoints.ts           one typed function per endpoint + local validation
      errors.ts              ApiError, kinds, human copy
      session.ts             SecureStore credential
      types.ts               response shapes
    auth/                    AuthProvider, cached user snapshot
    design/                  tokens + GlassSurface, Icon, Button, Sheet, Avatar, …
    features/homework/       query hooks, grouping, swipeable row
    query/                   QueryClient, disk persistence, AppState/NetInfo bridges
    utils/                   date formatting
```

### Server state

TanStack Query owns all of it. Nothing fetches in a `useEffect`.

- **Timeouts on every request.** 15s default, 45s for the slow portal re-scrape,
  60s for uploads. A spinner can never hang forever.
- **Retries** back off twice, and are skipped entirely for failures that cannot
  succeed on retry (401, 403, 404, 400, 413, **429**).
- **Polling** is centralised in `POLL_INTERVALS`: messages 3s, inbox 6s, unread
  badge 20s.
- **Backgrounding stops every poll.** `AppState` drives TanStack's `focusManager`,
  and `refetchIntervalInBackground` is `false`, so a single switch suspends all
  intervals — a new polled query cannot forget to opt in. `usePollInterval` also
  returns `false` when offline.
- **Offline reads** persist `homework`, `classwork` and `conversations` to
  AsyncStorage (7-day max age). Message threads, search and the unread badge are
  intentionally *not* persisted: a stale thread shown as current is worse than
  showing nothing, and a stale badge is just wrong.
- **No write queue.** Mutations are never persisted. A send that fails fails
  visibly and keeps the draft.

### Optimistic updates

Complete, note-save, send and mark-read apply immediately, snapshot the previous
cache, and restore that snapshot on failure. In-flight refetches are cancelled
first so a poll cannot clobber a pending optimistic value. A failed note save
keeps the typed draft on screen.

### Design system

`src/design/tokens.ts` is the only place with a colour or a magic number.

- **Liquid glass** via `GlassSurface`: tab bar, nav headers, sheets, chat
  composer. It always paints a legibility scrim over the blur, which is what
  holds contrast at WCAG AA over arbitrary content. Chrome only — body text sits
  on `colors.surface`. Android below API 31 falls back to an opaque surface
  because `dimezisBlurView` drops frames there.
- **Icons** via `Icon`: SF Symbols (`expo-symbols`, hierarchical rendering) on
  iOS, Material Symbols on Android. The registry pairs each name with both
  glyphs and is read per-platform, so an SF Symbol name can never ship to
  Android.
- **Motion** is spring-based, 150–250ms, and collapses to 0ms under Reduce
  Motion. Haptics on send, complete and destructive confirmations.
- **Accessibility**: 44pt minimum touch targets (`MIN_TOUCH_TARGET`), labels on
  every interactive element, Dynamic Type on with a 1.6× cap so dense rows
  degrade instead of shattering. Swipe-to-complete is a shortcut, never the only
  path — the row's leading checkbox is the accessible equivalent.
- **Dark mode** follows the system setting. There is deliberately no in-app
  override.

### Auth

1. Credential and cached user are read from secure storage at launch.
2. If both exist the app enters its signed-in state immediately, then revalidates
   `/api/auth/me` in the background. Rejected → sign out. Unreachable → stay
   signed in and show a banner. This is what lets the app open offline.
3. Any 401 anywhere funnels through one `setUnauthorizedHandler`, which clears the
   credential, wipes the cache (including persisted lists, so the next account
   cannot see the previous one's data) and returns to login.

Login distinguishes the three failures that read very differently to a student:
wrong ID/password (401, shown on the field), school portal unreachable (502,
shown as "not your fault"), and no connectivity.

---

## Backend contract deviations

The API as deployed differs from the contract I was given. Since the backend must
not change, the client adapts — but **two of these are worth a decision**.

| Contract | Reality in `server/routes/` | What the app does |
| --- | --- | --- |
| `Authorization: Bearer <token>`; login returns `{token}` | Auth is the httpOnly `app_session` **cookie**; login returns no token | Captures the credential from `token` if present, else from `Set-Cookie`, stores it in SecureStore, and sends **both** `Authorization: Bearer` and `Cookie: app_session=` on every request. Works against the server today and against a bearer upgrade later, with no backend change. |
| `PATCH /api/auth/profile` | **Not implemented** — 404s | Settings has the editor wired; a 404 surfaces as "This API build doesn't support editing your display name yet." **Needs a backend endpoint to actually work.** |
| `GET /api/health` | **Not implemented** | Unused. |
| Uploads max 4 MB | Multer allows **10 MB** | Client enforces 4 MB, the stricter value, before anything hits the network. Confirm which is intended. |
| Rate limit 40 messages/min → 429 | No rate-limit middleware found | 429 handling is implemented anyway: `Retry-After` is parsed and shown as calm inline copy, and the send is not retried. |
| `messages[].senderName` | Not returned | Resolved from the conversation's `otherUser` / the signed-in user. |
| `notifications[].isRead` boolean | Integer `0`/`1` | Normalised to a boolean at the API boundary. |
| `classwork[].fileUrl` | Server-relative `/api/classwork/files/:id`, needs the auth header | `authorizedSource()` returns `{uri, headers}` for `expo-image`; native loaders do not share the RN cookie jar, so the credential is passed explicitly. |

One consequence worth flagging: if a future runtime hides `Set-Cookie` from
`fetch`, the app falls back to the platform cookie jar and logs a dev warning.
Session and API calls still work, but authenticated **file/image loads would
not**, because native image loaders bypass that jar. A `token` in the login
response removes this fragility entirely and is the one backend change I would
argue for.

---

## Roadmap

Increment 1 (done): scaffold, design system, API client, auth, Today/Homework,
Settings.

Increment 2: Classwork (upload sheet, image compression via
`expo-image-manipulator` at 1600px/q0.8 with the resulting size shown, PDF viewer,
owner-only delete) and Requests (create sheet, complete, delete).

Increment 3: Messages (conversation list, chat with optimistic send, attachment
previews, image lightbox, glass composer), New chat (300ms debounced search) and
Activity (grouped, deep-linked, mark all read).

Structured so the v1 non-goals can be added without a rewrite: push notifications
slot in beside `AuthProvider` and reuse the existing notification link parser;
realtime replaces the `refetchInterval` in the message hooks with a subscription
that writes into the same query keys; an offline write queue becomes a persisted
mutation cache. None of those require touching screens.

## Scripts

```bash
npm start        # Metro
npm run ios      # Metro + iOS Simulator
npm run android  # Metro + Android emulator
npm run typecheck
npm run lint
```
