const assert = require("node:assert/strict");
const test = require("node:test");

const { checkContent } = require("../../server/moderation/checkContent");

test("sends even short clean messages through configured AI moderation", async (t) => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = global.fetch;
  const calls = [];

  process.env.OPENAI_API_KEY = "test-key";
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() {
        return {
          results: [
            {
              flagged: false,
              categories: {},
              category_scores: {},
            },
          ],
        };
      },
    };
  };

  t.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    global.fetch = previousFetch;
  });

  assert.deepEqual(await checkContent({ text: "Thanks" }), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/moderations");

  const request = JSON.parse(calls[0].options.body);
  assert.equal(request.model, "omni-moderation-latest");
  assert.equal(request.input, "Thanks");
});

test("blocks deterministic profanity before making an AI request", async (t) => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = global.fetch;
  let called = false;

  process.env.OPENAI_API_KEY = "test-key";
  global.fetch = async () => {
    called = true;
    throw new Error("AI should not be called for a deterministic rule match");
  };

  t.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    global.fetch = previousFetch;
  });

  const result = await checkContent({ text: "m@d@rch0d" });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "text");
  assert.equal(result.strikeable, true);
  assert.equal(called, false);
});
