# EduSecure — obtaining a safe positive authentication signal

Status: **INTEGRATION UNAVAILABLE. NOT READY. NOT ENABLED.**

This is a technical investigation plan, not a description of work performed. No portal
request was made, no credential was submitted, no endpoint was probed, and no client was
implemented. `services/edusecure.rs::client_for` returns `DisabledClient` for every
configuration, and that is correct today.

Related: `EDUSECURE_AUDIT.md` (the existing audit this extends), `DEPLOYMENT.md`
(Blocker 4).

---

## 1. Why this is blocked rather than merely unfinished

The obstacle is not effort. It is that **no positive authentication signal has been
observed**, and the only available signal is one that is unsafe to trust. The difference
matters: an unimplemented feature can be built; an unverifiable one cannot be shipped
without guessing, and guessing here fails in the most damaging direction available —
granting access to the wrong person.

### The legacy predicate is fail-open

`server/edusecure/edusecureAuth.js:198-215`:

```js
const isInvalid = postHtml.includes("Invalid username and password") ||
                  postHtml.includes("Invalid username") ||
                  postHtml.includes("Invalid password");

if (isInvalid) { continue; }              // only a *known* failure stops the loop

const sessionCookies = mapToCookieString(trialCookieMap);
if (sessionCookies) {
  return { sessionCookies };              // ← absence of a known error == success
}
```

The loop returns success when **no recognised error string appears and a cookie exists**.
Every one of these yields the same "authenticated" result:

| Portal response | Correct answer | Legacy result |
| --- | --- | --- |
| Login succeeded | authenticated | authenticated |
| Wrong password, new wording | rejected | **authenticated** |
| WAF / CAPTCHA / maintenance interstitial, cookie set | rejected | **authenticated** |
| Session expired mid-handshake, cookie set | rejected | **authenticated** |
| Rate-limit page, cookie set | rejected | **authenticated** |
| Markup changed, no error string | rejected | **authenticated** |
| HTTP 500 with a cookie | rejected | **authenticated** |

The last column is the whole problem. The predicate is a *deny-list*, and the deny-list is
maintained by hand against markup the portal regenerates. A deny-list is only as good as
the last time someone updated it, and nothing detects when it goes stale — the failure mode
is silent, and it errs toward admitting people.

**This predicate must not be ported.** Not "improved" — not used as a starting point with
extra checks bolted on. Any correct predicate has to be an *allow-list*: prove the response
contains something that is only present when authentication genuinely succeeded.

### It is also paired with account auto-creation

`server/auth/sessionService.js:472-484` creates a user row for any school ID that
authenticated successfully against the portal. Combined with a fail-open predicate, that
means an ambiguous portal response can **create an account**. The Rust backend must never
do this: account creation on an unverified authentication signal is account creation on a
guess. The Rust equivalent is the `setup` flow, which requires the user's own MMSS64
password plus an independently verified EduSecure credential — deliberately two
independent facts rather than one ambiguous one.

### One more consequence worth stating

`edusecureAuth.js` reuses **the end user's own** school ID and password to sign in as
them, and stores the resulting cookie. `EDUSECURE_USERNAME`/`EDUSECURE_PASSWORD` exist in
`config.rs` but no old code reads them. So:

- **An MMSS64 password must never be sent to EduSecure** — different credential, different
  system, and forwarding it would hand a school credential to a third-party portal on
  every login.
- Encrypted portal **cookies** are the right thing to store (`crypto.rs`,
  `CREDENTIAL_ENCRYPTION_KEY`), never the portal password. Cookie theft is scoped and
  revocable; a stored password is not.

---

## 2. What "a safe positive signal" means

The investigation succeeds only if it produces a predicate that **cannot** return
"authenticated" from an ambiguous response. Concretely, the evidence must establish at
least one of:

- **(A) A server-issued authenticated resource.** A response the portal serves *only* to
  an authenticated session, carrying data no anonymous caller can obtain — the student's own
  data. The old code already removed a verification round-trip to `Announcement.aspx`
  (`edusecureAuth.js:208-213`) for performance; that optimisation is exactly what removed
  the only available positive signal, and it must be reversed. The extra round trip is not
  a cost to optimise away; it *is* the authentication check.
- **(B) A server-issued session artefact.** An `auth`/`FormsAuth`/`ASP.NET_SessionId`
  cookie set only on success, with a documented meaning — as distinct from the anonymous
  session cookie set on the initial `GET`, which is issued to everyone.
- **(C) A redirect to a specific authenticated landing page** the portal does not serve to
  anonymous callers, together with the authenticated resource from (A) as a cross-check.
- **(D) Documented portal/vendor confirmation** of a stable, supported authentication
  contract, with (A) or (B) still required at runtime.

(A) is the strongest and should be the target. Anything weaker must be justified in writing
with the exact failure mode it can still produce.

**Additionally required, regardless of which signal is chosen:** a negative control. At
least one known-bad credential must be run through the finished predicate and must produce
a rejection. A predicate that has never been observed rejecting is not a predicate.

---

## 3. Investigation steps

Ordered. Each step's output is evidence the next step depends on.

### Step 1 — Obtain authorisation and a test account (owner action)

Nothing in this section can be started without it, and it is the longest-lead item.

- **Written authorisation** from the school/portal operator to automate login against the
  portal, covering: rate limits, permitted request volume, whether automated login is
  permitted at all, and who to contact when it breaks.
- **A dedicated test account** with a known password, owned by the project — never a real
  student's credentials, and never used to validate anything a student would rely on.
- **Confirmation of the correct portal base URL per school.** `edusecureAuth.js` hardcodes
  `https://edusecure.in/ManavMangalMohali/ParentApp/Login.aspx`. A hardcoded school path is
  not usable for a multi-school deployment and must become configuration
  (`EDUSECURE_BASE_URL` already exists in `config.rs`).
- **A robots/terms check** on automated access.

Ask the vendor, in writing, and keep the answer:

1. Is automated login permitted? Under what rate limit?
2. Is there a documented or supported authentication API, rather than the WebForms UI?
3. Is there a stable success marker — a cookie, a redirect, a response property?
4. Do the `__VIEWSTATE` / `__EVENTVALIDATION` field names and the login form's control ids
   have a stability guarantee? (They change between ASP.NET builds.)
5. Is the `drpSession` academic-year list authoritative, and what happens when a student has
   no sessions?
6. Is there a rate limit or lockout policy that a login attempt could trip?

### Step 2 — Capture real response pairs (owner + engineer, with authorisation)

The core evidence, and **the step that cannot be skipped or simulated**. For the test
account, capture and archive:

- the full `GET` of the login page, with all response headers and status;
- a **successful** `POST` (test account, correct password) — full response, headers,
  cookies, body;
- a **failed** `POST` (test account, wrong password) — the same;
- at least one response from a **degraded** portal state: expired session, bad session year,
  concurrent-session limit, if these can be provoked safely.

Capture raw bytes to files. A summary is not evidence; the HTML must be diffable. Capture
at least three successful runs, because the goal is to identify what is *invariant*, not
what appeared once.

**Never** capture a real student's credentials in these logs.

### Step 3 — Derive an allow-list predicate from the diff

Diff the success pair against the failure pair and enumerate every difference. For each
candidate marker, ask: *can this be present when authentication failed?*

Expected candidates, to be confirmed rather than assumed:

- the presence of a cookie absent from the failure response;
- a redirect (`Location`) to a specific page, checked with `redirect: "manual"` as the old
  code does;
- a distinctive DOM element on the authenticated landing page;
- the **absence** of any known error string — **rejected as a signal**. Absence of a deny
  signal is not presence of a positive one. This is the legacy bug, restated, and it must
  be written down explicitly so it does not creep back in.

The predicate must also be checked for stability: does the marker survive across academic
years, portal releases, and the three captured runs? If it does not, it is not a predicate,
it is a coincidence.

### Step 4 — Build a fixture corpus before any client code

Turn the Step 2 captures into committed test fixtures, with all credentials redacted and
the HTML reduced to the structurally relevant elements. Then, and only then, write
`HttpEduSecureClient`.

The fixtures are the deliverable that makes this maintainable: when the portal changes, a
test fails and points at exactly what moved, instead of a production login silently
succeeding on an error page. The suite must include, at minimum:

- success → authenticated, for **every** captured session year;
- each failure mode → rejected, **not** `portal_unreachable`;
- every degraded/ambiguous response → **rejected**, asserted explicitly rather than
  assumed;
- a network timeout → `portal_unreachable`, never `invalid_credentials`. This distinction
  is load-bearing: reporting a timeout as a wrong password tells a student their password
  is wrong when the portal is simply down, and can lead to a support escalation or a
  password reset loop.
- a markup change (fixture with a renamed control) → rejected, not authenticated.

### Step 5 — Wire it in behind the existing boundary

`client_for` (`services/edusecure.rs:156`) currently returns `DisabledClient` on both
branches — that collapse is deliberate and should stay until the client exists and is
proven. When it is implemented:

- `can_verify()` becomes `true` only for a client that genuinely works, so
  `POST /api/auth/login` stops returning 503 for legacy accounts. Answering from
  *configuration* would reveal which school IDs lack a local credential — the exact
  account-enumeration leak the current code comments warn about.
- **Fail closed on every ambiguous path.** Unknown response, unexpected status, missing
  field, parse error → `invalid_credentials` or `portal_unreachable`, never success.
- **Never auto-create an account.** Portal authentication may *verify* an existing
  account's credential. It must not be the sole basis for creating one.
- **Never send an MMSS64 password to EduSecure.** Only the user's own portal credential,
  to the portal.
- **Store encrypted portal cookies**, never the portal password, via `crypto.rs`.
- **Rate-limit portal login attempts server-side.** The portal's lockout policy is the
  operator's; tripping it locks out real students. Apply a conservative local limit and a
  backoff, and surface `portal_unreachable` distinctly.
- **Do not parallelise the session-year retry loop blindly.** The old code tries several
  years in sequence; each attempt is a login. Multiply that by a client rate limit and a
  school-wide peak and it becomes a self-inflicted lockout — the same failure mode as
  `ADDRESS_ATTEMPTS` = 100. One year first, fall back on a *specific* rejection, never on
  an ambiguous one.
- Keep the 15-second timeout and the single-worker/lazy-pool constraints the Rust service
  already imposes.

### Step 6 — Verify against the live portal, then canary

Only after the fixture suite is green:

1. Run against the live portal with the **dedicated test account** — success and failure.
2. Confirm the negative control: a wrong password produces a rejection, not an error page
   accepted as success.
3. Canary: enable for one section or a small user group, with the ledger recording every
   attempt, for at least one full school day. Watch for a rise in `portal_unreachable`.
4. Confirm no account was created by an ambiguous response — check the `users` table for
   rows whose origin was portal verification.

### Step 7 — Prove it cannot fail open

A final adversarial review, ideally by someone who did not write the client:

- attempt to construct a response that yields "authenticated" without valid credentials;
- confirm every error branch returns a rejection;
- confirm the fixture suite fails when the success marker is removed;
- confirm timeouts and 5xx never surface as invalid credentials;
- confirm no code path creates an account from an unverified signal.

If a positive signal can be constructed, the work is not finished.

---

## 4. Interim behaviour, and why it is correct

Until the above is done, the integration is **unavailable**, and the code says so rather
than pretending otherwise:

- `client_for` returns `DisabledClient` for every configuration; a fully configured
  deployment behaves exactly like an unconfigured one and reports `Unsupported`.
- `can_verify_credentials` asks the **client**, not the config, so `EDUSECURE_*` being set
  does not change a 401 into a 503 for accounts whose password was genuinely wrong — which
  would enumerate which school IDs lack a local credential.
- `GET /api/auth/security` reports `edusecureVerificationAvailable: false`, and the Account
  Security page hides a form that could only fail, rather than showing a user a control
  that does not work.
- The status endpoint is covered by
  `the_status_endpoint_does_not_advertise_an_integration_that_cannot_work`.

That behaviour is a feature. A student sees "not available" instead of an error that
suggests their password was rejected, and no ambiguous portal response can create an
account in the meantime.

---

## 5. What must not happen

Restating the constraints, because each is a tempting shortcut:

- **Do not copy the legacy predicate.** It is fail-open, and a deny-list cannot be made
  safe by adding checks — the correct shape is an allow-list.
- **Do not enable speculative authentication.** `client_for` returning a real client before
  a real client is proven is the failure this whole document exists to prevent.
- **Do not auto-create accounts after ambiguous responses.** Verified portal
  authentication may confirm an *existing* account; it may not be the sole basis for
  creating one.
- **Do not send MMSS64 passwords to EduSecure.** Store encrypted portal cookies instead.
- **Do not hardcode an academic year.** The old `["2026-2027", "2025-2026"]`
  (`edusecureAuth.js:156-159`) requires a source edit every year and will silently try a
  wrong year for a new cohort. Read the options from the page, and fail if none is usable.
- **Do not claim completeness.** No portal evidence exists in this repository, so no
  statement that the integration works can be supported here.

---

## 6. Current status

| Question | Answer | Basis |
| --- | --- | --- |
| Is the Rust EduSecure client implemented? | No | `services/edusecure.rs::client_for` returns `DisabledClient` |
| Is it safe to enable? | No | no positive signal observed; legacy predicate is fail-open |
| Is it safe to leave disabled? | **Yes** | every route fails closed and says so |
| Does any test require credentials or network? | No | fakes in tests only |
| Can an account be created from an unverified signal? | No | account creation requires the two-fact `setup` flow |
| What is needed to proceed? | Owner actions in §3 Step 1 | authorisation, test account, base URL, vendor answers |

**Bottom line: the EduSecure integration is unavailable and must stay disabled until Step 7
passes.** Nothing in this document changes that, and nothing in this document should be
read as partial progress toward enabling it — the deliverable so far is a plan and a
decision to not guess.
