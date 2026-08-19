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


/**
 * Runs a migration exactly once, tracked in PRAGMA user_version.
 *
 * The schema was previously created and patched idempotently on every boot with
 * no version recorded anywhere, so there was no way to tell which shape a given
 * database was in and no place to hang a change that cannot be expressed as
 * "create if not exists". Structural changes go here; additive columns can stay
 * with addColumn above.
 */
function migrate(db: Database, version: number, apply: () => void): void {
  const current = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (current >= version) return;
  apply();
  // Interpolated, but from a numeric literal the caller passes — PRAGMA does
  // not accept bound parameters.
  db.run(`PRAGMA user_version = ${Number(version)}`);
}

/**
 * Rebuilds a table with a new definition, preserving its rows.
 *
 * SQLite cannot alter a foreign key, so the only way to change one is the
 * documented copy-drop-rename dance. Foreign keys must be off for the duration
 * or the intermediate states trip constraints, and that cannot happen inside a
 * transaction — PRAGMA foreign_keys is a no-op within one — so it is toggled
 * around the whole thing.
 */
function rebuild(db: Database, table: string, createSql: string, columns: string[]): void {
  const existing = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (existing.length === 0) return;
  const present = new Set(existing.map((c) => c.name));
  const carried = columns.filter((c) => present.has(c));
  const list = carried.join(", ");

  db.run("PRAGMA foreign_keys=OFF");
  try {
    db.transaction(() => {
      db.run(createSql.replace(`CREATE TABLE ${table}`, `CREATE TABLE ${table}__new`));
      db.run(`INSERT INTO ${table}__new (${list}) SELECT ${list} FROM ${table}`);
      db.run(`DROP TABLE ${table}`);
      db.run(`ALTER TABLE ${table}__new RENAME TO ${table}`);
    })();
  } finally {
    db.run("PRAGMA foreign_keys=ON");
  }

  const violations = db.query("PRAGMA foreign_key_check").all() as unknown[];
  if (violations.length > 0) {
    throw new Error(`Rebuilding ${table} left ${violations.length} foreign key violation(s); refusing to continue.`);
  }
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

  // --- Migration 1: uniform ON DELETE policy ---------------------------------
  //
  // The five original tables referenced users(email) with ON DELETE NO ACTION
  // while the two added later cascaded. With foreign_keys=ON that meant
  // deleting any founder who had ever used the app threw a constraint error —
  // the app turned it into an empty 500 and the account survived with its
  // sessions already destroyed.
  //
  // deleteUser() removes the children explicitly now, so this is not load
  // bearing today. It exists so the next delete path somebody writes does not
  // rediscover the same wall. SQLite cannot ALTER a foreign key, so the tables
  // are rebuilt with the standard copy-drop-rename procedure.
  //
  // Policy: rows that belong to a person go when the person goes. Rows that
  // merely reference another record keep the record and drop the reference —
  // a decision outliving the conversation that prompted it is still useful.
  migrate(db, 1, () => {
    // The rebuilt threads table adds a CHECK on `state` that the old one
    // lacked, so anything already stored outside the three allowed values
    // would fail the copy. Normalise first rather than lose the row.
    db.run("UPDATE threads SET state = 'thinking' WHERE state NOT IN ('panic', 'thinking', 'venting')");

    rebuild(db, "threads", `
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
        title TEXT NOT NULL,
        theme TEXT NOT NULL DEFAULT '—',
        state TEXT NOT NULL DEFAULT 'thinking' CHECK(state IN ('panic', 'thinking', 'venting')),
        last_at TEXT NOT NULL DEFAULT '',
        personality TEXT DEFAULT 'none',
        shared_with_coach INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `, ["id", "user_email", "title", "theme", "state", "last_at", "personality", "shared_with_coach", "created_at", "updated_at"]);

    rebuild(db, "decisions", `
      CREATE TABLE decisions (
        id TEXT PRIMARY KEY,
        user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
        thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
        summary TEXT NOT NULL,
        door TEXT NOT NULL CHECK(door IN ('reversible', 'one-way')),
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
        theme TEXT NOT NULL DEFAULT '—',
        outcome TEXT,
        at TEXT NOT NULL DEFAULT 'today',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `, ["id", "user_email", "thread_id", "summary", "door", "status", "theme", "outcome", "at", "created_at", "updated_at"]);

    rebuild(db, "checkins", `
      CREATE TABLE checkins (
        id TEXT PRIMARY KEY,
        user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
        ref_decision_id TEXT REFERENCES decisions(id) ON DELETE SET NULL,
        theme TEXT,
        prompt TEXT NOT NULL,
        mood INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `, ["id", "user_email", "ref_decision_id", "theme", "prompt", "mood", "created_at"]);

    rebuild(db, "visits", `
      CREATE TABLE visits (
        user_email TEXT PRIMARY KEY REFERENCES users(email) ON DELETE CASCADE,
        count INTEGER NOT NULL DEFAULT 0
      )
    `, ["user_email", "count"]);

    rebuild(db, "working_genius", `
      CREATE TABLE working_genius (
        user_email TEXT PRIMARY KEY REFERENCES users(email) ON DELETE CASCADE,
        primary_type TEXT NOT NULL,
        counts_json TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `, ["user_email", "primary_type", "counts_json", "completed_at", "created_at", "updated_at"]);
  });

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

  // --- Deadlines and task tracking (Work Package 3) --------------------------
  //
  // Cohort-wide milestones set by organizers, plus a per-founder done flag.
  //
  // Two things here are deliberate reactions to the audit. Ids are generated
  // server-side with crypto.randomUUID(), never accepted from the client — the
  // cross-tenant write bug existed precisely because every id in this app was
  // client-chosen. And completions have no shared mutable row: each founder's
  // completion is its own row keyed by their own email, so there is nothing for
  // one founder to overwrite in another's.
  db.run(`
    CREATE TABLE IF NOT EXISTS deadlines (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      due_date TEXT NOT NULL,
      sprint_week INTEGER CHECK(sprint_week IS NULL OR (sprint_week BETWEEN 1 AND 15)),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
      created_by TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Presence of a row means done. No boolean to flip, no row to contend over.
  db.run(`
    CREATE TABLE IF NOT EXISTS deadline_completions (
      deadline_id TEXT NOT NULL REFERENCES deadlines(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      completed_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (deadline_id, user_email)
    )
  `);

  // The cohort's programme, one row per week.
  //
  // This used to be a TypeScript file, which meant a moved session needed a code
  // change and a deploy, and meant the previous cohort's content was still being
  // read to founders months later. Milestones and sessions are newline-separated
  // text rather than child tables: a week has a handful of each, they are always
  // edited together, and two more tables would buy nothing but CRUD.
  db.run(`
    CREATE TABLE IF NOT EXISTS programme_weeks (
      week INTEGER PRIMARY KEY CHECK(week BETWEEN 1 AND 15),
      phase TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      milestones TEXT NOT NULL DEFAULT '',
      sessions TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // What has already been said to whom, so a reminder is a reminder and not a
  // daily nag. One row per (deadline, founder, kind); the primary key is what
  // makes a second send impossible rather than merely unlikely.
  db.run(`
    CREATE TABLE IF NOT EXISTS deadline_reminders (
      deadline_id TEXT NOT NULL REFERENCES deadlines(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('due-soon', 'overdue')),
      sent_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (deadline_id, user_email, kind)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_deadlines_status_due ON deadlines(status, due_date);
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_deadline_completions_user ON deadline_completions(user_email);
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
