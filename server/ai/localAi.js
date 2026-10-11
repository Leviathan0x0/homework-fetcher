/**
 * Optional local AI layer (Laya classifier + Gemma formatter) on 127.0.0.1.
 *
 * Every function here is best-effort and returns `null` when the service is
 * disabled, unreachable, slow, or answers with something unusable. Callers
 * treat `null` as "fall through to the existing remote provider" (TypeSafe
 * Jev / AI Studio Gemma), which in turn has its own deterministic fallback.
 * Nothing in this module is required for the API to work, so a missing or
 * crashed model process can never stall a homework request.
 *
 * Local services (both bound to 127.0.0.1 only, never public):
 *   POST {LAYA_URL}/classify   {text, section}      -> {subject, is_formatted}
 *   POST {GEMMA_URL}/format    {text, subject}      -> {homework, classwork}
 *
 * Enable with LAYA_ENABLED=true / GEMMA_ENABLED=true (default: off).
 * Timeout: AI_LOCAL_TIMEOUT_MS (default 3000).
 */

const { composeFormattedText } = require("../formatting/homeworkFormatter");

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_LAYA_URL = "http://127.0.0.1:8001";
const DEFAULT_GEMMA_URL = "http://127.0.0.1:8002";
const MAX_INPUT_CHARS = 4000;
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 60 * 1000;

// Per-service circuit breaker. A hung model that accepts the connection but
// never answers would otherwise cost every request the full timeout.
const breakers = {
  laya: { failures: 0, cooldownUntil: 0 },
  gemma: { failures: 0, cooldownUntil: 0 },
};

function isEnabled(flag) {
  return process.env[flag] === "true";
}

function timeoutMs() {
  const parsed = parseInt(process.env.AI_LOCAL_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function noteFailure(breaker) {
  breaker.failures += 1;
  if (breaker.failures >= FAILURE_THRESHOLD) {
    breaker.cooldownUntil = Date.now() + COOLDOWN_MS;
    breaker.failures = 0;
  }
}

function noteSuccess(breaker) {
  breaker.failures = 0;
  breaker.cooldownUntil = 0;
}

/** Test hook: clears the local-AI circuit breakers. */
function clearLocalAiState() {
  for (const breaker of Object.values(breakers)) {
    breaker.failures = 0;
    breaker.cooldownUntil = 0;
  }
}

/**
 * POSTs to a local model service and returns the parsed JSON body, or null on
 * any failure. Never throws.
 *
 * @param {string} url
 * @param {object} payload
 * @param {{ breaker: {failures: number, cooldownUntil: number} }} options
 * @returns {Promise<object|null>}
 */
async function callLocal(url, payload, { breaker }) {
  if (Date.now() < breaker.cooldownUntil) return null;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs()),
    });
    if (!res.ok) {
      noteFailure(breaker);
      return null;
    }
    const data = await res.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      noteFailure(breaker);
      return null;
    }
    noteSuccess(breaker);
    return data;
  } catch {
    // Disabled-but-unreachable, timeout, connection refused, bad JSON body.
    noteFailure(breaker);
    return null;
  }
}

/**
 * Local Laya classification: subject + "already well formatted?" verdict.
 * Returns null when unavailable so the caller runs the remote Jev pass.
 *
 * @param {string} text
 * @param {{ section?: string }} [options]
 * @returns {Promise<{subject: string, isFormatted: boolean}|null>}
 */
async function localClassify(text, { section = "" } = {}) {
  if (!isEnabled("LAYA_ENABLED")) return null;
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) return null;

  const data = await callLocal(
    `${(process.env.LAYA_URL || DEFAULT_LAYA_URL).replace(/\/+$/, "")}/classify`,
    { text: trimmed.slice(0, MAX_INPUT_CHARS), section },
    { breaker: breakers.laya }
  );

  if (
    !data ||
    typeof data.subject !== "string" ||
    typeof data.is_formatted !== "boolean"
  ) {
    return null;
  }

  return { subject: data.subject.trim() || "School Diary", isFormatted: data.is_formatted };
}

/**
 * Local Gemma formatting: messy teacher text -> {homework, classwork}.
 * Returns null when unavailable so the caller runs the remote AI Studio
 * formatter (which itself passes text through when it fails).
 *
 * The returned shape matches formatHomeworkEntry(), so the call site can use
 * whichever answer it gets without branching.
 *
 * @param {string} text
 * @param {string} subject
 * @returns {Promise<{formattedText: string, updated: boolean, homework: string|null, classwork: string|null}|null>}
 */
async function localFormat(text, subject = "") {
  if (!isEnabled("GEMMA_ENABLED")) return null;
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) return null;

  const data = await callLocal(
    `${(process.env.GEMMA_URL || DEFAULT_GEMMA_URL).replace(/\/+$/, "")}/format`,
    { text: trimmed.slice(0, MAX_INPUT_CHARS), subject },
    { breaker: breakers.gemma }
  );

  if (!data || typeof data !== "object") return null;

  let hw = typeof data.homework === "string" ? data.homework.trim().slice(0, MAX_INPUT_CHARS) : null;
  let cw = typeof data.classwork === "string" ? data.classwork.trim().slice(0, MAX_INPUT_CHARS) : null;
  // Model output must not carry its own HW/CW labels into the stored body.
  if (hw) hw = hw.replace(/^(?:homework|home\s*work|hw)[:\s-]*/i, "").trim() || null;
  if (cw) cw = cw.replace(/^(?:classwork|class\s*work|cw)[:\s-]*/i, "").trim() || null;

  // No usable fields: hand back null so the remote formatter still gets its
  // turn instead of silently swallowing the entry.
  if (!hw && !cw) return null;

  const formattedText = composeFormattedText(hw, cw, trimmed);
  return { formattedText, updated: formattedText !== trimmed, homework: hw, classwork: cw };
}

module.exports = {
  localClassify,
  localFormat,
  clearLocalAiState,
};
