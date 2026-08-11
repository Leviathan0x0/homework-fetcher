const assert = require("node:assert/strict");
const test = require("node:test");
const { loginToEduSecure } = require("../../server/edusecure/edusecureAuth");

test("login POST uses the ViewState and cookies returned by the preceding GET", async (t) => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      return new Response(
        `
          <form>
            <input id="__VIEWSTATE" value="state-from-get" />
            <input id="__VIEWSTATEGENERATOR" value="generator-from-get" />
            <input id="__EVENTVALIDATION" value="validation-from-get" />
            <select id="drpSession"><option value="2026-2027">2026-2027</option></select>
          </form>
        `,
        {
          status: 200,
          headers: { "Set-Cookie": "ASP.NET_SessionId=session-from-get; Path=/" },
        }
      );
    }

    return new Response("<html><body>Student dashboard</body></html>", {
      status: 200,
      headers: { "Set-Cookie": "EduSecureAuth=authenticated; Path=/" },
    });
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const result = await loginToEduSecure("student-42", "correct-password");

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, undefined);
  assert.equal(calls[1].options.method, "POST");
  assert.match(calls[1].options.headers.Cookie, /ASP\.NET_SessionId=session-from-get/);

  const body = new URLSearchParams(calls[1].options.body);
  assert.equal(body.get("__VIEWSTATE"), "state-from-get");
  assert.equal(body.get("__VIEWSTATEGENERATOR"), "generator-from-get");
  assert.equal(body.get("__EVENTVALIDATION"), "validation-from-get");
  assert.equal(body.get("drpSession"), "2026-2027");
  assert.equal(body.get("txtusername"), "student-42");
  assert.equal(body.get("txtpassword"), "correct-password");
  assert.match(result.sessionCookies, /EduSecureAuth=authenticated/);
});
