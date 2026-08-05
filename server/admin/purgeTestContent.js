const { eq, and, inArray } = require("drizzle-orm");
const { db, schema } = require("../db/client");
const { testTeacherUser } = require("../teacher/teacherService");

/**
 * Titles people type while poking the UI — not real school content.
 * Kept tight so genuine homework about "unit test" / "class test" is left alone.
 */
const PLACEHOLDER_TITLE =
  /^(?:test|testing|feed\s*test|test\s*(?:assignment|feed|alert|notification|announce(?:ment)?)|asdf+|hello\s*world|sample|dummy|foo|bar)(?:[!.\s#-]*\d*)?$/i;

const PLACEHOLDER_NOTIFICATION =
  /^new assignment:\s*(?:test|testing|feed\s*test|sample|dummy)\b/i;

function isPlaceholderTestText(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return PLACEHOLDER_TITLE.test(text) || PLACEHOLDER_NOTIFICATION.test(text);
}

/**
 * Removes demo/test teacher assignments, matching notification feed rows, and
 * placeholder broadcast alerts / announcements left behind during portal trials.
 *
 * Safe to call on every cold start — it only deletes obvious placeholders and
 * content owned by the shared demo teacher account.
 */
async function purgeTestContent() {
  const summary = {
    assignments: 0,
    notifications: 0,
    alerts: 0,
    announcements: 0,
  };

  const demoTeacherId = testTeacherUser().id;
  let removedNotificationIds = new Set();

  const assignments = await db.select().from(schema.teacherAssignments).all();
  const assignmentIdsToRemove = assignments
    .filter(
      (row) =>
        row.teacherUserId === demoTeacherId ||
        isPlaceholderTestText(row.title) ||
        isPlaceholderTestText(row.content)
    )
    .map((row) => row.id);

  if (assignmentIdsToRemove.length) {
    // Cascades clear targets/attachments/submissions via FK.
    await db
      .delete(schema.teacherAssignments)
      .where(inArray(schema.teacherAssignments.id, assignmentIdsToRemove))
      .run();
    summary.assignments = assignmentIdsToRemove.length;

    const linked = await db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.type, "teacher_assignment"),
          inArray(schema.notifications.referenceId, assignmentIdsToRemove)
        )
      )
      .all();

    if (linked.length) {
      const ids = linked.map((row) => row.id);
      await db
        .delete(schema.notifications)
        .where(inArray(schema.notifications.id, ids))
        .run();
      ids.forEach((id) => removedNotificationIds.add(id));
    }
  }

  const notifications = await db.select().from(schema.notifications).all();
  const notificationIds = notifications
    .filter(
      (row) =>
        !removedNotificationIds.has(row.id) &&
        (isPlaceholderTestText(row.title) || isPlaceholderTestText(row.body))
    )
    .map((row) => row.id);

  if (notificationIds.length) {
    await db
      .delete(schema.notifications)
      .where(inArray(schema.notifications.id, notificationIds))
      .run();
    notificationIds.forEach((id) => removedNotificationIds.add(id));
  }
  summary.notifications = removedNotificationIds.size;

  const alerts = await db.select().from(schema.broadcastAlerts).all();
  const alertIds = alerts
    .filter(
      (row) =>
        isPlaceholderTestText(row.title) || isPlaceholderTestText(row.message)
    )
    .map((row) => row.id);

  if (alertIds.length) {
    await db
      .delete(schema.broadcastAlerts)
      .where(inArray(schema.broadcastAlerts.id, alertIds))
      .run();
    summary.alerts = alertIds.length;
  }

  const announcements = await db.select().from(schema.teacherAnnouncements).all();
  const announcementIds = announcements
    .filter(
      (row) =>
        row.teacherUserId === demoTeacherId ||
        isPlaceholderTestText(row.title) ||
        isPlaceholderTestText(row.content)
    )
    .map((row) => row.id);

  if (announcementIds.length) {
    await db
      .delete(schema.teacherAnnouncements)
      .where(inArray(schema.teacherAnnouncements.id, announcementIds))
      .run();
    summary.announcements = announcementIds.length;

    const linked = await db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.type, "teacher_announcement"),
          inArray(schema.notifications.referenceId, announcementIds)
        )
      )
      .all();

    if (linked.length) {
      const ids = linked.map((row) => row.id);
      await db
        .delete(schema.notifications)
        .where(inArray(schema.notifications.id, ids))
        .run();
      summary.notifications += ids.length;
    }
  }

  return summary;
}

module.exports = {
  purgeTestContent,
  isPlaceholderTestText,
};
