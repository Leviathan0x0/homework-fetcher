const crypto = require("crypto");
const { eq, and } = require("drizzle-orm");
const { db, schema } = require("../db/client");

const CACHE_MAX_AGE_MS = (parseInt(process.env.CALENDAR_CACHE_MAX_AGE_MINUTES || "60", 10) || 60) * 60 * 1000;

function eventRowId(userId, date, title) {
  return crypto
    .createHash("sha256")
    .update(`${userId}:${date}:${(title || "").trim().toLowerCase()}`)
    .digest("hex");
}

function mapRow(row) {
  return {
    id: row.id,
    sourceId: row.sourceId || null,
    title: row.title,
    type: row.type || "Event",
    date: row.date,
    dateRaw: row.dateRaw || row.date,
    monthLabel: row.monthLabel || null,
    url: row.url || null,
    selected: !!row.selected,
    updatedAt: row.updatedAt,
  };
}

async function getCachedEvents(userId) {
  if (!userId) return [];
  try {
    const rows = await db
      .select()
      .from(schema.schoolCalendarEvents)
      .where(eq(schema.schoolCalendarEvents.userId, userId))
      .all();
    return rows
      .map(mapRow)
      .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  } catch (err) {
    console.error("getCachedEvents:", err.message);
    return [];
  }
}

async function getCacheUpdatedAt(userId) {
  try {
    const row = await db
      .select({ updatedAt: schema.schoolCalendarEvents.updatedAt })
      .from(schema.schoolCalendarEvents)
      .where(eq(schema.schoolCalendarEvents.userId, userId))
      .all();
    if (!row.length) return null;
    return row.reduce((latest, r) => {
      if (!latest || (r.updatedAt && r.updatedAt > latest)) return r.updatedAt;
      return latest;
    }, null);
  } catch {
    return null;
  }
}

async function isCacheStale(userId) {
  const updatedAt = await getCacheUpdatedAt(userId);
  if (!updatedAt) return true;
  const age = Date.now() - new Date(updatedAt).getTime();
  return Number.isNaN(age) || age > CACHE_MAX_AGE_MS;
}

/**
 * Replaces cached calendar events for a user while preserving selected flags.
 */
async function upsertEvents(userId, events) {
  if (!userId || !Array.isArray(events)) return;

  const existing = await db
    .select()
    .from(schema.schoolCalendarEvents)
    .where(eq(schema.schoolCalendarEvents.userId, userId))
    .all();

  const selectedByKey = new Map();
  for (const row of existing) {
    selectedByKey.set(`${row.date}:${(row.title || "").toLowerCase()}`, !!row.selected);
  }

  const now = new Date().toISOString();
  const incomingIds = new Set();

  for (const event of events) {
    if (!event?.date || !event?.title) continue;
    const id = eventRowId(userId, event.date, event.title);
    incomingIds.add(id);
    const key = `${event.date}:${event.title.toLowerCase()}`;
    const selected = selectedByKey.has(key) ? (selectedByKey.get(key) ? 1 : 0) : 1;

    const values = {
      id,
      userId,
      sourceId: event.sourceId || null,
      title: event.title,
      type: event.type || "Event",
      date: event.date,
      dateRaw: event.dateRaw || event.date,
      monthLabel: event.monthLabel || null,
      url: event.url || null,
      selected,
      updatedAt: now,
    };

    const found = existing.find((r) => r.id === id);
    if (found) {
      await db
        .update(schema.schoolCalendarEvents)
        .set({
          sourceId: values.sourceId,
          title: values.title,
          type: values.type,
          date: values.date,
          dateRaw: values.dateRaw,
          monthLabel: values.monthLabel,
          url: values.url,
          updatedAt: now,
        })
        .where(eq(schema.schoolCalendarEvents.id, id))
        .run();
    } else {
      await db
        .insert(schema.schoolCalendarEvents)
        .values({ ...values, createdAt: now })
        .run();
    }
  }

  // Drop stale rows that EduSecure no longer returns (keep user-selected custom? none yet)
  for (const row of existing) {
    if (!incomingIds.has(row.id)) {
      await db
        .delete(schema.schoolCalendarEvents)
        .where(eq(schema.schoolCalendarEvents.id, row.id))
        .run();
    }
  }
}

async function setEventSelected(userId, eventId, selected) {
  const result = await db
    .update(schema.schoolCalendarEvents)
    .set({
      selected: selected ? 1 : 0,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(schema.schoolCalendarEvents.id, eventId),
        eq(schema.schoolCalendarEvents.userId, userId)
      )
    )
    .run();
  return result;
}

module.exports = {
  getCachedEvents,
  isCacheStale,
  upsertEvents,
  setEventSelected,
};
