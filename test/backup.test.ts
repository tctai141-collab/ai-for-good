import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSchema } from "../src/db/schema";
import { listBackups, resolveTarget, runBackup } from "../src/lib/backup";

/**
 * C-4 — backups.
 *
 * An untested backup is not a backup, so the round-trip is exercised on every
 * CI run rather than only in a drill somebody has to remember to do.
 */

let dir: string;
let dbPath: string;
let backupDir: string;
/** Kept open on purpose: leaves writes in the -wal, which is the realistic case. */
let live: Database;

const COUNTS = { users: 2, threads: 7, messages: 21, checkins: 5, decisions: 3 };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sprint-buddy-backup-test-"));
  dbPath = join(dir, "live.db");
  backupDir = join(dir, "backups");
  process.env.BACKUP_DIR = backupDir;
  delete process.env.R2_ACCESS_KEY_ID;

  live = new Database(dbPath);
  initSchema(live);
  live.run("INSERT INTO users (email,name,role,created_at) VALUES ('a@example.test','Alice','founder',datetime('now'))");
  live.run("INSERT INTO users (email,name,role,created_at) VALUES ('o@example.test','Org','organizer',datetime('now'))");
  for (let i = 0; i < COUNTS.threads; i++) {
    live.run("INSERT INTO threads (id,user_email,title) VALUES (?1,'a@example.test',?2)", [`t${i}`, `Thread ${i}`]);
  }
  for (let i = 0; i < COUNTS.messages; i++) {
    live.run("INSERT INTO messages (thread_id,role,content) VALUES (?1,?2,?3)", [
      `t${i % COUNTS.threads}`, i % 2 ? "assistant" : "user", `message ${i}`,
    ]);
  }
  for (let i = 0; i < COUNTS.checkins; i++) {
    live.run("INSERT INTO checkins (id,user_email,prompt,mood) VALUES (?1,'a@example.test',?2,?3)", [`c${i}`, `reflection ${i}`, 40 + i]);
  }
  for (let i = 0; i < COUNTS.decisions; i++) {
    live.run("INSERT INTO decisions (id,user_email,summary,door) VALUES (?1,'a@example.test',?2,'reversible')", [`d${i}`, `decision ${i}`]);
  }
});

afterEach(() => {
  live?.close();
  delete process.env.BACKUP_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function countsOf(path: string) {
  const db = new Database(path, { readonly: true });
  try {
    const out: Record<string, number> = {};
    for (const table of Object.keys(COUNTS)) {
      out[table] = (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    }
    return out;
  } finally {
    db.close();
  }
}

describe("backup round-trip", () => {
  test("a snapshot restores with every row intact", async () => {
    const result = await runBackup({ dbPath });
    expect(result.bytes).toBeGreaterThan(0);

    const restored = join(dir, "restored.db");
    const gz = await Bun.file(join(backupDir, result.key.replace("sprint-buddy/", ""))).arrayBuffer();
    await Bun.write(restored, Bun.gunzipSync(new Uint8Array(gz)));

    const db = new Database(restored, { readonly: true });
    try {
      expect((db.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check).toBe("ok");
    } finally {
      db.close();
    }

    expect(countsOf(restored)).toEqual(COUNTS);
  });

  test("a raw copy of the live file does NOT survive — this is why VACUUM INTO is used", () => {
    // The procedure that used to be documented. With writes still in the -wal,
    // the .db alone is not a usable database.
    const rawCopy = join(dir, "raw-copy.db");
    copyFileSync(dbPath, rawCopy);

    let recovered: Record<string, number> | null = null;
    try {
      recovered = countsOf(rawCopy);
    } catch {
      recovered = null; // could not even open it
    }

    // Either it fails to open, or it opens missing rows. Never the full set.
    expect(recovered).not.toEqual(COUNTS);
  });

  test("consecutive backups produce distinct dated keys", async () => {
    const first = await runBackup({ dbPath, now: new Date("2026-08-17T03:00:00Z") });
    const second = await runBackup({ dbPath, now: new Date("2026-08-18T03:00:00Z") });

    expect(first.key).not.toBe(second.key);
    expect(first.key).toContain("2026-08-17");
    expect(second.key).toContain("2026-08-18");

    const held = await listBackups(resolveTarget());
    expect(held).toHaveLength(2);
  });

  test("retention deletes snapshots past the window and keeps the rest", async () => {
    // Build the history first with retention effectively off, so the setup
    // does not prune itself as it goes — each backup prunes on the way out.
    process.env.BACKUP_RETENTION_DAYS = "36500";
    await runBackup({ dbPath, now: new Date("2026-06-01T03:00:00Z") }); // ~2.5 months old
    await runBackup({ dbPath, now: new Date("2026-08-10T03:00:00Z") }); // within window
    expect(await listBackups(resolveTarget())).toHaveLength(2);

    process.env.BACKUP_RETENTION_DAYS = "30";
    const result = await runBackup({ dbPath, now: new Date("2026-08-17T03:00:00Z") });

    expect(result.pruned).toHaveLength(1);
    expect(result.pruned[0]).toContain("2026-06-01");

    const held = await listBackups(resolveTarget());
    expect(held.map((h) => h.key).sort()).toEqual([
      "2026-08-10T03-00-00Z.db.gz",
      "2026-08-17T03-00-00Z.db.gz",
    ]);
    delete process.env.BACKUP_RETENTION_DAYS;
  });

  test("an unconfigured target reports itself instead of silently doing nothing", async () => {
    delete process.env.BACKUP_DIR;
    const target = resolveTarget();
    expect(target.kind).toBe("none");
    expect(runBackup({ dbPath })).rejects.toThrow(/not configured/);
  });
});
