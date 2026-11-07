const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { eq } = require("drizzle-orm");

const databasePath = path.join(os.tmpdir(), `calendar-cache-${process.pid}-${Date.now()}.sqlite`);
delete process.env.TURSO_DATABASE_URL;
delete process.env.LIBSQL_URL;
process.env.SQLITE_DB_PATH = databasePath;

const { db, ready, schema, sqlite } = require("../../server/db/client");
const calendarCacheService = require("../../server/calendar/calendarCacheService");

const USER_ID = "calendar-user";

test.before(async () => {
  await ready;
  const now = new Date().toISOString();
  await db.insert(schema.users).values({
    id: USER_ID,
    studentId: "calendar1",
    displayName: "Calendar",
    section: "9-A",
    createdAt: now,
    updatedAt: now,
  }).run();
});

test.after(() => {
  try {
    sqlite?.close();
  } catch {}
  for (const suffix of ["", "-shm", "-wal"]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});

const EVENTS = [
  { date: "2026-11-14", title: "Children's Day", type: "Holiday" },
  { date: "2026-12-25", title: "Christmas", type: "Holiday" },
];

test("a refresh keeps selection, stamps untouched rows and drops removed ones", async () => {
  await calendarCacheService.upsertEvents(USER_ID, EVENTS);
  const [first] = await calendarCacheService.getCachedEvents(USER_ID);
  await calendarCacheService.setEventSelected(USER_ID, first.id, false);

  await new Promise((resolve) => setTimeout(resolve, 5));
  await calendarCacheService.upsertEvents(USER_ID, [
    EVENTS[0],
    { ...EVENTS[1], title: "Christmas Day" },
  ]);

  const events = await calendarCacheService.getCachedEvents(USER_ID);
  assert.deepEqual(events.map((event) => event.title), ["Children's Day", "Christmas Day"]);
  assert.equal(events[0].selected, false);
  assert.ok(events[0].updatedAt > first.updatedAt, "unchanged rows are still stamped as synced");
  assert.equal(await calendarCacheService.isCacheStale(USER_ID), false);
});

test("pinning an event does not make the cache look freshly synced", async () => {
  const [event] = await calendarCacheService.getCachedEvents(USER_ID);
  const stale = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  await db.update(schema.schoolCalendarEvents)
    .set({ updatedAt: stale })
    .where(eq(schema.schoolCalendarEvents.userId, USER_ID))
    .run();

  await calendarCacheService.setEventSelected(USER_ID, event.id, true);

  assert.equal(await calendarCacheService.isCacheStale(USER_ID), true);
  assert.equal((await calendarCacheService.getCachedEvent(USER_ID, event.id)).selected, true);
});

test("getCachedEvent is scoped to its owner", async () => {
  const [event] = await calendarCacheService.getCachedEvents(USER_ID);
  assert.equal(await calendarCacheService.getCachedEvent("someone-else", event.id), null);
});
