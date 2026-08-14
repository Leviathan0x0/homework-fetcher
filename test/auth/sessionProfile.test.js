const assert = require("node:assert/strict");
const test = require("node:test");
const {
  extractVirtualCardName,
  fetchProfileFromEduSecure,
} = require("../../server/auth/sessionService");

const STUDENT_PROFILE_URL =
  "https://edusecure.in/ManavMangalMohali/ParentApp/StudentProfile.aspx";
const VIRTUAL_CARD_URL =
  "https://edusecure.in/ManavMangalMohali/ParentApp/VirtualCard.aspx";

test("extracts the full name from the Virtual Card NAME field", () => {
  const name = extractVirtualCardName(`
    <table>
      <tr><td>NAME</td><td>:</td><td>Kiaan Sharma</td></tr>
      <tr><td>CLASS</td><td>:</td><td>IX - F</td></tr>
    </table>
  `);

  assert.equal(name, "Kiaan Sharma");
});

test("fetches the Virtual Card and prefers its full name over Student Profile", async (t) => {
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === STUDENT_PROFILE_URL) {
      return new Response(`
        <html><body>
          <span id="ctl00_ContentPlaceHolder1_sClassSection">IX - F</span>
          <span id="ctl00_ContentPlaceHolder1_sStudentName">Kiaan</span>
        </body></html>
      `, { status: 200 });
    }
    if (url === VIRTUAL_CARD_URL) {
      return new Response(`
        <html><body><table>
          <tr><td>NAME</td><td>:</td><td>Kiaan Sharma</td></tr>
        </table></body></html>
      `, { status: 200 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  t.after(() => {
    global.fetch = previousFetch;
  });

  const profile = await fetchProfileFromEduSecure("ASP.NET_SessionId=test-session");

  assert.equal(profile.section, "9-F");
  assert.equal(profile.displayName, "Kiaan Sharma");
  assert.deepEqual(
    calls.map((call) => call.url).sort(),
    [STUDENT_PROFILE_URL, VIRTUAL_CARD_URL].sort()
  );
  assert.ok(calls.every((call) => call.options.headers.Cookie === "ASP.NET_SessionId=test-session"));
});
