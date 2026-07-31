const { eq } = require("drizzle-orm");
const { db, schema } = require("../db/client");

const DEFAULT_SETTINGS = {
  global_chat_enabled: "1",
  auto_mute_strikes_enabled: "1",
  section_requests_enabled: "1",
  classwork_approval_required: "0",
};

/**
 * Ensures every known toggle key exists in system_settings.
 * Safe to call on every boot.
 */
async function seedDefaultSettings() {
  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const existing = await db
      .select()
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, key))
      .get();

    if (!existing) {
      await db.insert(schema.systemSettings).values({
        key,
        value,
        updatedAt: now,
      });
    }
  }
}

/**
 * @param {string} key
 * @param {string} [fallback]
 * @returns {Promise<string>}
 */
async function getSetting(key, fallback = "1") {
  const row = await db
    .select()
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, key))
    .get();

  if (!row) {
    return DEFAULT_SETTINGS[key] ?? fallback;
  }
  return row.value;
}

/**
 * @param {string} key
 * @returns {Promise<boolean>}
 */
async function isSettingEnabled(key) {
  const value = await getSetting(key, DEFAULT_SETTINGS[key] ?? "1");
  return value !== "0";
}

module.exports = {
  DEFAULT_SETTINGS,
  seedDefaultSettings,
  getSetting,
  isSettingEnabled,
};
