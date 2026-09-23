const assert = require("node:assert/strict");
const test = require("node:test");

const { checkContent } = require("../../server/moderation/checkContent");

test.beforeEach(() => {
  process.env.TYPESAFE_API_KEY = process.env.TYPESAFE_API_KEY || "apikey_test_key";
});

test("sends clean messages through TypeSafe Jev AI moderation", async (t) => {
  const previousFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() {
        return {
          model: "jev-1.13.0",
          answers: {
            contains_swear: {
              type: "noul",
              noul: 0.01,
            },
          },
        };
      },
    };
  };

  t.after(() => {
    global.fetch = previousFetch;
  });

  assert.deepEqual(await checkContent({ text: "Thanks" }), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.typesafe.ai/v1/systemone");

  const request = JSON.parse(calls[0].options.body);
  assert.equal(request.model, "jev-latest");
  assert.equal(request.state, "Thanks");
  assert.ok(request.questions.contains_swear);
});

test("blocks profanity using TypeSafe Jev AI moderation", async (t) => {
  const previousFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() {
        return {
          model: "jev-1.13.0",
          answers: {
            contains_swear: {
              type: "noul",
              noul: 0.98,
            },
          },
        };
      },
    };
  };

  t.after(() => {
    global.fetch = previousFetch;
  });

  const result = await checkContent({ text: "m@d@rch0d" });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "text");
  assert.equal(result.strikeable, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.typesafe.ai/v1/systemone");
});

test("falls back to local rules when Jev is unavailable (no policy fail-open)", async (t) => {
  const previousFetch = global.fetch;
  t.after(() => {
    global.fetch = previousFetch;
  });

  global.fetch = async () => {
    throw new Error("TypeSafe down");
  };

  // Profanity the local matcher knows must still block during a Jev outage.
  const blocked = await checkContent({ text: "you are a madarchod" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.kind, "text");

  // Clean text still passes when Jev is down.
  const clean = await checkContent({ text: "Please solve exercise 4.2" });
  assert.deepEqual(clean, { ok: true });
});
