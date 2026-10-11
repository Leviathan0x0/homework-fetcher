const test = require("node:test");
const assert = require("node:assert/strict");

const { isSameOriginRequest } = require("../../server/config");

/**
 * The proxy shape that produced "Cross-site request blocked." for every logged-in
 * user. Vercel's external rewrite forwards `/api/*` to the VPS by IP, so the server
 * receives the rewrite destination as `Host` while the browser's `Origin` is the
 * Vercel domain. Comparing `Origin` to `Host` rejected the real app's own requests.
 *
 * These are the exact header values that arrived at the VPS; verified by reproducing
 * the 403 against the live host before the fix.
 */
const VIA_VERCEL_REWRITE = {
  host: "57.155.88.204",
  forwardedHost: "mmss64.vercel.app",
};

test("a same-origin request through the Vercel rewrite is allowed", () => {
  assert.equal(
    isSameOriginRequest("https://mmss64.vercel.app", VIA_VERCEL_REWRITE),
    true,
  );
});

test("a trailing slash on the Origin does not break the match", () => {
  assert.equal(
    isSameOriginRequest("https://mmss64.vercel.app/", VIA_VERCEL_REWRITE),
    true,
  );
});

test("the rewrite destination alone is not enough to allow a request", () => {
  // The old comparison matched here, which is exactly why a request whose Origin was
  // the bare IP was treated as same-origin. `x-forwarded-host` is what the client
  // addressed, so the two disagree and the request is refused.
  assert.equal(isSameOriginRequest("http://57.155.88.204", VIA_VERCEL_REWRITE), false);
});

test("a genuine cross-site request is still blocked", () => {
  assert.equal(
    isSameOriginRequest("https://evil.example", VIA_VERCEL_REWRITE),
    false,
  );
});

test("a lookalike host does not pass", () => {
  assert.equal(
    isSameOriginRequest("https://mmss64.vercel.app.evil.example", VIA_VERCEL_REWRITE),
    false,
  );
});

test("a suffix attack on the forwarded host does not pass", () => {
  assert.equal(
    isSameOriginRequest("https://evil.example", {
      host: "mmss64.vercel.app.evil.example",
      forwardedHost: "mmss64.vercel.app",
    }),
    false,
  );
});

test("a direct connection with no proxy still works on Host alone", () => {
  assert.equal(
    isSameOriginRequest("http://localhost:3000", { host: "localhost:3000" }),
    true,
  );
});

test("a missing Origin is never same-origin", () => {
  assert.equal(isSameOriginRequest(null, VIA_VERCEL_REWRITE), false);
  assert.equal(isSameOriginRequest("", VIA_VERCEL_REWRITE), false);
});

test("no host at all is never same-origin", () => {
  assert.equal(isSameOriginRequest("https://mmss64.vercel.app", {}), false);
});
