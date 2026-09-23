const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_MODEL,
  formatWithAiStudio,
  formatHomeworkEntry,
  clearFormatterCache,
  getAiStudioUsage,
} = require("../../server/formatting/homeworkFormatter");

const RATE_ENV_KEYS = [
  "AI_STUDIO_API_KEY",
  "AI_STUDIO_MODEL",
  "AI_STUDIO_RPM",
  "AI_STUDIO_TPM",
  "AI_STUDIO_RPD",
  "GEMINI_API_KEY",
];

const ORIGINAL_ENV = Object.fromEntries(RATE_ENV_KEYS.map((k) => [k, process.env[k]]));

// beforeEach clears caches, quota windows, and the circuit breaker so
// rate-limit and cooldown state never leak between tests.
test.beforeEach(() => {
  clearFormatterCache();
  process.env.AI_STUDIO_API_KEY = "test-key";
  delete process.env.AI_STUDIO_MODEL;
  delete process.env.AI_STUDIO_RPM;
  delete process.env.AI_STUDIO_TPM;
  delete process.env.AI_STUDIO_RPD;
  delete process.env.GEMINI_API_KEY;
});

test.after(() => {
  restoreEnv(ORIGINAL_ENV);
});

function restoreEnv(previous) {
  for (const key of RATE_ENV_KEYS) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
}

function gemmaResponse(homework, classwork) {
  return {
    candidates: [
      {
        content: {
          parts: [
            // Hidden reasoning part — must be ignored by the parser.
            { text: "Thinking about how to split the homework...", thought: true },
            {
              text: JSON.stringify({ homework, classwork }),
            },
          ],
        },
      },
    ],
    usageMetadata: { promptTokenCount: 60, candidatesTokenCount: 40, totalTokenCount: 100 },
  };
}

test("formatWithAiStudio sends instructions + subject to Gemma and parses the JSON", async (t) => {
  const previousFetch = global.fetch;
  t.after(() => {
    global.fetch = previousFetch;
  });

  let request = null;
  global.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      async json() {
        return gemmaResponse("Solve algebra exercise", "World of numbers chapter completed");
      },
    };
  };

  const result = await formatWithAiStudio(
    "Solve algebra exercise. world_of_numbers chapter completed",
    "Mathematics"
  );

  assert.ok(request.url.includes(`${DEFAULT_MODEL}:generateContent`));
  assert.ok(request.url.includes("generativelanguage.googleapis.com"));
  assert.equal(request.options.headers["x-goog-api-key"], "test-key");

  const body = JSON.parse(request.options.body);
  const prompt = body.contents[0].parts[0].text;
  // System-style instructions (max 3 lines), then the subject, then the entry
  const instructionLines = prompt.split("\n\n")[0].split("\n");
  assert.ok(instructionLines.length <= 3);
  assert.ok(prompt.includes('"subject":"Mathematics"'));
  assert.ok(prompt.includes("world_of_numbers chapter completed"));

  assert.equal(result.homework, "Solve algebra exercise");
  assert.equal(result.classwork, "World of numbers chapter completed");
  assert.equal(
    result.formattedText,
    "Homework: Solve algebra exercise\nClasswork: World of numbers chapter completed"
  );

  const usage = getAiStudioUsage();
  assert.equal(usage.minuteRequests, 1);
  assert.equal(usage.dayRequests, 1);
  assert.equal(usage.minuteTokens, 100); // reconciled to real usage, not the estimate
});

test("formatWithAiStudio stops calling AI Studio once the RPM quota is exhausted", async (t) => {
  const previousFetch = global.fetch;
  t.after(() => {
    global.fetch = previousFetch;
  });

  process.env.AI_STUDIO_RPM = "1";

  let calls = 0;
  global.fetch = async () => {
    calls++;
    return {
      ok: true,
      async json() {
        return gemmaResponse("Cleaned homework", null);
      },
    };
  };

  const first = await formatWithAiStudio("messy entry number one", "Mathematics");
  assert.equal(calls, 1);
  assert.equal(first.formattedText, "Homework: Cleaned homework");

  // Quota gone: second, different text must pass through without a request
  const second = await formatWithAiStudio("messy entry number two", "Mathematics");
  assert.equal(calls, 1);
  assert.equal(second.formattedText, "messy entry number two");
  assert.equal(second.homework, "messy entry number two");
  assert.equal(getAiStudioUsage().minuteRequests, 1);
});

test("formatWithAiStudio fails open after repeated AI Studio errors (circuit breaker)", async (t) => {
  const previousFetch = global.fetch;
  t.after(() => {
    global.fetch = previousFetch;
  });

  let calls = 0;
  global.fetch = async () => {
    calls++;
    return {
      ok: false,
      status: 500,
      async text() {
        return "Internal Server Error";
      },
    };
  };

  const a = await formatWithAiStudio("broken one", "Mathematics");
  const b = await formatWithAiStudio("broken two", "Mathematics");
  const c = await formatWithAiStudio("broken three", "Mathematics");
  assert.equal(calls, 3);
  for (const res of [a, b, c]) {
    assert.equal(res.formattedText, res.homework);
  }

  // Breaker open: fourth call skips the provider entirely
  const d = await formatWithAiStudio("broken four", "Mathematics");
  assert.equal(calls, 3);
  assert.equal(d.formattedText, "broken four");
  assert.ok(getAiStudioUsage().cooldownUntil > Date.now());
});

test("formatHomeworkEntry returns updated flag and cleaned output", async (t) => {
  const previousFetch = global.fetch;
  t.after(() => {
    global.fetch = previousFetch;
  });

  global.fetch = async () => ({
    ok: true,
    async json() {
      return gemmaResponse("Solve algebra exercise", "World of numbers chapter completed");
    },
  });

  const rawText = "Solve algebra exercise. world_of_numbers chapter completed";
  const result = await formatHomeworkEntry(rawText, "Mathematics");
  assert.equal(result.updated, true);
  assert.equal(
    result.formattedText,
    "Homework: Solve algebra exercise\nClasswork: World of numbers chapter completed"
  );
  assert.equal(result.homework, "Solve algebra exercise");
  assert.equal(result.classwork, "World of numbers chapter completed");

  const empty = await formatHomeworkEntry("");
  assert.equal(empty.updated, false);
  assert.equal(empty.formattedText, "");
});

test("formatWithAiStudio redacts contact PII and caps prompt size", async (t) => {
  const previousFetch = global.fetch;
  t.after(() => {
    global.fetch = previousFetch;
  });

  let prompt = "";
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    prompt = body.contents[0].parts[0].text;
    return {
      ok: true,
      async json() {
        return gemmaResponse("Clean", null);
      },
    };
  };

  const longEntry = "Call guardian on +91 98765 43210 or email parent@x.com. " + "word ".repeat(2000);
  await formatWithAiStudio(longEntry, "Mathematics");

  assert.ok(prompt.includes("[redacted-email]"));
  assert.ok(prompt.includes("[redacted-number]"));
  assert.ok(!prompt.includes("parent@x.com"));
  // instructions + subject framing + capped body stays well under the raw input
  assert.ok(prompt.length < longEntry.length);
});
