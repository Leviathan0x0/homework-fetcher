# MMSS64 — HTTPS cutover and production-configuration runbook

Scope: the two release blockers that no application change can resolve. This document is a
plan, not a record of work done. **Nothing here has been executed.** No DNS record, no
certificate, no server access, and no live configuration was inspected, so every step below
is written as an instruction to the owner rather than a claim.

Every step names what must be *observed* before the next one is attempted. The ordering is
load-bearing: the `vercel.json` rewrite is the last step, and doing it earlier is how a
half-finished cutover turns into an outage.

Related: `DEPLOYMENT.md` (Blockers 2 and 3), `EDUSECURE_AUDIT.md` (Blocker 4).

---

## 0. What is actually wrong, and what is not

Being precise here prevents both a pointless fix and a false all-clear.

**Wrong.** `vercel.json:11` rewrites `/api/:path*` to `http://57.155.88.204/api/:path*`.
The browser's leg is HTTPS (`https://<app>.vercel.app`), so the cookie's `SameSite` and
`Secure` semantics still hold for the user agent. The exposure is strictly the **second**
hop, from Vercel's edge to the Azure VPS, which is cleartext over the public internet.
Everything on it is readable *and rewritable* in flight:

- the sign-in request body — MMSS64 password, EduSecure password, and on
  `PATCH /api/auth/password` both the current and the new password;
- the `Cookie:` request header (the session id);
- the `Set-Cookie` response and `LoginResponse.token`.

Rewritability is the worse half: an on-path attacker can alter homework and announcement
bodies rendered to a student, or strip a response that would have reported a failure.

**Not wrong.** These were checked and are fine; do not "fix" them:

- **The bare IP is not itself the vulnerability.** TLS needs a *name* to validate a
  certificate against, which is why a hostname is required — not because an IP in a URL is
  inherently unsafe. Once a valid certificate exists, the hostname is what makes the hop
  verifiable rather than merely encrypted.
- **`server_name _` and `listen 80` are not the vulnerability either.** They are the
  *absence of the fix*. `infra/nginx/mmss64.conf` was written for the pre-HTTPS topology.
- **The rate limiter's use of `X-Forwarded-For` is unchanged by this work.** See
  `DEPLOYMENT.md` §"Blockers" note 6; the address bucket is defence-in-depth, and the
  per-account bucket is the control that is not spoofable.

### A port mismatch that will break the cutover if it is not noticed

`infra/nginx/mmss64.conf:24` proxies to `http://127.0.0.1:3000`, and `:3000` is the
**legacy Express** process (`server.js:318`). The Rust API listens on `3001`
(`config.rs:256` default; `DEPLOYMENT.md` probes use 3001). So the current nginx config
does not front the Rust service at all.

This is not a cosmetic difference. If nginx is pointed at TLS while still proxying to
3000, the hop becomes *encrypted* and still routes traffic to the *old, non-hardened*
backend — the worst of both outcomes, because the appearance of a fix is exactly what a
release review looks for. Step 3 below changes the upstream as part of enabling TLS, and
the cutover must not be signed off on a green health check alone: a 200 from `:3000/health`
is not evidence that `:3001` is being served.

Which process is actually enabled on the host today is **UNKNOWN** — it requires SSH.

---

## 1. Preconditions the owner must supply

None of these can be derived from this repository, and none are guessed below.

| # | Prerequisite | Why it cannot be assumed |
| --- | --- | --- |
| P1 | **A domain name the project owner controls**, plus registrar/DNS account access | A repo-wide search for any registered domain returns only `*.vercel.app`. There is no domain in evidence, so there is nothing to point a certificate at. |
| P2 | **SSH access to the Azure VPS** as a sudo-capable user | Needed to read `/etc/systemd/system/`, `/etc/mmss64/mmss.env`, and to install a certificate. No live host was contacted. |
| P3 | **Confirmation of the Azure public IP** (`57.155.88.204`) and whether it is static | A dynamic public IP would make a bare A record flap. A static IP makes it permanent. |
| P4 | **An email address for ACME registration** | Let's Encrypt account creation requires one. |
| P5 | **A decision on which origin topology is intended** | See §2. This changes `ALLOWED_ORIGINS` and `COOKIE_SAME_SITE`, so it must be settled before the service is restarted. |
| P6 | **A maintenance window** for the plaintext-to-HTTPS change | Step 5 briefly refuses plaintext API traffic. |

---

## 2. Choose the topology first

The rest of the configuration follows from this one decision, so it comes before any
certificate work.

**Option A — same-origin rewrite (recommended, and the current intent).**
Browser → `https://<app>.vercel.app/api/*` → Vercel rewrite → `https://<api-host>/api/*` →
nginx → `127.0.0.1:3001`. The browser still only ever sees the Vercel origin, so:

- `ALLOWED_ORIGINS` stays **unset**. Unset means an empty allowlist, which denies every
  cross-origin browser call. That is correct here and must stay that way — the backend is
  not meant to be called directly from a browser page on another origin.
- `COOKIE_SAME_SITE=lax` (the default). Correct for same-origin.
- No CORS preflight is ever sent by the browser, which is why the preflight regression test
  in `tests/account_security.rs` exists to protect the *other* topology rather than this one.

**Option B — separate origins.** Only if the owner decides the frontend and API should sit
on different hostnames. Then **all three** of `ALLOWED_ORIGINS=https://<frontend>`,
`COOKIE_SAME_SITE=none`, and `COOKIE_SECURE=true` are required together; `config.rs:221`
refuses to boot on `SameSite=None` without `Secure`. Note `ALLOWED_ORIGINS=*` is rejected
at boot (`config.rs:305`) — a wildcard with `allow_credentials(true)` would be unsafe, and
the layer would panic on it.

**Recommendation: Option A.** It is what the code is written for, it needs no CORS
configuration, and it keeps the session cookie on the default `SameSite`.

---

## 3. DNS

Owner-supplied name, placeholder `<api-host>` below. **Do not substitute an unregistered
name** — a certificate cannot be issued for it, and a rewrite to a name that does not
resolve is an outage.

```
# P3 must be confirmed first: this is a permanent A record ONLY if the IP is static.
api.example-school.edu.   A   57.155.88.204
```

If the IP is dynamic, use a DDNS client on the host instead of an A record — and note that
`vercel.json` destinations must then be re-checked whenever it moves, which is an argument
for P3 being settled early.

Optional hardening, if the school operates its own mail: add CAA records permitting only the
chosen ACME CA. Skipped here because no domain is in evidence.

**Verify before proceeding:**

```bash
dig +short <api-host> A          # must return the VPS IP
dig +short <api-host> AAAA       # informational; empty is fine
```

---

## 4. TLS certificate and Nginx

### 4a. Certificate

Use Certbot's ACME flow. Webroot is preferred over `--nginx` because it does not rewrite the
site config, so the nginx change in 4b stays reviewable as a single deliberate diff.

```bash
sudo apt-get install -y certbot
sudo certbot certonly --webroot -w /var/www/html \
  -d <api-host> \
  --email <owner-email> \
  --agree-tos --no-eff-email
```

This writes `/etc/letsencrypt/live/<api-host>/{fullchain.pem,privkey.pem}`.

**Renewal strategy.** Certbot installs `/etc/certbot/renewal/<api-host>.conf`; the renewal
is a timer that runs twice daily and renews only when under 30 days remaining. Verify the
timer is present and the dry run passes — a renewal that silently fails is how a
certificate expires unnoticed:

```bash
sudo systemctl list-timers certbot.timer
sudo certbot renew --dry-run
```

The dry run uses a staging endpoint and issues no real certificate, so it is safe to run.

### 4b. Nginx

Replace `infra/nginx/mmss64.conf`. Two changes are made together on purpose: **the TLS
listener, and the upstream correction to 3001** (§0). Enabling TLS while still proxying to
the legacy Express process would encrypt traffic to the wrong backend.

```nginx
server {
    listen 80;
    server_name <api-host>;

    # ACME HTTP-01 must keep working over plaintext or renewal breaks.
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Everything else on :80 redirects to TLS. This is the only plaintext that
    # survives after cutover, and it carries no API traffic.
    location / {
        return 308 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    http2 on;
    server_name <api-host>;

    ssl_certificate     /etc/letsencrypt/live/<api-host>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<api-host>/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    # HSTS. Deliberately NOT set before the cutover is verified: the `max-age`
    # is cached by browsers for its whole lifetime, and preloading one onto an
    # origin that later proves broken cannot be withdrawn. Add it in a follow-up
    # once §5 has passed, starting with a short max-age.
    # add_header Strict-Transport-Security "max-age=300" always;

    add_header X-Content-Type-Options nosniff always;

    client_max_body_size 12m;   # unchanged: 10 MB uploads, see mmss-backend/DEPLOYMENT.md

    location / {
        proxy_pass http://127.0.0.1:3001;   # was 3000 (legacy Express) — see §0
        proxy_http_version 1.1;
        proxy_set_header Host $host;

        # Pass Vercel's X-Forwarded-For through unchanged. See §0: nginx is a
        # pass-through here, not an appender, so the leftmost entry is the real
        # client. Switching to the rightmost entry would collapse a whole school
        # behind one NAT into a single rate-limit bucket.
        proxy_set_header X-Forwarded-For $http_x_forwarded_for;

        # Now that nginx terminates TLS itself, this must be the real scheme, not
        # Vercel's pass-through value. The Rust backend builds absolute URLs and
        # reads cookie security from this.
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host $host;

        # WebSocket upgrade. Harmless for plain HTTP traffic and required if any
        # endpoint ever upgrades; the header is only forwarded when present.
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        # EduSecure scrapes and AI-assisted refreshes can exceed 60s.
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}

# Outside the server blocks, in the http{} block of nginx.conf:
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

Notes on the changes, each load-bearing:

- **`X-Forwarded-Proto https` is no longer a pass-through.** Once nginx terminates TLS,
  forwarding Vercel's value would tell the backend the scheme was something else. The
  backend uses this for absolute URL construction and cookie security decisions.
- **The `map` block** must live in `http{}`, not `server{}`, or nginx will not start.
- **No `server_name _` catch-all.** The old default server accepted any `Host` header. A
  named server does not, so a request for an unknown host gets no certificate match rather
  than being served. This is why the plaintext listener above is scoped to
  `<api-host>` too, with a deliberate 308 rather than a silent default.
- **Port 3000 is left unbound publicly.** `server.js:320` already documents that the Node
  app must never be reachable from the network; both processes must stay on `127.0.0.1`.

### 4c. WebSocket behaviour

No endpoint in this repository currently upgrades a connection — the frontend uses
`fetch`, and the Rust backend registers no WebSocket route. The `Upgrade`/`Connection`
headers are included so that adding one later does not silently fail behind a proxy that
strips it. If a WebSocket endpoint is added, `proxy_read_timeout 120s` will sever an idle
connection; that endpoint would need a longer timeout or an application-level ping.

---

## 5. Production cookie and CORS configuration

**Everything in this section is unverified.** The reference unit
`infra/systemd/mmss64-backend.service` contains no `Environment=` line; it inherits
everything from `EnvironmentFile=/etc/mmss64/mmss.env`, which is `root:root 0600` and not
in this repository. So this is what the owner must check, not a description of what is
currently true.

### The switch the application actually reads

`config.rs:203`:

```rust
let node_env = get("NODE_ENV").unwrap_or_default();
let production = node_env.trim().eq_ignore_ascii_case("production") || flag("PRODUCTION", false);
let secure = flag("COOKIE_SECURE", production);
```

So `NODE_ENV=production` is genuinely the switch, and `PRODUCTION=true` is an equivalent
alternative. `COOKIE_SECURE` overrides it in both directions — including to `false`, which
is deliberate so a plain-HTTP staging host stays usable, and is covered by the test
`production_implies_a_secure_cookie` (`config.rs:612`).

**Prefer an explicit `COOKIE_SECURE=true` over relying on `NODE_ENV`.** It is unambiguous at
the point of use, it survives a later edit that changes or drops `NODE_ENV`, and it does not
depend on which of two equivalent switches someone remembered.

### Check the effective values without printing a secret

Never `cat /etc/mmss64/mmss.env` into a shared terminal or a CI log — it holds
`CREDENTIAL_ENCRYPTION_KEY` and `ADMIN_PASSWORD`. Print only the variables this section is
about, and only their names and non-secret values:

```bash
# Names of the variables present, values withheld.
sudo sed -n 's/^\([A-Z_][A-Z0-9_]*\)=.*/\1/p' /etc/mmss64/mmss.env | sort

# The four non-secret values this runbook depends on.
for k in NODE_ENV PRODUCTION COOKIE_SECURE COOKIE_SAME_SITE ALLOWED_ORIGINS PORT; do
  printf '%-18s %s\n' "$k" "$(sudo grep -E "^${k}=" /etc/mmss64/mmss.env | cut -d= -f2- || echo '<unset>')"
done
```

`ALLOWED_ORIGINS` is an origin list and not a secret; `CREDENTIAL_ENCRYPTION_KEY`,
`ADMIN_PASSWORD`, `AI_API_KEY` and `EDUSECURE_PASSWORD` are **not** printed by the above.

### Required settings for Option A (same-origin)

```
NODE_ENV=production
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
# ALLOWED_ORIGINS intentionally unset — denies all cross-origin browser calls,
# which is correct for a same-origin rewrite.
PORT=3001
HOST=127.0.0.1
```

### Required settings for Option B (separate origins)

```
NODE_ENV=production
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
ALLOWED_ORIGINS=https://<frontend-host>
```

`config.rs:221` refuses to boot on `SameSite=None` without `COOKIE_SECURE=true`, which is
the intended fail-closed behaviour.

### `CREDENTIAL_ENCRYPTION_KEY`

Only needed if encrypted EduSecure credential storage is enabled — which, per
`EDUSECURE_AUDIT.md` and Blocker 4 below, it is not. If it is ever enabled:

- 64 hex characters: `openssl rand -hex 32`. `config.rs:262` treats a present-but-malformed
  key as a boot failure rather than truncating it, because a padded or shortened key would
  be predictable and the failure would otherwise surface later as undecryptable data.
- Stored **only** in `/etc/mmss64/mmss.env` (`root:root`, `0600`), never in the unit, never
  in the repository.
- **Rotating it makes every stored credential undecryptable.** There is no key ring, so
  rotation requires re-entry by each user. Not something to do as part of this cutover.
- Permissions to check: the env file `0600 root:root`; the service runs as `mmssapp`, so
  the unit's `EnvironmentFile=` must remain readable by the manager, and the file must not
  be group- or world-readable.

### Restart behaviour

`Restart=always` with `RestartSec=3` and `KillSignal=SIGTERM` / `TimeoutStopSec=30` mean a
restart drains in-flight requests before the process exits. A configuration error is a boot
failure, not a degraded mode — the process exits, systemd restarts it, it fails again, and
the service is down rather than silently insecure. **That is the correct trade, but it means
a bad edit takes the API offline until it is corrected**, so read the effective
values first (§5), then restart and confirm what the process actually logged:

```bash
sudo systemctl restart mmss64-backend
sudo journalctl -u mmss64-backend -n 50 --no-pager | grep -E "starting|listening|error"
```

There is **no `--check-config` flag**, and this is worth knowing before improvising one:
`main.rs:31` matches only `import` and `accounts`, and the `_ => {}` arm falls through to
starting the server. Passing an unrecognised flag does not validate anything — it **starts
the API**. Do not run the binary "just to check the config" on the production host.

What makes a restart safe is the ordering in `main.rs`: `Config::from_env()` runs at line
37, *before* the listener binds at line 45 and before `ensure_admin`. A bad value is a boot
failure with no window in which the listener is open, so the worst outcome of a mistake is
a service that stays down until corrected, not one that serves traffic with the wrong
settings.

**One more thing to check before trusting the environment:** `main.rs:9` calls
`dotenvy::dotenv()`, which loads a `.env` from the working directory
(`/opt/mmss64/repo/mmss-backend`) if one exists. A stray `.env` there would take effect
*in addition to* the systemd `EnvironmentFile`, and would not show up in
`/etc/mmss64/mmss.env`. Confirm the file is absent, or that its contents are intended:

```bash
sudo ls -la /opt/mmss64/repo/mmss-backend/.env 2>/dev/null || echo "no .env — systemd env only"
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl status mmss64-backend --no-pager
curl -sS localhost:3001/health     # {"status":"ok"}
curl -sS localhost:3001/ready      # {"status":"ok"} — proves the database opened
```

`/health` is liveness only. **`/ready` is the one that proves the database is reachable**;
a 200 from `/health` says nothing about storage. And per §0, check the port in the curl is
3001 — a 200 from 3000 is the legacy app and proves nothing about the Rust service.

### Verifying the cookie actually carries `Secure`

The end-to-end check, which is the one that matters:

```bash
curl -sSi -X POST https://<api-host>/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"schoolId":"<a-known-bad-id>","password":"x"}' | grep -i '^set-cookie'
```

Expect `HttpOnly; Secure; SameSite=Lax`. Two notes:

- A deliberate **wrong** password is used. The request is refused with 401, but the cookie
  attributes are still observable on the response, so no real credential is needed and
  nothing is created.
- `content-type: application/json` is **required**. The global CSRF guard
  (`middleware.rs`, `require_json_content_type`) refuses any state-changing request
  without a JSON content type — including a bodyless one. A 415 here means the header is
  missing, not that the guard is broken.

If `Secure` is absent, stop. Do not update `vercel.json`.

---

## 6. Retiring plaintext access to the API

Ordered, and only after §5 passes:

1. **Keep `:80` for ACME only.** `location /.well-known/acme-challenge/` must stay
   plaintext or renewal breaks. Everything else on `:80` already 308s to `:443`.
2. **Confirm the app is not reachable over plaintext.** After the redirect, a plaintext
   `POST /api/auth/login` must not reach the backend:

   ```bash
   curl -sSi -X POST http://<api-host>/api/auth/login \
     -H 'content-type: application/json' \
     -d '{}' | head -1     # expect 308, not a JSON error envelope
   ```

   A JSON error envelope means the request reached the application over plaintext — the
   backend is still being served on :80 and this is not done.
3. **Restrict the Azure NSG.** Allow 443 from the internet (or from Vercel's published
   egress ranges if they are fixed). Allow 80 only as far as the ACME path needs. Confirm
   3000 and 3001 were never exposed — `server.js:320` and `config.rs` both intend loopback
   binds, and the NSG is the backstop that makes that true.
4. **Consider an IP allowlist on :443** limiting the app location to Vercel's egress
   ranges, if those ranges are published and stable. Worth it: it removes the general
   internet as an attacker for the rewrite hop. Skip it if the ranges are not documented,
   since a wrong range silently breaks all traffic.

---

## 7. Updating `vercel.json` — last, and only after proof

**`vercel.json` is deliberately unchanged in this repository.** Pointing it at an HTTPS
endpoint that does not yet exist would break every API call, and pointing it at a hostname
nobody has registered would break it just as thoroughly while looking correct in review.

Do this only when **all** of the following are true:

```bash
# 1. The name resolves to the VPS.
dig +short <api-host> A

# 2. The certificate is valid for that name, from a public CA, on the current chain.
echo | openssl s_client -connect <api-host>:443 -servername <api-host> 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates

# 3. The chain validates end to end, without -k.
curl -sS --fail https://<api-host>/health

# 4. The Rust service, not the legacy Express app, is answering.
curl -sS https://<api-host>/ready     # 200 means the database opened
```

Then change exactly one line — the destination, and nothing else:

```json
{ "source": "/api/:path*", "destination": "https://<api-host>/api/:path*" }
```

`/api/preview*` and the SPA fallback are untouched. `/api/preview` deliberately stays on
Vercel's own function (`api/mmss.rs`), which is a stateless preview surface with no
database — it must not be redirected at the VPS.

**Post-change verification, before calling it done:**

```bash
# The hop the rewrite now uses is TLS end to end.
curl -sS --fail https://<app>.vercel.app/api/auth/security -o /dev/null -w '%{http_code}\n'
```

Then, in a real browser, one full sign-in: the password must be typed over the Vercel
origin, the `Set-Cookie` must carry `Secure`, and a subsequent request must be
authenticated. A curl against the Vercel origin is not sufficient — it does not exercise
the browser's cookie policy, which is where a `Secure`/`SameSite` mismatch would show up.

### Rollback

If the rewrite must be reverted, the previous value is in version control and the change is
one line. Note that reverting restores the plaintext hop: it is a rollback to a known
vulnerability, so it should be time-boxed and treated as an incident, not a resting state.

---

## 8. Final state checklist

The cutover is complete when every line below has been *observed*, not assumed:

- [ ] `dig +short <api-host> A` returns the VPS IP
- [ ] `openssl s_client` shows a valid certificate for `<api-host>`, not self-signed, not expired
- [ ] `certbot renew --dry-run` succeeds and `certbot.timer` is active
- [ ] nginx proxies to `127.0.0.1:3001`, verified by process inspection, not by a 200 from 3000
- [ ] `/ready` returns 200 over HTTPS
- [ ] `Set-Cookie` from `/api/auth/login` carries `HttpOnly; Secure; SameSite=Lax`
- [ ] `ALLOWED_ORIGINS` is unset (Option A) or exactly the one frontend origin (Option B); never `*`
- [ ] `NODE_ENV=production` **and** `COOKIE_SECURE=true` are both set in `/etc/mmss64/mmss.env`
- [ ] a plaintext `POST /api/auth/login` gets 308, never a JSON envelope
- [ ] the NSG allows 443, and 80 only for ACME
- [ ] `vercel.json` points at `https://<api-host>`, changed only after all of the above
- [ ] a real browser sign-in works end to end
- [ ] HSTS added afterwards, with a short `max-age` first

---

## 9. What this document does not establish

Stated plainly so nothing here is mistaken for a completed action:

- No DNS record was created or looked up.
- No certificate was requested or validated.
- No server was contacted; no live unit, env file, or NSG was read.
- `vercel.json` is byte-for-byte unchanged.
- The effective values of `NODE_ENV`, `COOKIE_SECURE`, `COOKIE_SAME_SITE` and
  `ALLOWED_ORIGINS` on the production host are **UNKNOWN**.
- Whether the host currently serves the Rust API or the legacy Express app is **UNKNOWN**.
- `<api-host>`, `<owner-email>`, `<frontend-host>` and `<a-known-bad-id>` are placeholders.
  Substituting an unregistered hostname is explicitly not an acceptable shortcut — it is
  what this whole document exists to prevent.
