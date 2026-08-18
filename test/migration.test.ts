import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSchema } from "../src/db/schema";

/**
 * Migration 1 — uniform ON DELETE policy.
 *
 * This rebuilds five tables holding every founder's data, so it gets tested
 * against a database in the *old* shape rather than only a fresh one. The
 * interesting case is an existing production database, not an empty file.
 */

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sprint-buddy-migration-"));
  path = join(dir, "old.db");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** The schema exactly as it was before this branch, data and all. */
function buildLegacyDatabase(): void {
  const db = new Database(path);
  db.run("PRAGMA journal_mode=WAL");
  db.run(`CREATE TABLE users (email TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('founder','organizer')), password_hash TEXT, created_at TEXT)`);
  db.run(`CREATE TABLE threads (id TEXT PRIMARY KEY, user_email TEXT NOT NULL REFERENCES users(email), title TEXT NOT NULL, theme TEXT NOT NULL DEFAULT '—', state TEXT NOT NULL DEFAULT 'thinking', last_at TEXT NOT NULL DEFAULT '', personality TEXT DEFAULT 'none', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), shared_with_coach INTEGER NOT NULL DEFAULT 0)`);
  db.run(`CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.run(`CREATE TABLE decisions (id TEXT PRIMARY KEY, user_email TEXT NOT NULL REFERENCES users(email), thread_id TEXT REFERENCES threads(id), summary TEXT NOT NULL, door TEXT NOT NULL CHECK(door IN ('reversible','one-way')), status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')), theme TEXT NOT NULL DEFAULT '—', outcome TEXT, at TEXT NOT NULL DEFAULT 'today', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.run(`CREATE TABLE checkins (id TEXT PRIMARY KEY, user_email TEXT NOT NULL REFERENCES users(email), ref_decision_id TEXT REFERENCES decisions(id), theme TEXT, prompt TEXT NOT NULL, mood INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.run(`CREATE TABLE visits (user_email TEXT PRIMARY KEY REFERENCES users(email), count INTEGER NOT NULL DEFAULT 0)`);
  db.run(`CREATE TABLE working_genius (user_email TEXT PRIMARY KEY REFERENCES users(email), primary_type TEXT NOT NULL, counts_json TEXT NOT NULL, completed_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);

  db.run("INSERT INTO users (email,name,role,created_at) VALUES ('alice@example.test','Alice','founder',datetime('now'))");
  db.run("INSERT INTO users (email,name,role,created_at) VALUES ('bob@example.test','Bob','founder',datetime('now'))");
  db.run("INSERT INTO threads (id,user_email,title,theme,state,shared_with_coach) VALUES ('t1','alice@example.test','Alice thread','runway','panic',1)");
  // A value the new CHECK constraint does not allow — the migration must
  // normalise it rather than drop the row.
  db.run("INSERT INTO threads (id,user_email,title,state) VALUES ('t2','alice@example.test','Odd state','something-else')");
  db.run("INSERT INTO messages (thread_id,role,content) VALUES ('t1','user','hello')");
  db.run("INSERT INTO messages (thread_id,role,content) VALUES ('t1','assistant','hi')");
  db.run("INSERT INTO decisions (id,user_email,thread_id,summary,door) VALUES ('d1','alice@example.test','t1','A decision','one-way')");
  db.run("INSERT INTO checkins (id,user_email,ref_decision_id,prompt,mood) VALUES ('c1','alice@example.test','d1','reflection',42)");
  db.run("INSERT INTO visits (user_email,count) VALUES ('alice@example.test',7)");
  db.run("INSERT INTO working_genius (user_email,primary_type,counts_json,completed_at) VALUES ('alice@example.test','wonder','{}','2026-08-01')");
  db.close();
}

function open() {
  const db = new Database(path);
  initSchema(db);
  return db;
}

describe("migration 1: uniform ON DELETE policy", () => {
  test("upgrading a legacy database preserves every row", () => {
    buildLegacyDatabase();
    const db = open();
    try {
      const count = (table: string) =>
        (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

      expect(count("users")).toBe(2);
      expect(count("threads")).toBe(2);
      expect(count("messages")).toBe(2);
      expect(count("decisions")).toBe(1);
      expect(count("checkins")).toBe(1);
      expect(count("visits")).toBe(1);
      expect(count("working_genius")).toBe(1);

      // Column values survive, including the opt-in flag.
      const thread = db.query("SELECT * FROM threads WHERE id = 't1'").get() as Record<string, unknown>;
      expect(thread.title).toBe("Alice thread");
      expect(thread.theme).toBe("runway");
      expect(thread.state).toBe("panic");
      expect(thread.shared_with_coach).toBe(1);

      const checkin = db.query("SELECT * FROM checkins WHERE id = 'c1'").get() as Record<string, unknown>;
      expect(checkin.mood).toBe(42);
      expect(checkin.ref_decision_id).toBe("d1");
    } finally {
      db.close();
    }
  });

  test("a state outside the new CHECK is normalised, not dropped", () => {
    buildLegacyDatabase();
    const db = open();
    try {
      const odd = db.query("SELECT state FROM threads WHERE id = 't2'").get() as { state: string };
      expect(odd.state).toBe("thinking");
    } finally {
      db.close();
    }
  });

  test("deleting a user now cascades on its own", () => {
    buildLegacyDatabase();
    const db = open();
    try {
      // The bare DELETE that used to throw a foreign key constraint error.
      db.run("DELETE FROM users WHERE email = 'alice@example.test'");

      const left = (table: string) =>
        (db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE user_email = 'alice@example.test'`).get() as { n: number }).n;

      expect(left("threads")).toBe(0);
      expect(left("decisions")).toBe(0);
      expect(left("checkins")).toBe(0);
      expect(left("visits")).toBe(0);
      expect(left("working_genius")).toBe(0);

      const orphanMessages = db.query(
        "SELECT COUNT(*) AS n FROM messages WHERE thread_id NOT IN (SELECT id FROM threads)",
      ).get() as { n: number };
      expect(orphanMessages.n).toBe(0);
    } finally {
      db.close();
    }
  });

  test("references are cleared rather than cascading the record away", () => {
    buildLegacyDatabase();
    const db = open();
    try {
      // A decision outliving the conversation that prompted it is still useful,
      // so thread_id is SET NULL rather than CASCADE.
      db.run("DELETE FROM threads WHERE id = 't1'");
      const decision = db.query("SELECT * FROM decisions WHERE id = 'd1'").get() as { thread_id: string | null };
      expect(decision).not.toBeNull();
      expect(decision.thread_id).toBeNull();

      db.run("DELETE FROM decisions WHERE id = 'd1'");
      const checkin = db.query("SELECT * FROM checkins WHERE id = 'c1'").get() as { ref_decision_id: string | null };
      expect(checkin).not.toBeNull();
      expect(checkin.ref_decision_id).toBeNull();
    } finally {
      db.close();
    }
  });

  test("it leaves no foreign key violations behind", () => {
    buildLegacyDatabase();
    const db = open();
    try {
      expect(db.query("PRAGMA foreign_key_check").all()).toHaveLength(0);
      expect((db.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check).toBe("ok");
    } finally {
      db.close();
    }
  });

  test("it is recorded and does not run twice", () => {
    buildLegacyDatabase();
    let db = open();
    const version = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    expect(version).toBeGreaterThanOrEqual(1);
    db.close();

    // Re-opening runs initSchema again; it must be a no-op.
    db = open();
    try {
      expect((db.query("SELECT COUNT(*) AS n FROM threads").get() as { n: number }).n).toBe(2);
      expect(db.query("PRAGMA foreign_key_check").all()).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  test("a fresh database gets the same shape", () => {
    const db = open();
    try {
      const fks = db.query("PRAGMA foreign_key_list(threads)").all() as { on_delete: string }[];
      expect(fks[0]!.on_delete).toBe("CASCADE");
      expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBeGreaterThanOrEqual(1);
    } finally {
      db.close();
    }
  });
});
