const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { eq } = require("drizzle-orm");

const databasePath = path.join(
  os.tmpdir(),
  `homework-cache-service-${process.pid}-${Date.now()}.sqlite`
);
delete process.env.TURSO_DATABASE_URL;
delete process.env.LIBSQL_URL;
process.env.SQLITE_DB_PATH = databasePath;

const { db, ready, schema, sqlite } = require("../../server/db/client");
const homeworkCacheService = require("../../server/homework/homeworkCacheService");

test.before(async () => {
  await ready;
});

test.after(() => {
  try {
    sqlite?.close();
  } catch {}
  for (const suffix of ["", "-shm", "-wal"]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});

test("upsert keeps personal state, removes duplicates, and returns the saved rows", async () => {
  const userId = "cache-test-user";
  const now = new Date().toISOString();
  await db.insert(schema.users).values({
    id: userId,
    studentId: "cache-test-student",
    displayName: "Cache Test",
    section: "10-A",
    role: "student",
    createdAt: now,
    updatedAt: now,
  }).run();

  const initial = await homeworkCacheService.upsertHomework(
    userId,
    [
      {
        type: "Homework",
        date: "11 Aug 2026",
        homework: "MATHEMATICS: Complete exercise 4 https://tiny.edusecure.in/first",
        attachment: null,
      },
      {
        type: "Homework",
        date: "11 Aug 2026",
        homework: "SCIENCE: Revise chapter 2",
        attachment: null,
      },
    ],
    { skipAi: true }
  );
  assert.equal(initial.length, 2);

  // Phase 1 with skipAi stores subjects as-is ("School Diary"); AI assigns
  // real subjects later, so identify rows by content instead of subject.
  const mathematics = initial.find((item) =>
    (item.homework || "").includes("Complete exercise 4")
  );
  assert.ok(mathematics);
  await db.insert(schema.homeworkUserState).values({
    id: "math-state",
    userId,
    homeworkId: mathematics.id,
    completed: 1,
    note: "Checked once",
    createdAt: now,
    updatedAt: now,
  }).run();

  await db.insert(schema.homework).values({
    id: "legacy-duplicate",
    userId,
    sourceIdentifier: "edusecure",
    date: "11 Aug 2026",
    subject: "School Diary",
    content: "MATHEMATICS: Complete exercise 4 https://tiny.edusecure.in/oldlink",
    attachmentUrl: null,
    type: "Homework",
    createdAt: now,
    updatedAt: now,
  }).run();

  await db.insert(schema.homework).values({
    id: "legacy-homework-id",
    userId,
    sourceIdentifier: "edusecure",
    date: "12 Aug 2026",
    subject: "English",
    content: "ENGLISH: Finish the worksheet",
    attachmentUrl: null,
    type: "Homework",
    createdAt: now,
    updatedAt: now,
  }).run();
  await db.insert(schema.homeworkUserState).values({
    id: "legacy-state",
    userId,
    homeworkId: "legacy-homework-id",
    completed: 1,
    note: "Keep this note",
    createdAt: now,
    updatedAt: now,
  }).run();

  const refreshed = await homeworkCacheService.upsertHomework(
    userId,
    [
      {
        type: "Homework",
        date: "11 Aug 2026",
        homework: "MATHEMATICS: Complete exercise 4 https://tiny.edusecure.in/newlink",
        attachment: "https://edusecure.in/files/exercise-4.pdf",
      },
      {
        type: "Homework",
        date: "11 Aug 2026",
        homework: "SCIENCE: Revise chapter 2",
        attachment: null,
      },
      {
        type: "Homework",
        date: "12 Aug 2026",
        homework: "ENGLISH: Finish the worksheet",
        attachment: null,
      },
    ],
    { skipAi: true }
  );

  assert.equal(refreshed.length, 3);
  const refreshedMath = refreshed.find((item) =>
    (item.homework || "").includes("Complete exercise 4")
  );
  assert.ok(refreshedMath);
  assert.equal(refreshedMath.id, mathematics.id);
  assert.equal(refreshedMath.completed, true);
  assert.equal(refreshedMath.note, "Checked once");
  assert.equal(refreshedMath.attachment, "https://edusecure.in/files/exercise-4.pdf");

  const refreshedEnglish = refreshed.find((item) => item.subject === "English");
  assert.equal(refreshedEnglish.id, "legacy-homework-id");
  assert.equal(refreshedEnglish.completed, true);
  assert.equal(refreshedEnglish.note, "Keep this note");

  const duplicate = await db
    .select({ id: schema.homework.id })
    .from(schema.homework)
    .where(eq(schema.homework.id, "legacy-duplicate"))
    .get();
  assert.equal(duplicate, undefined);

  await homeworkCacheService.whenAiIdle(userId);
});

test("upsert returns the stored formatted body instead of the raw scrape", async () => {
  const userId = "formatted-return-user";
  const now = new Date().toISOString();
  await db.insert(schema.users).values({
    id: userId,
    studentId: "formatted-return-student",
    displayName: "Formatted Return",
    section: "10-A",
    role: "student",
    createdAt: now,
    updatedAt: now,
  }).run();

  const raw = "Prepare for Periodic Test- II.Revision of complete syllabus done.";
  const formatted =
    "Homework: Prepare for Periodic Test II\nClasswork: Revision of the complete syllabus";
  const payload = [
    { type: "Homework", date: "03 Sep 2026", homework: raw, attachment: null },
  ];

  const first = await homeworkCacheService.upsertHomework(userId, payload, { skipAi: true });
  assert.equal(first.length, 1);
  assert.equal(first[0].homework, raw);

  // Simulate the background AI pass having already rewritten the stored row.
  await db
    .update(schema.homework)
    .set({ content: formatted })
    .where(eq(schema.homework.id, first[0].id))
    .run();

  // Re-scraping the same raw entry must return (and keep) the formatted body —
  // returning the raw scrape here is what made the dashboard flip-flop.
  const second = await homeworkCacheService.upsertHomework(userId, payload, { skipAi: true });
  assert.equal(second.length, 1);
  assert.equal(second[0].id, first[0].id);
  assert.equal(second[0].homework, formatted);

  const stored = await db
    .select({ content: schema.homework.content })
    .from(schema.homework)
    .where(eq(schema.homework.id, first[0].id))
    .get();
  assert.equal(stored.content, formatted);

  await homeworkCacheService.whenAiIdle(userId);
});

test("handles concurrent simultaneous upserts without UNIQUE constraint errors", async () => {
  const userId = "concurrent-user";
  const now = new Date().toISOString();
  await db.insert(schema.users).values({
    id: userId,
    studentId: "concurrent-student",
    displayName: "Concurrent Tester",
    section: "10-A",
    role: "student",
    createdAt: now,
    updatedAt: now,
  }).run();

  const payload = [
    {
      type: "Homework",
      date: "21 Sep 2026",
      homework: "MATHEMATICS: Practice quadratic equations",
      attachment: null,
    },
    {
      type: "Homework",
      date: "21 Sep 2026",
      homework: "CHEMISTRY: Balance chemical equations",
      attachment: null,
    },
    // Intra-batch duplicate item
    {
      type: "Homework",
      date: "21 Sep 2026",
      homework: "MATHEMATICS: Practice quadratic equations https://tiny.edusecure.in/dup123",
      attachment: "https://school.edu/math.pdf",
    },
  ];

  const [res1, res2, res3] = await Promise.all([
    homeworkCacheService.upsertHomework(userId, payload, { skipAi: true }),
    homeworkCacheService.upsertHomework(userId, payload, { skipAi: true }),
    homeworkCacheService.upsertHomework(userId, payload, { skipAi: true }),
  ]);

  assert.equal(res1.length, 3);
  assert.equal(res2.length, 3);
  assert.equal(res3.length, 3);

  // Background AI passes must not still be holding the connection open when
  // the suite tears the temp SQLite file down.
  await homeworkCacheService.whenAiIdle(userId);
});
