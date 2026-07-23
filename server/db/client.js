const path = require("path");
const Database = require("better-sqlite3");
const { drizzle } = require("drizzle-orm/better-sqlite3");
const schema = require("./schema");

const dbPath = process.env.SQLITE_DB_PATH || process.env.DATABASE_URL || path.join(__dirname, "../../sqlite.db");

// Initialize native SQLite database
const sqlite = new Database(dbPath);

// Enable foreign key constraints in SQLite
sqlite.pragma("foreign_keys = ON");

// Initialize Drizzle ORM client
const db = drizzle(sqlite, { schema });

/**
 * Ensures all required database tables and indices exist in SQLite.
 * Safe to call on application startup (does not overwrite or destroy existing data).
 */
function initDb() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL UNIQUE,
      section TEXT NOT NULL DEFAULT 'Section 10-A',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_student_id ON users(student_id);

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
      last_message_preview TEXT,
      last_message_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_participants (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_read_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_cp_conv_user ON conversation_participants(conversation_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_cp_user_id ON conversation_participants(user_id);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);
  `);

  // Migration helper: Ensure 'section' column exists if users table was created previously without it
  try {
    const tableInfo = sqlite.pragma("table_info(users)");
    const hasSection = tableInfo.some((col) => col.name === "section");
    if (!hasSection) {
      sqlite.exec("ALTER TABLE users ADD COLUMN section TEXT NOT NULL DEFAULT 'Section 10-A'");
    }
  } catch (err) {
    console.error("Migration error (section column):", err);
  }
}

// Automatically initialize schema on start
initDb();

module.exports = {
  db,
  sqlite,
  initDb,
  schema
};
