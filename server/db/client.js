const path = require("path");
const os = require("os");
const fs = require("fs");
const schema = require("./schema");
const { createLibsqlClient } = require("./libsqlHttp");
const { measureRequestTiming } = require("../performance/requestTiming");

const isServerless =
  !!process.env.VERCEL ||
  !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
  !!process.env.LAMBDA_TASK_ROOT ||
  !!process.env.NOW_BUILDER;

const rawDatabaseUrl = (process.env.DATABASE_URL || "").trim();
const isRemoteUrl = (value) => /^(libsql|wss?|https?):\/\//i.test(value);

// A hosted libSQL/Turso database is the only way to keep data when the API runs
// on a serverless platform: every instance talks to the same database, so
// accounts, conversations and messages survive redeploys and are visible to
// every participant.
const remoteUrl = (process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL || (isRemoteUrl(rawDatabaseUrl) ? rawDatabaseUrl : "")).trim();
const remoteAuthToken = (process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || "").trim();

const isRemote = !!remoteUrl;

// The migration pipelines carry ~90 statements, so they need a longer budget
// than the per-request default used for ordinary queries.
const SCHEMA_BATCH_TIMEOUT_MS = 10_000;

const defaultDbPath = isServerless
  ? path.join(os.tmpdir(), "homework-fetcher.db")
  : path.join(__dirname, "../../sqlite.db");
const dbPath = process.env.SQLITE_DB_PATH || (isRemoteUrl(rawDatabaseUrl) ? "" : rawDatabaseUrl) || defaultDbPath;

let db;
let sqlite = null;
let remoteClient = null;
let startupError = null;

if (isRemote) {
  const { drizzle } = require("drizzle-orm/sqlite-proxy");
  remoteClient = createLibsqlClient(remoteUrl, remoteAuthToken);

  db = drizzle(
    async (sql, params, method) => {
      const result = await measureRequestTiming("database", () =>
        remoteClient.execute(sql, params)
      );
      if (method === "get") return { rows: result.rows[0] };
      if (method === "run") return { rows: [] };
      return { rows: result.rows };
    },
    async (queries) => {
      const results = await measureRequestTiming("database_batch", () =>
        remoteClient.executeBatch(
          queries.map((q) => ({ sql: q.sql, args: q.params }))
        )
      );
      return results.map((result, index) => {
        const method = queries[index].method;
        if (method === "get") return { rows: result.rows[0] };
        if (method === "run") return { rows: [] };
        return { rows: result.rows };
      });
    },
    { schema }
  );
} else {
  let Database;
  let drizzle;
  try {
    Database = require("better-sqlite3");
    ({ drizzle } = require("drizzle-orm/better-sqlite3"));
  } catch (err) {
    // The native SQLite binding is unavailable (common on serverless runtimes).
    // Failing here would take down every endpoint, so record the problem and
    // let requests answer with an actionable message instead.
    startupError = new Error(
      "No database available: the local SQLite driver could not be loaded " +
        `(${err.message}). Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to use a hosted database.`
    );
  }

  const dbDir = path.dirname(dbPath);
  try {
    if (dbDir && !fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  } catch (err) {
    console.error(`Could not create database directory ${dbDir}: ${err.message}`);
  }

  if (isServerless) {
    console.warn(
      "[db] No hosted database configured (TURSO_DATABASE_URL). On serverless hosts such as " +
        "Vercel the SQLite file lives in a temporary directory, so accounts, conversations and " +
        "messages are lost on every redeploy and are not shared between instances. See DEPLOYMENT.md."
    );
  }

  if (Database) {
    try {
      sqlite = openLocalDatabase(dbPath, Database);
      db = drizzle(sqlite, { schema });
    } catch (err) {
      startupError = new Error(`No database available: ${err.message}`);
    }
  }
}

/**
 * Opens a local SQLite file, falling back to the OS temp directory and finally
 * to an in-memory database when the location is not writable.
 */
function openLocalDatabase(preferredPath, Database) {
  const candidates = [preferredPath, path.join(os.tmpdir(), "homework-fetcher.db"), ":memory:"];
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const instance = new Database(candidate);
      instance.pragma("foreign_keys = ON");
      if (candidate !== ":memory:") {
        // Write-ahead logging lets readers continue while a write is in flight,
        // which matters as soon as several students use the app at once.
        instance.pragma("journal_mode = WAL");
        instance.pragma("busy_timeout = 5000");
      }
      return instance;
    } catch (err) {
      lastError = err;
      console.error(`Unable to open SQLite database at ${candidate}: ${err.message}`);
    }
  }

  throw lastError;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL UNIQUE,
      display_name TEXT,
      section TEXT NOT NULL DEFAULT 'Section 10-A',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_student_id ON users(student_id);

    CREATE TABLE IF NOT EXISTS profile_pictures (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS edusecure_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      encrypted_session_data TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_edusecure_user_id ON edusecure_sessions(user_id);

    CREATE TABLE IF NOT EXISTS app_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_app_sessions_user_id ON app_sessions(user_id);

    CREATE TABLE IF NOT EXISTS homework (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_identifier TEXT NOT NULL DEFAULT 'edusecure',
      date TEXT NOT NULL,
      subject TEXT NOT NULL,
      content TEXT NOT NULL,
      attachment_url TEXT,
      type TEXT NOT NULL DEFAULT 'Homework',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_homework_user_id ON homework(user_id);
    CREATE INDEX IF NOT EXISTS idx_homework_user_date ON homework(user_id, date);

    CREATE TABLE IF NOT EXISTS homework_user_state (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      homework_id TEXT NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
      completed INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS unique_user_homework_state ON homework_user_state(user_id, homework_id);
    CREATE INDEX IF NOT EXISTS idx_user_state_user_id ON homework_user_state(user_id);

    CREATE TABLE IF NOT EXISTS classwork_uploads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL,
      section TEXT NOT NULL,
      subject TEXT NOT NULL,
      title TEXT,
      date TEXT NOT NULL,
      file_url TEXT NOT NULL,
      file_path TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_classwork_section ON classwork_uploads(section);
    CREATE INDEX IF NOT EXISTS idx_classwork_section_date ON classwork_uploads(section, date);
    CREATE INDEX IF NOT EXISTS idx_classwork_user_id ON classwork_uploads(user_id);

    CREATE TABLE IF NOT EXISTS section_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL,
      section TEXT NOT NULL,
      category TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_requests_section_created ON section_requests(section, created_at);
    CREATE INDEX IF NOT EXISTS idx_requests_user_id ON section_requests(user_id);

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      link TEXT,
      reference_id TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'dm',
      section TEXT,
      last_message_preview TEXT,
      last_message_at TEXT,
      pinned_homework_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_participants (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_read_at TEXT,
      muted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_cp_conv_user ON conversation_participants(conversation_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_cp_user_id ON conversation_participants(user_id);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id),
      reply_to_id TEXT REFERENCES messages(id),
      content TEXT NOT NULL DEFAULT '',
      attachment_url TEXT,
      original_filename TEXT,
      mime_type TEXT,
      file_path TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS message_attachments (
      message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS classwork_attachments (
      classwork_id TEXT PRIMARY KEY REFERENCES classwork_uploads(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS message_read_receipts (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      read_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_mrr_message_user ON message_read_receipts(message_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_mrr_message_id ON message_read_receipts(message_id);

    CREATE TABLE IF NOT EXISTS monitoring_notice_tokens (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      participant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      valid_after INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_monitoring_notice_expiry ON monitoring_notice_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_monitoring_notice_user ON monitoring_notice_tokens(user_id);

    CREATE TABLE IF NOT EXISTS moderation_strikes (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_flag_log (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL,
      section TEXT,
      conversation_id TEXT,
      reason TEXT NOT NULL,
      detail TEXT,
      source TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_admin_flag_created ON admin_flag_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_flag_user ON admin_flag_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_admin_flag_type ON admin_flag_log(type);

    CREATE TABLE IF NOT EXISTS school_calendar_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_id TEXT,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'Event',
      date TEXT NOT NULL,
      date_raw TEXT,
      month_label TEXT,
      url TEXT,
      selected INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS broadcast_alerts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',
      target_section TEXT NOT NULL DEFAULT 'All',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_broadcast_active ON broadcast_alerts(active);

    CREATE TABLE IF NOT EXISTS teacher_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      subjects TEXT NOT NULL DEFAULT '[]',
      assigned_sections TEXT NOT NULL DEFAULT '[]',
      class_teacher_sections TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teacher_assignments (
      id TEXT PRIMARY KEY,
      teacher_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      attachment_url TEXT,
      due_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher ON teacher_assignments(teacher_user_id);
    CREATE INDEX IF NOT EXISTS idx_teacher_assignments_due ON teacher_assignments(due_date);

    CREATE TABLE IF NOT EXISTS teacher_assignment_targets (
      id TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL REFERENCES teacher_assignments(id) ON DELETE CASCADE,
      section TEXT NOT NULL,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'assigned',
      submitted_at TEXT,
      submission_text TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_target_assignment_student ON teacher_assignment_targets(assignment_id, student_id);
    CREATE INDEX IF NOT EXISTS idx_teacher_target_section ON teacher_assignment_targets(section);
    CREATE INDEX IF NOT EXISTS idx_teacher_target_student ON teacher_assignment_targets(student_id);

    CREATE TABLE IF NOT EXISTS teacher_assignment_attachments (
      id TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL REFERENCES teacher_assignments(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_teacher_attachment_assignment ON teacher_assignment_attachments(assignment_id);

    CREATE TABLE IF NOT EXISTS teacher_student_notes (
      id TEXT PRIMARY KEY,
      teacher_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_teacher_note_teacher_student ON teacher_student_notes(teacher_user_id, student_id);
    CREATE INDEX IF NOT EXISTS idx_teacher_note_student ON teacher_student_notes(student_id);

    CREATE TABLE IF NOT EXISTS teacher_grades (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL UNIQUE REFERENCES teacher_assignment_targets(id) ON DELETE CASCADE,
      grade TEXT,
      feedback TEXT,
      graded_by TEXT NOT NULL REFERENCES users(id),
      graded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attendance_sessions (
      id TEXT PRIMARY KEY,
      teacher_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      section TEXT NOT NULL,
      date TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Daily attendance',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attendance_session_teacher ON attendance_sessions(teacher_user_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_session_section_date ON attendance_sessions(section, date);

    CREATE TABLE IF NOT EXISTS attendance_records (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'present',
      note TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_record_session_student ON attendance_records(session_id, student_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_record_student ON attendance_records(student_id);

    CREATE TABLE IF NOT EXISTS teacher_duties (
      id TEXT PRIMARY KEY,
      assigned_by TEXT NOT NULL REFERENCES users(id),
      assignee_id TEXT REFERENCES users(id),
      section TEXT,
      title TEXT NOT NULL,
      description TEXT,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_teacher_duties_assignee ON teacher_duties(assignee_id);
    CREATE INDEX IF NOT EXISTS idx_teacher_duties_section ON teacher_duties(section);

    CREATE TABLE IF NOT EXISTS teacher_announcements (
      id TEXT PRIMARY KEY,
      teacher_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      section TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_teacher_announcement_section ON teacher_announcements(section);
    CREATE INDEX IF NOT EXISTS idx_teacher_announcement_teacher ON teacher_announcements(teacher_user_id);

    CREATE TABLE IF NOT EXISTS leave_requests (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      section TEXT NOT NULL,
      from_date TEXT NOT NULL,
      to_date TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by TEXT REFERENCES users(id),
      reviewed_at TEXT,
      reviewer_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_leave_student ON leave_requests(student_id);
    CREATE INDEX IF NOT EXISTS idx_leave_section_status ON leave_requests(section, status);
    CREATE INDEX IF NOT EXISTS idx_leave_dates ON leave_requests(from_date, to_date);
`;

/** Splits the schema script into individual statements. */
function schemaStatements() {
  return SCHEMA_SQL.split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/**
 * Columns added after the first release, checked on startup so databases
 * created by older versions keep working.
 */
const ADDED_COLUMNS = [
  ["users", "display_name", "TEXT"],
  ["users", "section", "TEXT NOT NULL DEFAULT 'Section 10-A'"],
  ["users", "is_muted", "INTEGER NOT NULL DEFAULT 0"],
  ["users", "muted_reason", "TEXT"],
  ["users", "muted_at", "TEXT"],
  ["users", "role", "TEXT NOT NULL DEFAULT 'student'"],
  ["admin_flag_log", "status", "TEXT NOT NULL DEFAULT 'pending'"],
  ["messages", "attachment_url", "TEXT"],
  ["messages", "original_filename", "TEXT"],
  ["messages", "mime_type", "TEXT"],
  ["messages", "file_path", "TEXT"],
  ["messages", "reply_to_id", "TEXT"],
  ["conversations", "type", "TEXT NOT NULL DEFAULT 'dm'"],
  ["conversations", "section", "TEXT"],
  ["conversations", "pinned_homework_id", "TEXT"],
  ["conversation_participants", "muted", "INTEGER NOT NULL DEFAULT 0"],
  ["classwork_uploads", "approval_status", "TEXT NOT NULL DEFAULT 'approved'"],
];

/** Feature toggles seeded without importing settingsService (avoids circular require). */
const DEFAULT_SETTINGS = [
  ["global_chat_enabled", "1"],
  ["auto_mute_strikes_enabled", "1"],
  ["section_requests_enabled", "1"],
  ["classwork_approval_required", "0"],
];

/**
 * Statements that finish the migration once the base schema exists.
 * Every one of them is safe to re-run, so they are sent as a single
 * best-effort batch instead of being awaited one at a time.
 */
function postSchemaStatements() {
  const stamped = new Date().toISOString();
  return [
    // Clear the fake default section. Real EduSecure values look like "9-C" / "10-A",
    // never "Section 10-A". Leaving that sentinel made every provisional chat look wrong.
    { sql: `UPDATE users SET section = '' WHERE lower(trim(section)) = 'section 10-a'` },
    { sql: "CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_id)" },
    ...DEFAULT_SETTINGS.map(([key, value]) => ({
      sql: "INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)",
      args: [key, value, stamped],
    })),
  ];
}

/**
 * Ensures all required tables, indices and columns exist.
 * Safe to call on startup: it never drops or overwrites existing data.
 *
 * A hosted libSQL database charges a full HTTPS round trip per statement. Run
 * one statement at a time and this migration alone costs ~100 sequential round
 * trips on every serverless cold start, which is what put a multi-second floor
 * under every single API call. The remote path therefore pipelines the whole
 * migration into two round trips: one that creates the schema and reads the
 * current columns, and one that applies whatever is still missing.
 */
async function initDb() {
  if (startupError) throw startupError;

  if (!isRemote) {
    sqlite.exec(SCHEMA_SQL);
    for (const [table, column, definition] of ADDED_COLUMNS) {
      await ensureColumn(table, column, definition);
    }
    for (const statement of postSchemaStatements()) {
      try {
        await runRaw(statement.sql, statement.args);
      } catch (err) {
        console.error("Migration statement failed:", err.message);
      }
    }
    return;
  }

  const migratedTables = Array.from(new Set(ADDED_COLUMNS.map(([table]) => table)));

  const created = await remoteClient.executeBatch(
    [
      ...schemaStatements().map((sql) => ({ sql })),
      ...migratedTables.map((table) => ({
        sql: `SELECT name FROM pragma_table_info('${table}')`,
      })),
    ],
    { timeoutMs: SCHEMA_BATCH_TIMEOUT_MS }
  );

  const existingColumns = new Map();
  migratedTables.forEach((table, index) => {
    const result = created[created.length - migratedTables.length + index];
    existingColumns.set(table, new Set((result?.rows || []).map((row) => String(row[0]))));
  });

  const pending = ADDED_COLUMNS.filter(([table, column]) => {
    const columns = existingColumns.get(table);
    // An unknown table means the CREATE above did not report its columns; the
    // ALTER would fail anyway, so leave it alone rather than aborting startup.
    return columns && columns.size > 0 && !columns.has(column);
  }).map(([table, column, definition]) => ({
    sql: `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
  }));

  const postSchema = postSchemaStatements();

  const results = await remoteClient.executeBatch(
    [...pending, ...postSchema],
    { timeoutMs: SCHEMA_BATCH_TIMEOUT_MS, throwOnError: false }
  );

  results.forEach((result, index) => {
    if (!result?.error) return;
    const statement = [...pending, ...postSchema][index];
    console.error(`Migration statement failed (${statement?.sql}):`, result.error);
  });
}

/**
 * Adds a column to a table when it does not exist yet.
 * @param {string} table
 * @param {string} column
 * @param {string} definition SQL type/constraints used by ALTER TABLE
 */
async function ensureColumn(table, column, definition) {
  try {
    const existingColumns = await tableColumns(table);
    if (existingColumns.length === 0) return;
    if (existingColumns.includes(column)) return;
    await exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (err) {
    console.error(`Migration error (${table}.${column}):`, err.message);
  }
}

/** Returns the column names of a table (empty when the table is missing). */
async function tableColumns(table) {
  if (isRemote) {
    const result = await remoteClient.execute(`SELECT name FROM pragma_table_info('${table}')`);
    return result.rows.map((row) => row[0]);
  }
  return sqlite.pragma(`table_info(${table})`).map((column) => column.name);
}

/** Runs a raw statement, with optional bound parameters, against the configured database. */
async function runRaw(sql, args) {
  if (isRemote) {
    await remoteClient.execute(sql, args);
    return;
  }
  sqlite.prepare(sql).run(...(args || []));
}

/** Runs a raw statement against the configured database. */
async function exec(sql) {
  if (isRemote) {
    await remoteClient.execute(sql);
    return;
  }
  sqlite.exec(sql);
}

/**
 * Runs several drizzle statements in as few round trips as possible.
 *
 * A hosted libSQL database charges a full HTTPS round trip per statement, so a
 * loop of awaited writes turns a single logical operation into dozens of
 * sequential network hops. Batching sends them in one pipeline request; the
 * local driver runs in-process, where sequential execution is already free.
 *
 * @param {any[]} statements drizzle query builders (falsy entries are skipped)
 */
async function runBatch(statements) {
  const queries = (statements || []).filter(Boolean);
  if (queries.length === 0) return [];

  if (isRemote) {
    if (typeof db.batch === "function") {
      return db.batch(queries);
    }

    // sqlite-proxy normally exposes db.batch(), but keep the hosted fallback
    // pipelined as well. Falling through to the local loop here would turn one
    // logical write into one HTTPS request per statement if a Drizzle release
    // or test adapter omitted the batch helper.
    const compiled = queries.map((query) => {
      if (typeof query?.toSQL !== "function") {
        throw new TypeError("Remote batch statements must be Drizzle query builders.");
      }
      const statement = query.toSQL();
      return { sql: statement.sql, args: statement.params || [] };
    });
    return remoteClient.executeBatch(compiled);
  }

  const results = [];
  for (const query of queries) {
    results.push(await query);
  }
  return results;
}

// Schema initialization starts once per process. If a serverless cold start
// hits a transient hosted-database outage, a later request may retry instead
// of leaving that warm function instance permanently stuck on a rejected
// promise.
function startInitialization() {
  return initDb().catch((err) => {
    console.error("Database initialization failed:", err.message);
    throw err;
  });
}

let ready = startInitialization();
let recoveryPromise = null;
let lastInitializationFailureAt = 0;

ready.catch(() => {
  lastInitializationFailureAt = Date.now();
});

async function ensureDatabaseReady() {
  try {
    await ready;
  } catch (err) {
    // Let the current request fail promptly. A later request can retry after a
    // short cooldown, which prevents one request from doing two full rounds of
    // hosted-database retries and exceeding a serverless execution limit.
    if (Date.now() - lastInitializationFailureAt < 1_000) throw err;

    if (!recoveryPromise) {
      recoveryPromise = (async () => {
        ready = startInitialization();
        ready.catch(() => {
          lastInitializationFailureAt = Date.now();
        });
        await ready;
      })().finally(() => {
        recoveryPromise = null;
      });
    }
    await recoveryPromise;
  }
}

ready.catch(() => {});

/*
 * Kept as an exported promise for existing callers and tests. Request-time
 * code should use ensureDatabaseReady() so transient failures can recover.
 */
const initialReady = ready;

module.exports = {
  db,
  sqlite,
  isRemote,
  initDb,
  ready: initialReady,
  ensureDatabaseReady,
  runBatch,
  schema,
};
