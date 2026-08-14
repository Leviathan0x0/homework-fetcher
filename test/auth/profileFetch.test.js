const assert = require("node:assert/strict");
const test = require("node:test");
const {
  fetchProfileFromEduSecure,
} = require("../../server/auth/sessionService");

test("uses the Virtual Card NAME field as the student's full display name", async (t) => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/VirtualCard.aspx")) {
      return new Response(`
        <html><body>
          <div class="field"><span>NAME</span><span>Guranshbir Singh Brar</span></div>
        </body></html>
      `);
    }
    return new Response(`
      <html><body>
        <span id="ctl00_ContentPlaceHolder1_sClassSection">IX - F</span>
        <span id="ctl00_ContentPlaceHolder1_sStudentName">Guranshbir</span>
      </body></html>
    `);
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const profile = await fetchProfileFromEduSecure("ASP.NET_SessionId=test-session");

  assert.equal(calls.length, 2);
  assert.ok(calls.some((call) => call.url.endsWith("/StudentProfile.aspx")));
  assert.ok(calls.some((call) => call.url.endsWith("/VirtualCard.aspx")));
  assert.equal(profile.displayName, "Guranshbir Singh Brar");
  assert.equal(profile.section, "9-F");
  assert.ok(calls.every((call) => call.options.headers.Cookie === "ASP.NET_SessionId=test-session"));
});
