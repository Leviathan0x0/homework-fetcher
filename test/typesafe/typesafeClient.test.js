const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CANONICAL_SUBJECTS,
  isPoliticalScienceClass,
  getSubjectCriteria,
  redactContactPii,
  classifySwear,
  classifySubject,
  classifyHomework,
  clearCache,
} = require("../../server/typesafe/typesafeClient");

// Each test starts with a closed circuit breaker and empty caches so failures
// from a previous case cannot open the cooldown early.
test.beforeEach(() => {
  clearCache();
  process.env.TYPESAFE_API_KEY = process.env.TYPESAFE_API_KEY || "apikey_test_key";
});

test("isPoliticalScienceClass correctly identifies Class 9th and 10th only", () => {
  // Class 9 (should be true)
  assert.equal(isPoliticalScienceClass("9"), true);
  assert.equal(isPoliticalScienceClass("9-A"), true);
  assert.equal(isPoliticalScienceClass("9B"), true);
  assert.equal(isPoliticalScienceClass("9th"), true);
  assert.equal(isPoliticalScienceClass("9th-B"), true);
  assert.equal(isPoliticalScienceClass("Class 9"), true);
  assert.equal(isPoliticalScienceClass("Grade 9"), true);
  assert.equal(isPoliticalScienceClass("IX"), true);
  assert.equal(isPoliticalScienceClass("IX-A"), true);
  assert.equal(isPoliticalScienceClass("IX B"), true);

  // Class 10 (should be true)
  assert.equal(isPoliticalScienceClass("10"), true);
  assert.equal(isPoliticalScienceClass("10-A"), true);
  assert.equal(isPoliticalScienceClass("10B"), true);
  assert.equal(isPoliticalScienceClass("10th"), true);
  assert.equal(isPoliticalScienceClass("Class 10"), true);
  assert.equal(isPoliticalScienceClass("Grade 10th"), true);
  assert.equal(isPoliticalScienceClass("X"), true);
  assert.equal(isPoliticalScienceClass("X-A"), true);
  assert.equal(isPoliticalScienceClass("X B"), true);

  // Other classes (should be false - school is till 10th and change is strictly 9th & 10th)
  assert.equal(isPoliticalScienceClass("11"), false);
  assert.equal(isPoliticalScienceClass("11-A"), false);
  assert.equal(isPoliticalScienceClass("12"), false);
  assert.equal(isPoliticalScienceClass("8"), false);
  assert.equal(isPoliticalScienceClass("8-A"), false);
  assert.equal(isPoliticalScienceClass("8B"), false);
  assert.equal(isPoliticalScienceClass("8th"), false);
  assert.equal(isPoliticalScienceClass("Class 8"), false);
  assert.equal(isRoleOrRoman("VIII"), false);
  assert.equal(isPoliticalScienceClass("7-A"), false);
  assert.equal(isPoliticalScienceClass("VII"), false);
  assert.equal(isPoliticalScienceClass("6-B"), false);
  assert.equal(isPoliticalScienceClass("VI"), false);
  assert.equal(isPoliticalScienceClass("5"), false);
  assert.equal(isPoliticalScienceClass("Nursery"), false);
  assert.equal(isPoliticalScienceClass("KG"), false);
  assert.equal(isPoliticalScienceClass(""), false);
  assert.equal(isPoliticalScienceClass(null), false);
  assert.equal(isPoliticalScienceClass(undefined), false);

  function isRoleOrRoman(val) {
    return isPoliticalScienceClass(val);
  }
});

test("redactContactPii strips emails and phone-like runs but keeps dates", () => {
  assert.equal(
    redactContactPii("Mail homework to a.b+test@school.edu or call +91 98765 43210"),
    "Mail homework to [redacted-email] or call [redacted-number]"
  );
  // Page refs and ISO-style dates are not contact PII.
  assert.equal(redactContactPii("Due 2026-09-23 page 123"), "Due 2026-09-23 page 123");
  assert.equal(redactContactPii(""), "");
});

test("classifySwear refuses to call the provider when TYPESAFE_API_KEY is missing", async (t) => {
  const previousFetch = global.fetch;
  const previousKey = process.env.TYPESAFE_API_KEY;
  t.after(() => {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previousKey;
  });

  delete process.env.TYPESAFE_API_KEY;
  clearCache();
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return { ok: true, async json() { return {}; } };
  };

  const result = await classifySwear("test message");
  assert.equal(result.ok, false);
  assert.equal(result.isSwear, false);
  assert.equal(calls, 0);
});

test("getSubjectCriteria contains canonical subjects and substitutes Civics with Political Science for 9th and 10th", () => {
  // Non-9/10 classes (Civics, not Political Science)
  const defaultCriteria = getSubjectCriteria(false);
  assert.ok("Civics" in defaultCriteria);
  assert.ok(!("Political Science" in defaultCriteria));
  assert.ok("School Diary" in defaultCriteria);
  assert.equal(defaultCriteria["School Diary"], "General school notice, circular, holiday update, or non-subject diary entry");
  assert.equal(Object.keys(defaultCriteria).length, CANONICAL_SUBJECTS.length + 1);

  // Verify all other canonical subjects are present
  for (const subject of CANONICAL_SUBJECTS) {
    if (subject !== "Civics") {
      assert.ok(subject in defaultCriteria, `Missing canonical subject: ${subject}`);
    }
  }

  // 9th and 10th classes (Political Science, not Civics)
  const seniorCriteria = getSubjectCriteria(true);
  assert.ok("Political Science" in seniorCriteria);
  assert.ok(!("Civics" in seniorCriteria));
  assert.ok("School Diary" in seniorCriteria);
  assert.equal(Object.keys(seniorCriteria).length, CANONICAL_SUBJECTS.length + 1);
});

test("classifySwear evaluates profanity using TypeSafe noul score", async (t) => {
  const previousFetch = global.fetch;
  t.after(() => {
    global.fetch = previousFetch;
  });

  // Empty string does not make a fetch request
  const emptyResult = await classifySwear("   ");
  assert.deepEqual(emptyResult, { ok: true, isSwear: false, noul: 0 });

  // Clean message
  global.fetch = async (url, options) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.ok(options.headers.Authorization.startsWith("Bearer apikey_"));
    const body = JSON.parse(options.body);
    assert.equal(body.model, "jev-latest");
    assert.equal(body.state, "Great job on the homework!");
    assert.equal(body.questions.contains_swear.type, "noul");
    return {
      ok: true,
      async json() {
        return {
          model: "jev-1.13.0",
          answers: {
            contains_swear: {
              type: "noul",
              noul: 0.02,
            },
          },
        };
      },
    };
  };

  const cleanResult = await classifySwear("Great job on the homework!");
  assert.equal(cleanResult.ok, true);
  assert.equal(cleanResult.isSwear, false);
  assert.equal(cleanResult.noul, 0.02);

  // Swear message
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        model: "jev-1.13.0",
        answers: {
          contains_swear: {
            type: "noul",
            noul: 0.94,
          },
        },
      };
    },
  });

  const badResult = await classifySwear("badword");
  assert.equal(badResult.ok, true);
  assert.equal(badResult.isSwear, true);
  assert.equal(badResult.noul, 0.94);

  // HTTP failure response
  global.fetch = async () => ({
    ok: false,
    status: 500,
    async text() {
      return "Internal Server Error";
    },
  });

  const errResult = await classifySwear("test");
  assert.equal(errResult.ok, false);
  assert.equal(errResult.isSwear, false);
  assert.equal(errResult.error, "HTTP 500");
});

test("classifySubject evaluates subject using TypeSafe choice primitive with correct section rules", async (t) => {
  const previousFetch = global.fetch;
  t.after(() => {
    global.fetch = previousFetch;
  });

  // Empty string returns School Diary immediately
  assert.equal(await classifySubject(""), "School Diary");

  let recordedBody = null;
  global.fetch = async (url, options) => {
    recordedBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          model: "jev-1.13.0",
          answers: {
            subject: {
              type: "choice",
              choice: recordedBody.questions.subject.criteria["Political Science"] !== undefined
                ? "Political Science"
                : "Civics",
            },
          },
        };
      },
    };
  };

  // Class 8th student -> should send Civics in criteria
  const juniorResult = await classifySubject("Read chapter 3 of government functions", { section: "8-A" });
  assert.equal(juniorResult, "Civics");
  assert.ok("Civics" in recordedBody.questions.subject.criteria);
  assert.ok(!("Political Science" in recordedBody.questions.subject.criteria));

  // Class 9th student -> should send Political Science in criteria
  const class9Result = await classifySubject("Read chapter 2 on electoral politics", { section: "9-B" });
  assert.equal(class9Result, "Political Science");
  assert.ok("Political Science" in recordedBody.questions.subject.criteria);
  assert.ok(!("Civics" in recordedBody.questions.subject.criteria));

  // Class 10th student -> should send Political Science in criteria
  const class10Result = await classifySubject("Read chapter 3 on federalism", { section: "10-A" });
  assert.equal(class10Result, "Political Science");
  assert.ok("Political Science" in recordedBody.questions.subject.criteria);
  assert.ok(!("Civics" in recordedBody.questions.subject.criteria));

  // Error fallback returns School Diary (and does not poison the cache)
  global.fetch = async () => {
    throw new Error("Network timeout");
  };
  const fallbackResult = await classifySubject("Math problems page 40", { section: "8-A" });
  assert.equal(fallbackResult, "School Diary");

  clearCache();
});

test("classifyHomework asks subject and format questions in one Jev request and caches both", async (t) => {
  const previousFetch = global.fetch;
  t.after(() => {
    global.fetch = previousFetch;
  });

  // Empty string short-circuits without a request
  assert.deepEqual(await classifyHomework("   "), {
    ok: true,
    subject: "School Diary",
    isFormatted: true,
  });
  let calls = 0;
  let recordedBody = null;
  global.fetch = async (url, options) => {
    calls++;
    recordedBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          model: "jev-1.13.0",
          answers: {
            subject: { type: "choice", choice: "Mathematics" },
            well_formatted: { type: "noul", noul: 0.12 },
          },
        };
      },
    };
  };

  const res = await classifyHomework("Solve quadratic equations on page 42", { section: "8-A" });
  assert.equal(res.ok, true);
  assert.equal(res.subject, "Mathematics");
  assert.equal(res.isFormatted, false);
  assert.equal(calls, 1);

  // Both questions ride in the same payload — one Jev request per text
  assert.ok(recordedBody.questions.subject);
  assert.equal(recordedBody.questions.subject.type, "choice");
  assert.ok(recordedBody.questions.well_formatted);
  assert.equal(recordedBody.questions.well_formatted.type, "noul");

  // Second call is fully cached: no extra Jev request
  const cached = await classifyHomework("Solve quadratic equations on page 42", { section: "8-A" });
  assert.equal(cached.subject, "Mathematics");
  assert.equal(cached.isFormatted, false);
  assert.equal(calls, 1);

  // Provider failure fails open: School Diary + assume formatted (uncached)
  clearCache();
  global.fetch = async () => {
    throw new Error("Network timeout");
  };
  const failRes = await classifyHomework("Chapter 5 photosynthesis notes", { section: "8-A" });
  assert.equal(failRes.ok, false);
  assert.equal(failRes.subject, "School Diary");
  assert.equal(failRes.isFormatted, true);
});
