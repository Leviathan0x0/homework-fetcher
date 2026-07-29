const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("bulk homework upsert preserves state without creating duplicates", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "homework-cache-"));
  process.env.SQLITE_DB_PATH = path.join(tempDir, "test.db");

  const { db, ready, schema, sqlite } = require("../server/db/client");
  const homeworkCacheService = require("../server/homework/homeworkCacheService");
  await ready;

  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  await db
    .insert(schema.users)
    .values({
      id: userId,
      studentId: "student-1",
      displayName: "Student",
      section: "10-A",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const first = await homeworkCacheService.upsertHomework(userId, [
    {
      type: "Homework",
      date: "2026-07-29",
      homework: "Mathematics: exercise 5",
      attachment: null,
    },
    {
      type: "Homework",
      date: "2026-07-30",
      homework: "English: read chapter 2",
      attachment: null,
    },
  ]);
  assert.equal(first.length, 2);

  await db
    .insert(schema.homeworkUserState)
    .values({
      id: crypto.randomUUID(),
      userId,
      homeworkId: first[0].id,
      completed: 1,
      note: "done",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const second = await homeworkCacheService.upsertHomework(userId, [
    {
      type: "Homework",
      date: "2026-07-29",
      homework: "Mathematics: exercise 5",
      attachment: "https://example.test/work.pdf",
    },
    {
      type: "Homework",
      date: "2026-07-30",
      homework: "English: read chapter 2",
      attachment: null,
    },
  ]);

  assert.equal(second.length, 2);
  assert.equal(second.find((item) => item.id === first[0].id).completed, true);
  assert.equal(second.find((item) => item.id === first[0].id).note, "done");
  assert.equal(
    second.find((item) => item.id === first[0].id).attachment,
    "https://example.test/work.pdf",
  );
  assert.equal(await homeworkCacheService.isCacheStale(userId), false);

  const [, queuedUpdate] = await Promise.all([
    homeworkCacheService.upsertHomework(userId, [
      {
        type: "Homework",
        date: "2026-07-31",
        homework: "Science: lab notes",
        attachment: null,
      },
    ]),
    homeworkCacheService.upsertHomework(userId, [
      {
        type: "Homework",
        date: "2026-08-01",
        homework: "History: chapter 3",
        attachment: null,
      },
    ]),
  ]);
  assert.ok(
    queuedUpdate.some((item) => item.homework === "History: chapter 3"),
  );
  const queuedItems = await homeworkCacheService.getCachedHomework(userId);
  assert.ok(queuedItems.some((item) => item.homework === "Science: lab notes"));
  assert.ok(queuedItems.some((item) => item.homework === "History: chapter 3"));

  sqlite.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});
