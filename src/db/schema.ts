import type { Database } from "bun:sqlite";

/**
 * Adds a column only if it is missing, so schema upgrades are safe to re-run
 * on every boot. SQLite has no `ADD COLUMN IF NOT EXISTS`, and its ALTER TABLE
 * rejects non-constant defaults — hence `created_at` is filled in on insert
 * rather than defaulted here.
 */
function addColumn(db: Database, table: string, column: string, definition: string) {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

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

  // --- Authentication, added when the demo logins were replaced ---
  //
  // These run as ALTER/CREATE-IF-NOT-EXISTS rather than being folded into the
  // definitions above so that databases created before real accounts existed
  // upgrade in place instead of needing to be rebuilt.

  // A user with no password_hash has been invited but has not set one yet.
  addColumn(db, "users", "password_hash", "TEXT");
  addColumn(db, "users", "created_at", "TEXT");
  // Founders opt in per conversation; organizers can never read the rest.
  addColumn(db, "threads", "shared_with_coach", "INTEGER NOT NULL DEFAULT 0");

  // Server-side sessions. The cookie holds an opaque random token and nothing
  // else, so a client cannot forge a role the way it could with the previous
  // plain-JSON cookie. Deleting a row revokes access immediately.
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    )
  `);

  // Single-use links that let a founder set their own password. The operating
  // team never sees or handles the password itself.
  db.run(`
    CREATE TABLE IF NOT EXISTS invites (
      token TEXT PRIMARY KEY,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      used_at TEXT
    )
  `);

  // Every administrative mutation, attributable to the organizer who made it.
  //
  // An organizer can still trigger a password reset on any account, which is
  // inherent to admin-issued resets and cannot be closed without taking the
  // ability away. What can be closed is doing it invisibly: the link now goes
  // to the founder by email, and the attempt is recorded here either way.
  //
  // actor_email is NOT a foreign key on purpose — the record has to outlive the
  // account that made it, including when that organizer is later removed.
  db.run(`
    CREATE TABLE IF NOT EXISTS admin_audit (
      id TEXT PRIMARY KEY,
      actor_email TEXT NOT NULL,
      action TEXT NOT NULL,
      subject_email TEXT,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_threads_user ON threads(user_email, updated_at DESC);
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_admin_audit_at ON admin_audit(created_at DESC);
  `);
  // The cohort dashboard sorts every founder check-in by time on each load.
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_checkins_created ON checkins(created_at);
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_email);
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_invites_user ON invites(user_email);
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
