const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { eq } = require("drizzle-orm");

const databasePath = path.join(
  os.tmpdir(),
  `homework-reclassify-${process.pid}-${Date.now()}.sqlite`
);
delete process.env.TURSO_DATABASE_URL;
delete process.env.LIBSQL_URL;
process.env.SQLITE_DB_PATH = databasePath;
process.env.AI_STUDIO_API_KEY = "test-key";
process.env.TYPESAFE_API_KEY = process.env.TYPESAFE_API_KEY || "apikey_test_key";

const { db, ready, schema, sqlite } = require("../../server/db/client");
const homeworkCacheService = require("../../server/homework/homeworkCacheService");

test.before(async () => {
  await ready;
});

test.after(async () => {
  // Let any background AI pass finish before closing the temp database.
  await homeworkCacheService.whenAiIdle("reclassify-user-1");
  try {
    sqlite?.close();
  } catch {}
  for (const suffix of ["", "-shm", "-wal"]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});

test("reclassifyRecentHomework processes the last 5 homework entries no matter their date", async (t) => {
  const previousFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (typeof url === "string" && url.includes("generativelanguage.googleapis.com")) {
      return {
        ok: true,
        async json() {
          return {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        homework: "Practice worksheet completed",
                        classwork: null,
                      }),
                    },
                  ],
                },
              },
            ],
          };
        },
      };
    }
    const body = JSON.parse(options.body);
    const content = body.state;
    let choice = "School Diary";
    if (content.includes("quadratic")) {
      choice = "Mathematics";
    } else if (content.includes("parliamentary")) {
      choice = body.questions.subject.criteria["Political Science"] !== undefined
        ? "Political Science"
        : "Civics";
    }
    // One entry is flagged unformatted so the AI Studio rewrite path runs too.
    const wellFormattedNoul = content.includes("word problems") ? 0.1 : 0.95;
    return {
      ok: true,
      async json() {
        return {
          model: "jev-1.13.0",
          answers: {
            subject: {
              type: "choice",
              choice,
            },
            well_formatted: {
              type: "noul",
              noul: wellFormattedNoul,
            },
          },
        };
      },
    };
  };

  t.after(() => {
    global.fetch = previousFetch;
  });

  const userId = "reclassify-user-1";
  const now = new Date().toISOString();

  await db.insert(schema.users).values({
    id: userId,
    studentId: "reclassify-student-1",
    displayName: "Reclassify Tester",
    section: "10-A",
    role: "student",
    createdAt: now,
    updatedAt: now,
  }).run();

  // 7 cached homework items, all older than a week except the last two.
  // The last-5 window is date-agnostic: it must pick the 5 newest entries
  // and leave the 2 oldest untouched, regardless of the calendar.
  const fixtures = [
    { id: "hw-a", date: "10 Jul 2026", content: "Old parliamentary archive reading" },
    { id: "hw-b", date: "01 Aug 2026", content: "quadratic graphs homework" },
    { id: "hw-c", date: "15 Aug 2026", content: "Chapter 5 quadratic expressions" },
    { id: "hw-d", date: "20 Aug 2026", content: "Algebra quadratic formula practice" },
    { id: "hw-e", date: "01 Sep 2026", content: "quadratic word problems worksheet" },
    { id: "hw-f", date: "yesterday", content: "Read parliamentary democracy notes" },
    { id: "hw-g", date: "today", content: "Solve quadratic equations on page 42" },
  ];

  for (const fixture of fixtures) {
    await db.insert(schema.homework).values({
      id: fixture.id,
      userId,
      sourceIdentifier: "edusecure",
      date: fixture.date,
      subject: "School Diary",
      content: fixture.content,
      type: "Homework",
      createdAt: now,
      updatedAt: now,
    }).run();
  }

  // First run: newest 5 (g, f, e, d, c) get classified regardless of date
  const result = await homeworkCacheService.reclassifyRecentHomework(userId, {
    section: "10-A",
    force: true,
  });

  assert.equal(result.count, 5);
  assert.equal(result.updated, 5);

  const rows = await db
    .select({ id: schema.homework.id, subject: schema.homework.subject })
    .from(schema.homework)
    .where(eq(schema.homework.userId, userId))
    .all();

  const map = new Map(rows.map((r) => [r.id, r.subject]));
  assert.equal(map.get("hw-g"), "Mathematics");
  assert.equal(map.get("hw-f"), "Political Science");
  assert.equal(map.get("hw-e"), "Mathematics");
  assert.equal(map.get("hw-d"), "Mathematics");
  assert.equal(map.get("hw-c"), "Mathematics");
  // 6th and 7th newest fall outside the window even though they are old
  assert.equal(map.get("hw-b"), "School Diary");
  assert.equal(map.get("hw-a"), "School Diary");

  // Second run without force should be throttled
  const throttledResult = await homeworkCacheService.reclassifyRecentHomework(userId, {
    section: "10-A",
    force: false,
  });
  assert.equal(throttledResult.skipped, true);
});

test("a failed AI Studio format never downgrades an already-formatted entry", async (t) => {
  const previousFetch = global.fetch;
  t.after(() => {
    global.fetch = previousFetch;
  });

  global.fetch = async (url) => {
    // AI Studio is down / rate-limiting: formatter must fail open to passthrough
    if (typeof url === "string" && url.includes("generativelanguage.googleapis.com")) {
      return {
        ok: false,
        status: 429,
        async text() {
          return "rate limited";
        },
      };
    }
    return {
      ok: true,
      async json() {
        return {
          model: "jev-1.13.0",
          answers: {
            subject: { type: "choice", choice: "School Diary" },
            // Force a format attempt on the already-formatted text
            well_formatted: { type: "noul", noul: 0.1 },
          },
        };
      },
    };
  };

  const userId = "reclassify-user-2";
  const now = new Date().toISOString();
  await db.insert(schema.users).values({
    id: userId,
    studentId: "reclassify-student-2",
    displayName: "No Downgrade Tester",
    section: "10-A",
    role: "student",
    createdAt: now,
    updatedAt: now,
  }).run();

  const formattedBody =
    "Homework: Prepare for Periodic Test II\nClasswork: Revision of the complete syllabus";
  await db.insert(schema.homework).values({
    id: "hw-formatted-1",
    userId,
    sourceIdentifier: "edusecure",
    date: "today",
    subject: "School Diary",
    content: formattedBody,
    type: "Homework",
    createdAt: now,
    updatedAt: now,
  }).run();

  const result = await homeworkCacheService.reclassifyRecentHomework(userId, {
    section: "10-A",
    force: true,
    limit: 5,
  });

  // Format failed -> passthrough raw must not be written over the stored body
  assert.equal(result.updated, 0);

  const row = await db
    .select({ content: schema.homework.content })
    .from(schema.homework)
    .where(eq(schema.homework.id, "hw-formatted-1"))
    .get();
  assert.equal(row.content, formattedBody);
});
