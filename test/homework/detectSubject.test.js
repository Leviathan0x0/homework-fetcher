const assert = require("node:assert/strict");
const test = require("node:test");

const {
  detectSubjectFromText,
  pickSubject,
  subjectFromFirstLines,
  subjectFromAttachment,
} = require("../../server/homework/homeworkCacheService");

test("detectSubjectFromText keeps the nine subjects distinct", () => {
  const cases = [
    ["Political Science: read chapter 2", "Political Science"],
    ["Geography: locate the rivers on the map", "Geography"],
    ["Economics: fill the budget table", "Economics"],
    ["History: causes of World War II", "History"],
    ["Chemistry: balance these equations", "Chemistry"],
    ["Biology: label the cell diagram", "Biology"],
    ["Physics: solve these numericals", "Physics"],
    ["Science: revise chapter 4", "Science"],
    ["Social Science: SST revision", "Social Science"],
  ];
  for (const [text, want] of cases) {
    assert.equal(detectSubjectFromText(text), want, text);
  }
});

test("detectSubjectFromText splits camelCase/joined words before matching", () => {
  assert.equal(detectSubjectFromText("topics coveredGeography: map work"), "Geography");
  assert.equal(detectSubjectFromText("read and learn the topics coveredChemistry:"), "Chemistry");
  assert.equal(detectSubjectFromText("coveredPhysics numericals"), "Physics");
});

test("detectSubjectFromText matches common subject abbreviations", () => {
  assert.equal(detectSubjectFromText("Geo: map pointing"), "Geography");
  assert.equal(detectSubjectFromText("Bio ch 3 notes"), "Biology");
  assert.equal(detectSubjectFromText("Phy numericals page 12"), "Physics");
  assert.equal(detectSubjectFromText("Econ: demand and supply"), "Economics");
  assert.equal(detectSubjectFromText("Pol Sci: electoral politics"), "Political Science");
  assert.equal(detectSubjectFromText("Politics: electoral reform debate"), "Political Science");
});

test("detectSubjectFromText lets specific subjects win over generic buckets", () => {
  assert.equal(detectSubjectFromText("SST: history and geography revision"), "History");
  assert.equal(detectSubjectFromText("Science physics and biology revision"), "Physics");
  assert.equal(detectSubjectFromText("Social Science economics worksheet"), "Economics");
});

test("detectSubjectFromText falls back to School Diary without a label", () => {
  assert.equal(detectSubjectFromText("Read about political parties in India"), "School Diary");
  assert.equal(detectSubjectFromText("Bring your diary signed by parents"), "School Diary");
  assert.equal(detectSubjectFromText(""), "School Diary");
});

test("detectSubjectFromText explicit-label branch covers the nine subjects", () => {
  const cases = [
    ["Political Science", "Political Science"],
    ["Geography", "Geography"],
    ["Economics", "Economics"],
    ["History", "History"],
    ["Chemistry", "Chemistry"],
    ["Biology", "Biology"],
    ["Physics", "Physics"],
    ["Science", "Science"],
    ["SST", "Social Science"],
    ["Social Science", "Social Science"],
    ["Civics", "Social Science"],
    ["Computers", "Computers"],
    ["English", "English"],
    ["Mathematics", "Mathematics"],
    ["Art", "Art"],
  ];
  for (const [label, want] of cases) {
    assert.equal(detectSubjectFromText("", label), want, label);
  }
});

test("pickSubject never lets a generic bucket downgrade a specific subject", () => {
  assert.equal(pickSubject("Science", "Chemistry"), "Chemistry");
  assert.equal(pickSubject("Chemistry", "Science"), "Chemistry");
  assert.equal(pickSubject("Social Science", "History"), "History");
  assert.equal(pickSubject("Science", "History", "Geography"), "History");
  assert.equal(pickSubject("School Diary", "Economics"), "Economics");
});

test("pickSubject keeps a generic subject when nothing specific is available", () => {
  assert.equal(pickSubject("Social Science"), "Social Science");
  assert.equal(pickSubject("Science", "Science"), "Science");
  assert.equal(pickSubject("School Diary", "Science"), "Science");
  assert.equal(pickSubject("School Diary", "School Diary"), "School Diary");
  assert.equal(pickSubject(undefined, null, ""), "School Diary");
});

test("subjectFromFirstLines fuzzy-matches typos in the first five lines", () => {
  assert.equal(subjectFromFirstLines("Hitory: causes of world war"), "History");
  assert.equal(subjectFromFirstLines("Geogarphy map work"), "Geography");
  assert.equal(subjectFromFirstLines("Chmistry lab manual"), "Chemistry");
  assert.equal(subjectFromFirstLines("bilology cell notes"), "Biology");
  assert.equal(subjectFromFirstLines("Physisqs numericals"), "Physics");
  assert.equal(subjectFromFirstLines("Economcs budget worksheet"), "Economics");
  assert.equal(subjectFromFirstLines("Politial scince notes"), "Political Science");
  assert.equal(subjectFromFirstLines("sst revision"), "Social Science");
  // Generic bucket when nothing specific matches.
  assert.equal(subjectFromFirstLines("sciencs fair"), "Science");
});

test("subjectFromFirstLines ignores subject mentions after line five", () => {
  const text = "line one\nline two\nline three\nline four\nline five\nHistiry notes";
  assert.equal(subjectFromFirstLines(text), null);
});

test("subjectFromFirstLines returns null for ordinary diary text", () => {
  assert.equal(subjectFromFirstLines("bring your signed diary"), null);
  assert.equal(
    subjectFromFirstLines(
      "Homework: Prepare for Periodic Test II\nClasswork: Revision of the complete syllabus"
    ),
    null
  );
  assert.equal(subjectFromFirstLines(""), null);
  assert.equal(subjectFromFirstLines(null), null);
});

test("subjectFromAttachment scans the attachment path and filename", () => {
  assert.equal(
    subjectFromAttachment("https://school.edu/history-worksheet.pdf"),
    "History"
  );
  assert.equal(
    subjectFromAttachment("https://school.edu/geography/ch3.pdf"),
    "Geography"
  );
  assert.equal(
    subjectFromAttachment("https://school.edu/files/histroy_notes.pdf?x=1"),
    "History"
  );
  assert.equal(
    subjectFromAttachment("https://school.edu/social_science_revision.pdf"),
    "Social Science"
  );
  assert.equal(
    subjectFromAttachment("https://school.edu/phy/numericals.pdf"),
    "Physics"
  );
  assert.equal(
    subjectFromAttachment("https://edusecure.in/files/exercise-4.pdf"),
    null
  );
  assert.equal(subjectFromAttachment(null), null);
});
