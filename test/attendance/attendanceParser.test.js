const test = require("node:test");
const assert = require("node:assert/strict");
const { parseAttendanceHtml } = require("../../server/edusecure/attendanceService");

test("parses day-first EduSecure attendance tables", () => {
  const records = parseAttendanceHtml(`
    <table>
      <tr><th>Date</th><th>Attendance Status</th></tr>
      <tr><td>08/08/2026</td><td>Present</td></tr>
      <tr><td>07/08/2026</td><td>Absent</td></tr>
    </table>
  `, "https://edusecure.in/attendance");

  assert.deepEqual(records.map((record) => ({
    date: record.date,
    status: record.status,
  })), [
    { date: "2026-08-08", status: "present" },
    { date: "2026-08-07", status: "absent" },
  ]);
});

test("recognizes late and excused attendance statuses", () => {
  const records = parseAttendanceHtml(`
    <table>
      <tr><th>Day</th><th>Status</th></tr>
      <tr><td>06 Aug 2026</td><td>Late</td></tr>
      <tr><td>05 Aug 2026</td><td>Medical leave</td></tr>
    </table>
  `, "https://edusecure.in/attendance");

  assert.deepEqual(records.map((record) => record.status), ["late", "excused"]);
});

test("parses card-style attendance rows", () => {
  const records = parseAttendanceHtml(`
    <section class="attendance-list">
      <article class="attendance-row">08 Aug 2026 · Present</article>
      <article class="attendance-row">07 Aug 2026 · Late</article>
    </section>
  `, "https://edusecure.in/attendance");

  assert.deepEqual(records.map((record) => record.status), ["present", "late"]);
});

test("parses flattened WebForms attendance text", () => {
  const records = parseAttendanceHtml(`
    <html><body>
      Attendance Date: 08/08/2026 Status: P
      Attendance Date: 07/08/2026 Status: A
    </body></html>
  `, "https://edusecure.in/Parents/studentAttendance.aspx");

  assert.deepEqual(records.map((record) => record.status), ["present", "absent"]);
});
