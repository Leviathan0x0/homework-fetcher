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

  const initial = await homeworkCacheService.upsertHomework(userId, [
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
  ]);
  assert.equal(initial.length, 2);

  const mathematics = initial.find((item) => item.subject === "Mathematics");
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

  const refreshed = await homeworkCacheService.upsertHomework(userId, [
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
  ]);

  assert.equal(refreshed.length, 3);
  const refreshedMath = refreshed.find((item) => item.subject === "Mathematics");
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
});
