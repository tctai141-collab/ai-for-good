import type { Database } from "bun:sqlite";

export function initSchema(db: Database) {
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA foreign_keys=ON");

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('founder', 'organizer'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL REFERENCES users(email),
      title TEXT NOT NULL,
      theme TEXT NOT NULL DEFAULT '—',
      state TEXT NOT NULL DEFAULT 'thinking',
      last_at TEXT NOT NULL DEFAULT '',
      personality TEXT DEFAULT 'none',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL REFERENCES users(email),
      thread_id TEXT REFERENCES threads(id),
      summary TEXT NOT NULL,
      door TEXT NOT NULL CHECK(door IN ('reversible', 'one-way')),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
      theme TEXT NOT NULL DEFAULT '—',
      outcome TEXT,
      at TEXT NOT NULL DEFAULT 'today',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS checkins (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL REFERENCES users(email),
      ref_decision_id TEXT REFERENCES decisions(id),
      theme TEXT,
      prompt TEXT NOT NULL,
      mood INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS visits (
      user_email TEXT PRIMARY KEY REFERENCES users(email),
      count INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS working_genius (
      user_email TEXT PRIMARY KEY REFERENCES users(email),
      primary_type TEXT NOT NULL,
      counts_json TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_threads_user ON threads(user_email, updated_at DESC);
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_decisions_user ON decisions(user_email, status);
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_checkins_user ON checkins(user_email);
  `);
}
