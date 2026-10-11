# Phase 8 — AI audit and boundary

Sources: `server/ai/localAi.js`, `server/formatting/homeworkFormatter.js`,
`server/moderation/{checkContent,openaiModeration,badWords,flagLogService}.js`,
`server/typesafe/typesafeClient.js`, `server/homework/homeworkCacheService.js`.
The old backend and the frontend were **not modified**.

## Correction to the brief: there is no Groq integration

The phase brief asks for an audit of "the old AI/Groq integration". **Groq is not in the
codebase.** Grepping `server/` for `GROQ`, `groq` and `api.groq` returns nothing.

It used to be, and it was removed. `homeworkFormatter.js:8` records why:

> classifier.dev and Groq were removed — both rate-limited us.

So the current provider set is:

| Concern | Provider | Status |
| --- | --- | --- |
| Subject classification + "is it formatted?" + swear-word check | TypeSafe "Jev", `model: "jev-latest"` | active |
| Splitting a merged diary blob into `{homework, classwork}` | Google AI Studio, `gemma-4-26b-a4b-it` | active |
| Local classification | Laya, `POST :8001/classify` | optional, `LAYA_ENABLED` |
| Local formatting | Gemma, `POST :8002/format` | optional, `GEMMA_ENABLED` |
| Image safety | OpenAI `/v1/moderations` | active, hard-requires `OPENAI_API_KEY` |
| Text safety | OpenAI `/v1/moderations` | **commented out** in `checkContent.js:17` |

Five provider integrations for two or three jobs, with credentials read from environment
variables inside four separate files and provider model ids hardcoded in source. That churn
is the real lesson of the old AI layer, and it is what the new boundary is for.

## 1. What the old pipeline actually does

**Classification.** `classifyHomework` asks Jev for the subject *and* an `isFormatted`
verdict **in one request**. `localAi.localClassify` asks local Laya for the same pair. Both
return `{subject, isFormatted}`, defaulting the subject to `"School Diary"` when blank.

**Formatting.** `buildPrompt` asks Gemma to turn one messy string into
`{"homework": ..., "classwork": ...}` with `null` for an empty half. The prompt is three
instruction lines plus the subject plus the raw text, capped at 4000 characters, with
`redactContactPii` applied first. The response arrives as text (fenced JSON is stripped),
is parsed, and each half is length-capped and stripped of any residual `HW:`/`CW:` prefix
the model echoed back.

**Moderation.** `checkTextSafety` asks Jev for a swear-word verdict and falls back to
`checkBadWords` — a compiled list from `profanity-hindi` plus local Indic and school-shorthand
terms — **whenever Jev is unavailable**. `moderateImage` always runs OpenAI. Vulgar/NSFW
hits are `strikeable`; verification/size/type failures are not.

**Everything is best-effort.** All three return a neutral answer on failure rather than
throwing.

## 2. Behaviour worth preserving

| Behaviour | Why it matters |
| --- | --- |
| **Pass through on every failure** | `composeFormattedText(hw, cw, fallback)` returns `fallback` when neither field survives, so "an empty model answer never erases the entry". This is the single most important property of the old AI layer and R8 keeps it exactly |
| **Separation of concerns** | classification, formatting and moderation are three different jobs with different failure modes and different providers. Coupling them into one prompt is what makes them impossible to replace individually |
| **Bound the input before it leaves the server** | `MAX_INPUT_CHARS = 4000` |
| **Redact contact PII before it leaves the server** | `redactContactPii` runs on the prompt |
| **Bound model output** | each returned half is sliced back to the input cap, so a runaway rewrite is impossible |
| **Strip labels the model echoes back** | `hw.replace(/^(?:homework|home\s*work|hw)[:\s-]*/i, "")` |
| **Model-quality failure ≠ provider outage** | an HTTP 200 with unparseable JSON passes through *without* tripping the circuit breaker, because the provider is fine and the model was wrong |
| **Circuit breaker** | 3 failures → 60-second cooldown, so a hung model does not cost every request a full timeout |
| **Strict timeouts** | 3 s local, 60 s remote (Gemma reasons before answering and cannot be told not to) |
| **Rules-first fallback for moderation** | AI first, deterministic word list when AI is unavailable — described in the source as "availability fail-open, not policy" |

## 3. Removed, because R2/R5 now supply the structured fields

This is the bulk of the old AI layer, and the reason it can go:

* **The whole formatting/splitting responsibility.** R5's teacher API takes `homework` and
  `classwork` as separate fields that the teacher supplied directly. There is no merged
  blob left to guess apart, so the formatter prompt has nothing to do. The `isFormatted`
  classification gate existed *only* to decide whether to run that formatter, so it goes
  with it. **No formatter prompt is ported.**
* **Subject detection from text.** R5 takes `subjectId`. The frontend's `detectSubject`
  and the AI subject field are both workarounds for having no subject field.
* **The quota windows** (`AI_STUDIO_RPM/TPM/RPD`, sliding minute/day windows). Tuned to one
  account's quota; a different provider has different quotas, and encoding them makes the
  provider impossible to swap.
* **The prompt text itself.** Provider-specific and written for a model that is no longer
  being used for that job.
* **`formattedCache`.** A process-local LRU keyed on raw homework text, with no
  invalidation and no sharing between instances. R8 adds no caching.
* **Image moderation.** Out of scope: there is no upload path yet.

Kept from moderation, because a homework app still needs a safety story: the *shape* of the
check (a verdict, not an edit) and the rule that moderation **never mutates** homework.

## 4. Provider assumptions to avoid

* hardcoded model id in source (`gemma-4-26b-a4b-it`, `jev-latest`) — R8 takes a model
  name from configuration;
* hardcoded endpoint URL — R8 takes a base URL from configuration;
* credentials read from `process.env` inside each provider module — R8 reads them once, in
  `config::AiConfig`, and nothing else touches them;
* "Groq" as an assumed provider — there is no Groq code to preserve, so R8 does not assume
  one;
* four live integrations — R8 has exactly one trait, so adding a provider is adding an
  implementation, not editing a service.

## 5. The new Rust boundary

```
routes/ai.rs ──► services::ai::AiService
                      │
                      ├── AiClient (trait)      ◄── the only way out
                      │      ├── DisabledAi        (no credentials)
                      │      └── fakes in tests
                      │
                      └── config::AiConfig   ◄── the only reader of AI_* variables
```

Two capabilities, mirroring the old separation, with formatting deliberately absent:

| Capability | Request | Result |
| --- | --- | --- |
| `classify` | free text + optional subject hint | `{subject: Option<String>, is_formatted: bool}` |
| `moderate` | free text | `{flagged: bool, categories: Vec<String>}` |

`format` is **not** in the trait. R5 removed the job.

Rules that hold for every capability:

* **The boundary is advisory.** Both return a view. Neither writes to `homework`, and there
  is no code path from a model response to a domain row.
* **Model output is parsed into typed structs and validated**, never trusted into the
  domain. An unparseable, over-long or wrong-shaped answer becomes `AiError::Malformed`,
  not a partial write.
* **A timeout is enforced by the service**, with `tokio::time::timeout` around the client
  call, so the guarantee holds for *any* implementation rather than being a promise each
  client has to keep.
* **Input is bounded before the call** and output is bounded after it.
* **Disabled is a value, not a branch** — `DisabledAi` returns `AiError::Disabled`, so the
  off path runs the same code as the on path.
* **AI is never required for homework creation.** `POST /api/teacher/homework` does not
  touch this module, and no test in `teacher_api.rs` depends on it.
* **Credentials never reach a log.** `AiStatusView` reports a boolean, and `AiConfig` is
  only readable through `enabled()`/`has_api_key()`.

A future local model (Laya/Jev or Gemma) becomes one more `impl AiClient`, reachable by
configuration, with no change to a service, a route or a DTO. `ai_provider_is_a_configuration_choice`
in `tests/ai.rs` pins exactly that.

Not starting R9.