const assert = require("node:assert/strict");
const test = require("node:test");
const {
  NOTICE_SOURCES,
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
