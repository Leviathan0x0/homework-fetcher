const assert = require("node:assert/strict");
const test = require("node:test");
const {
  NOTICE_SOURCES,
  allowedAttachmentUrl,
  countRecentNotices,
  fetchSchoolNoticeAttachment,
  getNoticeSource,
  parseSchoolNoticesHtml,
} = require("../../server/edusecure/schoolNoticesService");

test("maps sidebar notice kinds to the exact EduSecure pages", () => {
  assert.equal(
    NOTICE_SOURCES.circulars.url,
    "https://edusecure.in/ManavMangalMohali/ParentApp/Announcement.aspx?Type=Announcement"
  );
  assert.equal(
    NOTICE_SOURCES.important.url,
    "https://edusecure.in/ManavMangalMohali/ParentApp/Announcement.aspx?Type=Message"
  );
  assert.equal(getNoticeSource("unknown"), null);
});

test("parses circular text, dates, and relative attachments", () => {
  const notices = parseSchoolNoticesHtml(
    `
      <table id="ctl00_ContentPlaceHolder1_grdDashContents">
        <tr>
          <td>
            <span id="ctl00_ContentPlaceHolder1_grdDashContents_ctl02_lbltype">Circular</span>
            <small>10 Aug 2026</small>
            <p><b>Description:</b> School will close early.<br> Buses leave at 12:30 PM.</p>
            <a id="ctl00_ContentPlaceHolder1_grdDashContents_ctl02_HyperLink1" href="../Files/early-close.pdf">Download</a>
            <a id="ctl00_ContentPlaceHolder1_grdDashContents_ctl02_HyperLink2" href="../Files/bus-routes.pdf" title="Bus routes.pdf">View file</a>
          </td>
        </tr>
      </table>
    `,
    "circulars"
  );

  assert.equal(notices.length, 1);
  assert.deepEqual(
    {
      kind: notices[0].kind,
      type: notices[0].type,
      date: notices[0].date,
      title: notices[0].title,
      content: notices[0].content,
      attachment: notices[0].attachment,
    },
    {
      kind: "circulars",
      type: "Circular",
      date: "10 Aug 2026",
      title: null,
      content: "School will close early.\nBuses leave at 12:30 PM.",
      attachment:
        "https://edusecure.in/ManavMangalMohali/Files/early-close.pdf",
    }
  );
  assert.deepEqual(notices[0].attachments, [
    {
      url: "https://edusecure.in/ManavMangalMohali/Files/early-close.pdf",
      name: "early-close.pdf",
    },
    {
      url: "https://edusecure.in/ManavMangalMohali/Files/bus-routes.pdf",
      name: "Bus routes.pdf",
    },
  ]);
  assert.match(notices[0].id, /^[a-f0-9]{24}$/);
});

test("uses a meaningful leading bold phrase as the notice title and deduplicates rows", () => {
  const row = `
    <tr>
      <td>
        <span id="item_lbltype">Message</span>
        <small>09 Aug 2026</small>
        <p><strong>Olympiad registration</strong> Submit the consent form by Friday.</p>
      </td>
    </tr>`;
  const notices = parseSchoolNoticesHtml(
    `<table id="ctl00_ContentPlaceHolder1_grdDashContents">${row}${row}</table>`,
    "important"
  );

  assert.equal(notices.length, 1);
  assert.equal(notices[0].title, "Olympiad registration");
  assert.equal(notices[0].content, "Submit the consent form by Friday.");
  assert.equal(notices[0].kind, "important");
});

test("keeps the standard parent greeting in notice content", () => {
  const notices = parseSchoolNoticesHtml(
    `
      <table id="ctl00_ContentPlaceHolder1_grdDashContents">
        <tr><td>
          <small>14 Aug 2026</small>
          <p><strong>Dear Parent,</strong><br>* Bring the signed form.<br>Team manav mangal</p>
        </td></tr>
      </table>
    `,
    "important"
  );

  assert.equal(notices[0].title, null);
  assert.equal(
    notices[0].content,
    "Dear Parent,\n* Bring the signed form.\nTeam manav mangal"
  );
});

test("counts only notices published in the last three calendar days", () => {
  const notices = [
    { date: "14 Aug 2026" },
    { date: "12-Aug-2026" },
    { date: "11/08/2026" },
    { date: "10 Aug 2026" },
    { date: "15 Aug 2026" },
    { date: "Date unavailable" },
  ];

  assert.equal(countRecentNotices(notices, 3, new Date("2026-08-14T18:00:00Z")), 3);
  assert.equal(
    countRecentNotices(
      [{ date: "11 Aug 2026" }, { date: "15 Aug 2026" }],
      3,
      new Date("2026-08-14T20:00:00Z")
    ),
    1,
    "uses the school's India calendar date near UTC midnight"
  );
});

test("only allows attachments from the configured EduSecure school path", () => {
  assert.equal(
    allowedAttachmentUrl(
      "https://edusecure.in/ManavMangalMohali/Files/circular.pdf"
    ),
    true
  );
  assert.equal(
    allowedAttachmentUrl("https://edusecure.in/AnotherSchool/Files/circular.pdf"),
    false
  );
  assert.equal(
    allowedAttachmentUrl(
      "https://edusecure.in.evil.example/ManavMangalMohali/Files/circular.pdf"
    ),
    false
  );
});

test("streams attachment bytes with the server-side EduSecure session", async (t) => {
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(Buffer.from("%PDF-1.7\nmock"), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="school-note.pdf"',
      },
    });
  };
  t.after(() => {
    global.fetch = previousFetch;
  });

  const attachment = await fetchSchoolNoticeAttachment(
    "ASP.NET_SessionId=test-session",
    "https://edusecure.in/ManavMangalMohali/Files/school-note.pdf"
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Cookie, "ASP.NET_SessionId=test-session");
  assert.equal(attachment.filename, "school-note.pdf");
  assert.equal(attachment.contentType, "application/pdf");
  assert.equal(attachment.head.toString(), "%PDF-1.7\nmock");

  const chunks = [];
  for await (const chunk of attachment.body) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), "%PDF-1.7\nmock");
});

test("streams school attachments beyond the previous preview limit", async (t) => {
  const previousFetch = global.fetch;
  const chunkSize = 1024 * 1024;
  const chunkCount = 21;
  global.fetch = async () => {
    let sent = 0;
    return new Response(
      new ReadableStream({
        pull(controller) {
          if (sent >= chunkCount) {
            controller.close();
            return;
          }
          controller.enqueue(new Uint8Array(chunkSize));
          sent += 1;
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": String(chunkSize * chunkCount),
        },
      }
    );
  };
  t.after(() => {
    global.fetch = previousFetch;
  });

  const attachment = await fetchSchoolNoticeAttachment(
    "ASP.NET_SessionId=test-session",
    "https://edusecure.in/ManavMangalMohali/Files/large-circular.pdf"
  );

  let received = 0;
  for await (const chunk of attachment.body) received += chunk.length;
  assert.equal(received, chunkSize * chunkCount);
  assert.equal(attachment.contentLength, chunkSize * chunkCount);
});
