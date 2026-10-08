# MMSS64 frontend

The production frontend. SvelteKit 2 (pinned, not 3) + Tailwind v4, built by
`@sveltejs/adapter-node` and served by `node build`.

The scaffold's own `sv create` README used to live here; it described
`adapter-auto`, which this app does not use.

## Commands

```sh
npm run dev      # dev server
npm run check    # svelte-check: types and Svelte diagnostics
npm test         # vitest, offline
npm run build    # production build into build/
npm start        # run the production build
```

## Running it

Two environment variables, both read at **runtime**:

| Variable     | Meaning                                                    |
| ------------ | ---------------------------------------------------------- |
| `BACKEND_URL` | Where the Rust API listens, e.g. `http://127.0.0.1:3001`  |
| `ORIGIN`      | The public https origin, e.g. `https://mmss64.example`     |

`ORIGIN` is not optional in production: without it adapter-node assumes `https`,
and SvelteKit's CSRF check then compares the browser's `Origin` against a
mismatched one, so **every form action answers 403** — sign in included.

```sh
# development
BACKEND_URL=http://127.0.0.1:3001 npm run dev

# production
npm run build
BACKEND_URL=http://127.0.0.1:3001 \
ORIGIN=https://mmss64.example \
HOST=127.0.0.1 PORT=3002 NODE_ENV=production npm start
```

## Tests

`npm test` runs 70 offline tests. The contract tests in
`src/lib/api/contract.test.ts` talk to a real backend and are skipped unless it is
named:

```sh
MMSS_BACKEND=http://127.0.0.1:3001 \
MMSS_STUDENT_ID=2026001 MMSS_STUDENT_PASSWORD=… \
MMSS_TEACHER_ID=t001   MMSS_TEACHER_PASSWORD=… \
npm test
```

## Where things are

- `src/lib/api/` — the only code that talks to the API. `client.ts` builds
  relative `/api/...` URLs; the server rewrites them in `src/hooks.server.ts`, the
  browser through `src/routes/api/[...path]/+server.ts`.
- `src/lib/server/session.ts` — the one place that answers "who is this".
- `../SVELTEKIT_MIGRATION.md` — why it is built this way.
- `../FINAL_MIGRATION.md` — how it is deployed, backed up and rolled back.