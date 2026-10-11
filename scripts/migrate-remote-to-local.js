#!/usr/bin/env node
/**
 * One-way copy: hosted libSQL/Turso -> local SQLite (SQLITE_DB_PATH).
 *
 * Used once during the Azure VPS migration to move production data out of
 * Turso, and safe to re-run: every insert is INSERT OR IGNORE by primary key,
 * so rows that already exist locally are never overwritten or duplicated.
 * The local schema is created/migrated first via server/db/client.js, so the
 * target always matches what the app expects.
 *
 * Usage (credentials come from the environment, never from files or argv):
 *   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... \
 *   SQLITE_DB_PATH=/var/lib/mmss64/mmss.db \
 *     node scripts/migrate-remote-to-local.js [--dry-run]
 *
 * --dry-run only reports remote row counts and the local target path.
 */

const path = require("path");

const dryRun = process.argv.includes("--dry-run");

const remoteUrl = (
  process.env.TURSO_DATABASE_URL ||
  process.env.LIBSQL_URL ||
  (/^(libsql|wss?|https?):\/\//i.test((process.env.DATABASE_URL || "").trim())
    ? process.env.DATABASE_URL
    : "")
).trim();
const remoteAuthToken = (process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || "").trim();

if (!remoteUrl) {
  console.error(
    "No remote database configured. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN."
  );
  process.exit(1);
}

if (!process.env.SQLITE_DB_PATH) {
  console.error(
    "SQLITE_DB_PATH is not set. Refusing to guess a target (the default would be the repo's dev sqlite.db)."
  );
  process.exit(1);
}

// The remote config must be captured (and then removed from the environment)
// BEFORE server/db/client.js loads: with TURSO_DATABASE_URL still set it would
// open the source database in remote mode and expose no local `sqlite`.
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.LIBSQL_URL;
delete process.env.LIBSQL_AUTH_TOKEN;
if (/^(libsql|wss?|https?):\/\//i.test((process.env.DATABASE_URL || "").trim())) {
  delete process.env.DATABASE_URL;
}

// Opens the local database at SQLITE_DB_PATH and runs the idempotent schema
// migrations before any data is copied.
const { ready, sqlite } = require("../server/db/client");
const { createLibsqlClient } = require("../server/db/libsqlHttp");

const remote = createLibsqlClient(remoteUrl, remoteAuthToken);

// Tables whose rows hold base64 attachments can be several MB each; page them
// in small chunks so a single pipeline response never gets huge. Everything
// else pages in bulk.
function pageSizeFor(columns) {
  return columns.includes("data") || columns.includes("attachment_url") ? 20 : 1000;
}

async function remoteTableNames() {
  const result = await remote.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  return result.rows.map((row) => String(row[0]));
}

async function remoteColumns(table) {
  const result = await remote.execute(
    `SELECT name FROM pragma_table_info('${table.replace(/'/g, "''")}')`
  );
  return result.rows.map((row) => String(row[0]));
}

async function remoteCount(table) {
  const result = await remote.execute(`SELECT COUNT(*) FROM "${table.replace(/"/g, '""')}"`);
  return Number(result.rows[0][0]);
}

async function main() {
  await ready;
  if (!sqlite) {
    throw new Error("Local SQLite driver unavailable (better-sqlite3 failed to load).");
  }

  const targetPath = sqlite.name;
  console.log(`Local target: ${path.resolve(targetPath)}`);

  // Classic bulk-load pattern: foreign keys are enforced at COMMIT, and rows
  // are copied table-by-table in alphabetical order (children before parents),
  // so enforcement would fail halfway. Integrity is proven afterwards with
  // PRAGMA foreign_key_check before anything serves traffic from this file.
  sqlite.exec("PRAGMA foreign_keys = OFF");

  const tables = await remoteTableNames();
  console.log(`Remote tables: ${tables.length}`);

  const totals = { inserted: 0, skipped: 0 };

  for (const table of tables) {
    const columns = await remoteColumns(table);
    if (columns.length === 0) continue;

    if (dryRun) {
      const count = await remoteCount(table);
      console.log(`  ${table}: ${count} rows (dry run)`);
      continue;
    }

    const quotedCols = columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    const insert = sqlite.prepare(
      `INSERT OR IGNORE INTO "${table.replace(/"/g, '""')}" (${quotedCols}) VALUES (${placeholders})`
    );

    const pageSize = pageSizeFor(columns);
    const selectCols = columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ");
    let cursor = null;
    let inserted = 0;
    let skipped = 0;

    // Page with a rowid cursor so ordering is stable across requests.
    sqlite.exec("BEGIN");
    try {
      while (true) {
        const where = cursor === null ? "" : `WHERE rowid > ${Number(cursor)} `;
        const page = await remote.execute(
          `SELECT rowid AS __rid, ${selectCols} FROM "${table.replace(/"/g, '""')}" ` +
            `${where}ORDER BY rowid LIMIT ${pageSize}`
        );
        if (page.rows.length === 0) break;

        for (const row of page.rows) {
          const values = row.slice(1); // drop __rid
          const info = insert.run(...values);
          if (info.changes > 0) inserted += 1;
          else skipped += 1;
        }
        cursor = page.rows[page.rows.length - 1][0];
        if (page.rows.length < pageSize) break;
      }
      sqlite.exec("COMMIT");
    } catch (err) {
      sqlite.exec("ROLLBACK");
      throw err;
    }

    totals.inserted += inserted;
    totals.skipped += skipped;
    console.log(`  ${table}: +${inserted} inserted, ${skipped} already present`);
  }

  if (!dryRun) {
    sqlite.exec("PRAGMA foreign_keys = ON");
    const violations = sqlite.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      console.error(`WARNING: ${violations.length} foreign-key violations after copy.`);
      process.exitCode = 1;
    }
    console.log(
      `Done. Inserted ${totals.inserted} rows, kept ${totals.skipped} existing rows.`
    );
  }

  sqlite.close();
}

main().catch((err) => {
  console.error(`Migration failed: ${err.message}`);
  process.exit(1);
});
