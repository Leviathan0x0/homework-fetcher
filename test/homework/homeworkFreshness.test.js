const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { eq } = require("drizzle-orm");

const databasePath = path.join(
  os.tmpdir(),
  `homework-freshness-${process.pid}-${Date.now()}.sqlite`
);
delete process.env.TURSO_DATABASE_URL;
delete process.env.LIBSQL_URL;
process.env.SQLITE_DB_PATH = databasePath;
process.env.TYPESAFE_API_KEY = process.env.TYPESAFE_API_KEY || "apikey_test_key";
process.env.AI_STUDIO_API_KEY = "test-key";

const { db, ready, schema, sqlite } = require("../../server/db/client");
const homeworkCacheService = require("../../server/homework/homeworkCacheService");
const { hasTodayEntry } = require("../../server/homework/homeworkDateUtils");

const USER_ID = "freshness-user";

test.before(async () => {
  await ready;
});

test.after(async () => {
  await homeworkCacheService.whenAiIdle(USER_ID);
  try {
    sqlite?.close();
  } catch {}
  for (const suffix of ["", "-shm", "-wal"]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});

/** A provider that resolves every classification, so the AI pass always writes. */
function stubProvider(t) {
  const previousFetch = global.fetch;
  global.fetch = async (url) => {
    if (typeof url === "string" && url.includes("generativelanguage.googleapis.com")) {
      return {
        ok: true,
        async json() {
          return {
            candidates: [
              { content: { parts: [{ text: JSON.stringify({ homework: "Rewritten", classwork: null }) }] } },
            ],
          };
        },
      };
    }
    // Always report the entry as unformatted so the pass always rewrites the
    // body, and always pick a different subject. Both guarantee a real write
    // rather than a silent no-op, without depending on regex-vs-AI agreement.
    return {
      ok: true,
      async json() {
        return {
          model: "jev-1.13.0",
          answers: {
            subject: { type: "choice", choice: "Geography" },
            well_formatted: { type: "noul", noul: 0.2 },
          },
        };
      },
    };
  };
  t.after(() => {
    global.fetch = previousFetch;
  });
}

test("the AI enrichment pass must not reset the portal scrape clock", async (t) => {
  stubProvider(t);

  const now = new Date().toISOString();
  await db.insert(schema.users).values({
    id: USER_ID,
    studentId: "freshness-student",
    displayName: "Freshness",
    section: "10-A",
    role: "student",
    createdAt: now,
    updatedAt: now,
  }).run();

  await homeworkCacheService.upsertHomework(
    USER_ID,
    [
      {
        type: "Homework",
        date: "Oct 08, 2026",
        homework: "Chateau de Braye history notes",
        attachment: null,
      },
    ],
    { skipAi: true }
  );

  // Pretend the last real portal scrape was 3 hours ago.
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  await db
    .update(schema.homework)
    .set({ updatedAt: threeHoursAgo })
    .where(eq(schema.homework.userId, USER_ID))
    .run();

  const before = await homeworkCacheService.getCachedHomework(USER_ID);
  assert.equal(hasTodayEntry(before), false, "fixture must have no entry dated today");
  assert.equal(await homeworkCacheService.isCacheStale(USER_ID), true);
  assert.equal(await homeworkCacheService.isCacheStale(USER_ID, 2), true);

  // The background pass that runs on every load-in, with no portal contact.
  const result = await homeworkCacheService.reclassifyRecentHomework(USER_ID, {
    force: true,
    section: "10-A",
  });
  assert.ok(result.updated > 0, "the AI pass must have rewritten the row");

  const after = await homeworkCacheService.getCachedHomework(USER_ID);
  assert.notEqual(after[0].homework, before[0].homework, "content must have changed");

  // isCacheStale answers "should we re-scrape the portal?". Only a scrape may
  // advance that answer; an AI rewrite must leave it alone.
  assert.equal(
    await homeworkCacheService.isCacheStale(USER_ID),
    true,
    "the AI pass reset the scrape clock, so a 3h-old cache answered 'fresh'"
  );
  assert.equal(
    await homeworkCacheService.isCacheStale(USER_ID, 2),
    true,
    "the AI pass suppressed the no-today recheck floor"
  );
});
