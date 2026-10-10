const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 2;

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  const version = db.pragma('user_version', { simple: true });
  if (version < SCHEMA_VERSION) {
    // v1 stored local date/time strings; v2 stores UTC instants. Dev data only, so recreate.
    db.exec(`DROP TABLE IF EXISTS idempotency_keys; DROP TABLE IF EXISTS time_options; DROP TABLE IF EXISTS events;`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL            -- UTC ISO 8601
    );
    CREATE TABLE IF NOT EXISTS time_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      start_at TEXT NOT NULL,             -- UTC ISO 8601 (…Z)
      end_at TEXT,                        -- UTC ISO 8601 or NULL
      position INTEGER NOT NULL,
      UNIQUE (event_id, start_at, end_at)
    );
    CREATE INDEX IF NOT EXISTS idx_time_options_event ON time_options(event_id);
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
  `);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  return db;
}
module.exports = { openDb };
