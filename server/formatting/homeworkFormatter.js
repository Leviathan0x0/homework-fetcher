/**
 * Homework AI Formatter (Google AI Studio)
 * Rewrites homework entries that Jev flagged as not well formatted into JSON
 * with distinct classwork and homework fields, using Gemma on AI Studio.
 *
 * The "is it already well formatted?" check lives in
 * typesafeClient.classifyHomework (Jev noul, asked together with the subject
 * in one request). classifier.dev and Groq were removed — both rate-limited us.
 *
 * AI Studio quotas for gemma-4-26b-a4b-it, enforced client-side so we never
 * burn a request the hard way: RPM 30 · TPM 16K · RPD 14.4K
 * (overridable via AI_STUDIO_RPM / AI_STUDIO_TPM / AI_STUDIO_RPD).
 */

const AI_STUDIO_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemma-4-26b-a4b-it";
// Keep prompts bounded so a pathological diary entry cannot balloon token spend.
const MAX_INPUT_CHARS = 4000;
const { redactContactPii } = require("../typesafe/typesafeClient");

// Gemma reasons before answering and a small prompt can take ~20-30s; thinking
// cannot be disabled on this model (thinkingConfig returns 400) and hidden
// reasoning is not even returned in the response parts. The formatter only
// runs in the background AI pass, never on the HTTP path, so a long timeout
// is safe. Override with FORMATTER_TIMEOUT_MS.
const DEFAULT_TIMEOUT_MS = parseInt(process.env.FORMATTER_TIMEOUT_MS || "60000", 10);
const MAX_CACHE_ENTRIES = 1000;
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 60 * 1000;
// Gemma emits hidden reasoning parts before the answer (observed ~75+ tokens
// even for tiny prompts), so reserve generously when checking TPM up front.
const OUTPUT_TOKEN_RESERVE = 1024;

const formattedCache = new Map();

// Sliding windows for the AI Studio quota. Denying locally is free; a 429
// costs a request and risks the account, so limits are checked before fetch.
let minuteWindow = { start: -1, requests: 0, tokens: 0 };
let dayWindow = { key: "", requests: 0 };
let failures = 0;
let cooldownUntil = 0;

function clearFormatterCache() {
  formattedCache.clear();
  minuteWindow = { start: -1, requests: 0, tokens: 0 };
  dayWindow = { key: "", requests: 0 };
  failures = 0;
  cooldownUntil = 0;
}

function getApiKey() {
  return (process.env.AI_STUDIO_API_KEY || process.env.GEMINI_API_KEY || "").trim();
}

function getModel() {
  return process.env.AI_STUDIO_MODEL || DEFAULT_MODEL;
}

function getRpm() {
  return parseInt(process.env.AI_STUDIO_RPM || "30", 10);
}

function getTpm() {
  return parseInt(process.env.AI_STUDIO_TPM || "16000", 10);
}

function getRpd() {
  return parseInt(process.env.AI_STUDIO_RPD || "14400", 10);
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function rollWindows() {
  const minute = Math.floor(Date.now() / 60000);
  if (minuteWindow.start !== minute) {
    minuteWindow = { start: minute, requests: 0, tokens: 0 };
  }
  const day = new Date().toISOString().slice(0, 10);
  if (dayWindow.key !== day) {
    dayWindow = { key: day, requests: 0 };
  }
}

/**
 * Reserves quota for one request. Returns false (and reserves nothing) when
 * RPM, TPM, or RPD would be exceeded — caller must skip the call.
 * @param {number} estTokens
 * @returns {boolean}
 */
function tryReserve(estTokens) {
  rollWindows();
  if (minuteWindow.requests + 1 > getRpm()) return false;
  if (minuteWindow.tokens + estTokens > getTpm()) return false;
  if (dayWindow.requests + 1 > getRpd()) return false;
  minuteWindow.requests++;
  minuteWindow.tokens += estTokens;
  dayWindow.requests++;
  return true;
}

// Reconcile the estimate with real usage so TPM stays accurate.
function settleTokens(estTokens, actualTokens) {
  if (typeof actualTokens === "number" && actualTokens >= 0) {
    minuteWindow.tokens += actualTokens - estTokens;
  }
}

function noteFailure() {
  failures++;
  if (failures >= FAILURE_THRESHOLD) {
    cooldownUntil = Date.now() + COOLDOWN_MS;
    failures = 0;
  }
}

function noteSuccess() {
  failures = 0;
  cooldownUntil = 0;
}

function getAiStudioUsage() {
  rollWindows();
  return {
    minuteRequests: minuteWindow.requests,
    minuteTokens: minuteWindow.tokens,
    dayRequests: dayWindow.requests,
    cooldownUntil,
  };
}

/**
 * Builds the AI Studio prompt: max 3 instruction lines, then the subject,
 * then the raw entry — the model gets both what to do and which subject.
 * @param {string} text
 * @param {string} subject
 * @returns {string}
 */
function buildPrompt(text, subject) {
  const instructions =
    'Format this school diary entry into a JSON object with keys "homework" (work to do at home) and "classwork" (topics or work done in class); use null when one is empty.\n' +
    "Do not include subject name labels; fix punctuation and typos so it is clear and easy for students to understand.\n" +
    "Reply with only the JSON object.";
  const safeSubject = String(subject || "School Diary").replace(/"/g, "'");
  // Strip contact PII and hard-cap length before the text leaves the server.
  const safeText = redactContactPii(text).slice(0, MAX_INPUT_CHARS);
  return `${instructions}\n\n"subject":"${safeSubject}"\n\n${safeText}`;
}

function extractJsonText(raw) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : raw).trim();
}

/**
 * Uses AI Studio (Gemma) to extract and format homework into JSON with
 * distinct classwork and homework fields. Skips (and passes the text
 * through unchanged) when rate-limited, cooling down, or on provider errors.
 *
 * @param {string} text
 * @param {string} subject
 * @returns {Promise<{ homework: string|null, classwork: string|null, formattedText: string }>}
 */
async function formatWithAiStudio(text, subject = "") {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) {
    return { homework: null, classwork: null, formattedText: "" };
  }

  if (formattedCache.has(trimmed)) {
    return formattedCache.get(trimmed);
  }

  const passthrough = { homework: trimmed, classwork: null, formattedText: trimmed };

  // Circuit breaker: repeated failures (auth, 5xx, timeouts, 429s) would
  // otherwise stall every rewrite for the full timeout.
  if (Date.now() < cooldownUntil) {
    return passthrough;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("[formatter] AI Studio API key missing (AI_STUDIO_API_KEY / GEMINI_API_KEY)");
    noteFailure();
    return passthrough;
  }

  const prompt = buildPrompt(trimmed, subject);
  const estTokens = estimateTokens(prompt) + OUTPUT_TOKEN_RESERVE;
  if (!tryReserve(estTokens)) {
    console.warn(
      `[formatter] AI Studio rate limit reached (RPM ${getRpm()} / TPM ${getTpm()} / RPD ${getRpd()}), skipping format`
    );
    return passthrough;
  }

  const url = `${AI_STUDIO_BASE_URL}/${getModel()}:generateContent`;
  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1 },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[formatter] AI Studio HTTP ${res.status}: ${errText.slice(0, 200)}`);
      noteFailure();
      return passthrough;
    }

    const data = await res.json();
    noteSuccess();
    settleTokens(estTokens, data?.usageMetadata?.totalTokenCount);

    // Gemma returns hidden reasoning as parts with thought=true alongside
    // the visible answer — only the non-thought parts are the result.
    const rawContent = data?.candidates?.[0]?.content?.parts
      ?.filter((part) => !part.thought)
      ?.map((part) => part.text || "")
      .join("");
    if (!rawContent) {
      return passthrough;
    }

    let parsed;
    try {
      parsed = JSON.parse(extractJsonText(rawContent));
    } catch {
      // Model output quality issue, not a provider outage: pass through
      // without caching or tripping the breaker.
      console.error("[formatter] AI Studio returned unparseable JSON");
      return passthrough;
    }

    let hw = typeof parsed.homework === "string" ? parsed.homework.trim() : null;
    let cw = typeof parsed.classwork === "string" ? parsed.classwork.trim() : null;

    // Model output must not invent a runaway rewrite of the stored body.
    if (hw && hw.length > MAX_INPUT_CHARS) hw = hw.slice(0, MAX_INPUT_CHARS);
    if (cw && cw.length > MAX_INPUT_CHARS) cw = cw.slice(0, MAX_INPUT_CHARS);

    // Clean any residual HW/CW prefixes from model response
    if (hw) hw = hw.replace(/^(?:homework|home\s*work|hw)[:\s-]*/i, "").trim() || null;
    if (cw) cw = cw.replace(/^(?:classwork|class\s*work|cw)[:\s-]*/i, "").trim() || null;

    let formattedText = trimmed;
    if (hw && cw) {
      formattedText = `Homework: ${hw}\nClasswork: ${cw}`;
    } else if (hw) {
      formattedText = `Homework: ${hw}`;
    } else if (cw) {
      formattedText = `Classwork: ${cw}`;
    }

    const result = {
      homework: hw || null,
      classwork: cw || null,
      formattedText,
    };

    if (formattedCache.size >= MAX_CACHE_ENTRIES) {
      const firstKey = formattedCache.keys().next().value;
      formattedCache.delete(firstKey);
    }
    formattedCache.set(trimmed, result);

    return result;
  } catch (err) {
    console.error("[formatter] AI Studio error:", err.message);
    noteFailure();
    return passthrough;
  }
}

/**
 * Formats one homework entry via AI Studio. The caller is expected to have
 * already checked formatting with Jev (classifyHomework.isFormatted).
 *
 * @param {string} text
 * @param {string} subject
 * @returns {Promise<{ formattedText: string, updated: boolean, homework?: string|null, classwork?: string|null }>}
 */
async function formatHomeworkEntry(text, subject = "") {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) {
    return { formattedText: "", updated: false };
  }

  const aiResult = await formatWithAiStudio(trimmed, subject);
  const formattedText = aiResult.formattedText || trimmed;
  const updated = formattedText !== trimmed;

  return {
    formattedText,
    updated,
    homework: aiResult.homework,
    classwork: aiResult.classwork,
  };
}

module.exports = {
  DEFAULT_MODEL,
  formatWithAiStudio,
  formatHomeworkEntry,
  clearFormatterCache,
  getAiStudioUsage,
};
