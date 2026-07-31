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
 * Toggle values, cached briefly.
 *
 * Feature toggles are read on the hot path of sending a message or opening a
 * request, and they change once in a blue moon, so a per-request query is pure
 * latency. The window is short enough that an administrator flipping a switch
 * takes effect right away in practice.
 */
const SETTINGS_CACHE_TTL_MS = 15 * 1000;
const settingsCache = new Map();

/** Clears cached toggle values after an administrator changes one. */
function invalidateSettingsCache(key) {
  if (key) settingsCache.delete(key);
  else settingsCache.clear();
}

/**
 * @param {string} key
 * @param {string} [fallback]
 * @returns {Promise<string>}
 */
async function getSetting(key, fallback = "1") {
  const cached = settingsCache.get(key);
  if (cached && cached.cachedUntil > Date.now()) return cached.value;

  const row = await db
    .select()
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, key))
    .get();

  const value = row ? row.value : DEFAULT_SETTINGS[key] ?? fallback;
  settingsCache.set(key, { value, cachedUntil: Date.now() + SETTINGS_CACHE_TTL_MS });
  return value;
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
  invalidateSettingsCache,
};
