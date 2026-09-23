# SECURITY.md — Threat verification

Phase scope: Jev → AI Studio homework pipeline + UI formatting commit `1eed528`.
Mode: retroactive STRIDE (no plan-time `<threat_model>` existed).

## Security Audit 2026-09-23

| Metric | Count |
|--------|-------|
| Threats found | 11 |
| Closed | 11 |
| Open | 0 |

## Threat register

| ID | Category | Component | Status | Evidence / mitigation |
|----|----------|-----------|--------|------------------------|
| T1 | Info Disclosure | `server/typesafe/typesafeClient.js` | CLOSED | Hardcoded `DEFAULT_KEY` removed; provider calls throw when `TYPESAFE_API_KEY` unset. Prior key must be rotated (it was in git history). |
| T2 | Tampering / abuse | `server/moderation/checkContent.js` | CLOSED | Jev outage no longer fails open: local `checkBadWords` runs as fallback (`checkTextSafety`). Images still fail closed. |
| T3 | Tampering (LLM) | `server/formatting/homeworkFormatter.js` | CLOSED | `temperature: 0.1`, JSON-only instructions, fence strip, unparseable → passthrough (no cache/breaker trip), HW/CW prefix strip, `updated`-flag gating in `applyAiToRows`, input capped at 4000 chars, output fields capped. |
| T4 | Info Disclosure (privacy) | Jev + AI Studio egress | CLOSED | `redactContactPii` strips emails and phone-like runs (≥10 digits) from `state`/prompt before external calls; shortlink normalize still used for IDs. Client only receives `aiPending`. |
| T5 | DoS (AI budget) | Quota / breaker / backgrounding | CLOSED | RPM/TPM/RPD `tryReserve`+`settleTokens`; Jev breaker 3→30s; formatter breaker 3→60s; reclassify throttle 30min/user + limit 5; concurrency 4; AI never on HTTP path; 1000-entry caches. |
| T6 | Spoofing / DoS | Legacy `POST /fetch-homework` | CLOSED | Root whole-router mount removed (`550f278`); fixed portal URL; cookie length validated; rate limit 30/min. Residual: unauthenticated bounded portal fetch (accepted). |
| T7 | Elevation (IDOR) | Homework ownership | CLOSED | All queries filter `userId`; `findOwnedHomeworkState` 404s; `requireAuth`; per-user upsert/AI queues. |
| T8 | XSS | UI formatting `1eed528` | CLOSED | React text nodes; `contentParser` accepts strings only; no homework-path `dangerouslySetInnerHTML`. |
| T9 | Tampering | `PATCH /api/auth/profile` displayName | CLOSED | Display name runs through `checkContent` (Jev + local) before save. |
| T10 | Availability | `authRoutes.js` login prefetch `section` | CLOSED | `section`/`displayName`/`role` declared before the prefetch closes over them. |
| T11 | Info Disclosure | Key transport / admin default | CLOSED | Keys only via env over HTTPS; baked-in `Admin#MMSS2026` default removed — admin login refuses when `ADMIN_PASSWORD` unset. |

## Accepted risks / residuals

- **T6 residual:** Unauthenticated legacy fetch can trigger one school-portal scrape per rate-limited call (30/min/IP). Legacy client expiry will remove the route.
- **T3 residual:** Gemma may still rewrite wording within length bounds; trusted only after JSON parse + type checks. Semantic quality is a product concern, not an authz bypass.
- **Operational:** Rotate the previously hardcoded TypeSafe key; set `TYPESAFE_API_KEY`, `AI_STUDIO_API_KEY`/`GEMINI_API_KEY`, `ADMIN_PASSWORD`, `ENCRYPTION_KEY` in Vercel.

## Audit trail

- 2026-09-23 retroactive STRIDE audit of pipeline (working tree) + `1eed528` UI formatting + `550f278` legacy route hardening.
- Remediations applied for T1–T4, T9, T10, admin-default secret; regression tests added (`checkContent` outage fallback, `redactContactPii`, missing-key refusal, formatter PII/length).
- Server suite: `npm run test:server` → 59+ pass (post-fix run recorded in commit).
- threats_open: 0.
