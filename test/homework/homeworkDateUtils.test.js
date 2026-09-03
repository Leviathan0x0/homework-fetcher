const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseHomeworkDate,
  isTodayDateInIst,
  hasTodayEntry,
  toIstWallDate,
} = require("../../server/homework/homeworkDateUtils");

function istTodayParts(now = new Date()) {
  const ist = toIstWallDate(now);
  const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const monthsLong = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  return {
    day: ist.getDate(),
    monthIdx: ist.getMonth(),
    year: ist.getFullYear(),
    short: months[ist.getMonth()],
    long: monthsLong[ist.getMonth()],
  };
}

test("hasTodayEntry matches every client-supported format", () => {
  const t = istTodayParts();
  const d2 = String(t.day).padStart(2, "0");
  const m2 = String(t.monthIdx + 1).padStart(2, "0");
  const todayForms = [
    "today",
    `${t.year}-${m2}-${d2}`,
    `${d2}/${m2}/${t.year}`,
    `${d2}-${m2}-${t.year}`,
    `${d2}.${m2}.${t.year}`,
    `${t.day} ${t.short} ${t.year}`,
    `${d2} ${t.short} ${t.year}`,
    `${t.day} ${t.long} ${t.year}`,
    `${t.short} ${t.day}, ${t.year}`,
    `${t.long} ${t.day}, ${t.year}`,
    `${t.day}th ${t.short} ${t.year}`,
    `Monday, ${t.day} ${t.short} ${t.year}`,
    `${d2}-${m2}-${t.year} 09:15`,
  ];
  for (const form of todayForms) {
    assert.equal(
      hasTodayEntry([{ date: form }]),
      true,
      `should recognise today: ${form}`
    );
  }
});

test("hasTodayEntry rejects wrong-year same day/month (no false fresh)", () => {
  const t = istTodayParts();
  const oldYear = t.year - 6;
  assert.equal(hasTodayEntry([{ date: `${t.day} ${t.short} ${oldYear}` }]), false);
  assert.equal(hasTodayEntry([{ date: `${t.day}/${String(t.monthIdx+1).padStart(2,"0")}/${oldYear}` }]), false);
});

test("hasTodayEntry handles 2-digit years, yesterday keyword, and empties", () => {
  const t = istTodayParts();
  const yy = String(t.year).slice(2);
  const d2 = String(t.day).padStart(2, "0");
  const m2 = String(t.monthIdx + 1).padStart(2, "0");
  assert.equal(hasTodayEntry([{ date: `${d2}/${m2}/${yy}` }]), true);
  assert.equal(hasTodayEntry([{ date: "yesterday" }]), false);
  assert.equal(hasTodayEntry([]), false);
  assert.equal(hasTodayEntry([{ date: "" }]), false);
  assert.equal(hasTodayEntry([{ date: null }]), false);
});

test("parseHomeworkDate validates day/month ranges", () => {
  assert.equal(parseHomeworkDate("32 Jan 2026"), null);
  assert.equal(parseHomeworkDate("32/01/2026"), null);
  assert.equal(parseHomeworkDate("not a date"), null);
  assert.equal(isTodayDateInIst("32 Jan 2026"), false);
});
