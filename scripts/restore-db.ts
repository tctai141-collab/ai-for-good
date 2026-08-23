/**
 * Restore a backup into a file you name, and report what is in it.
 *
 *   bun scripts/restore-db.ts <key> <destination.db>
 *   bun scripts/restore-db.ts --list
 *
 * Deliberately refuses to write over the live database. Restoring in anger
 * means: stop the service, move the current file aside, restore to the real
 * path, start the service. The full procedure is in
 * docs/operations/backups.md — an untested backup is not a backup, so that
 * document exists to be rehearsed, not read.
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { decryptBackup, listBackups, resolveTarget } from "../src/lib/backup";

const target = resolveTarget();
if (target.kind === "none") {
  console.error(`Backup target ${target.reason}`);
  process.exit(1);
}

const [key, destination] = process.argv.slice(2);

if (key === "--list" || !key) {
  const all = await listBackups(target);
  if (!all.length) {
    console.log("No snapshots found.");
    process.exit(0);
  }
  console.log(`${all.length} snapshot(s):`);
  for (const item of all.sort((a, b) => a.key.localeCompare(b.key))) {
    console.log(`  ${item.key}  ${(item.bytes / 1024).toFixed(1)} KiB`);
  }
  process.exit(0);
}

if (!destination) {
  console.error("Usage: bun scripts/restore-db.ts <key> <destination.db>");
  process.exit(1);
}

const livePath = process.env.DB_PATH ?? "./data/sprint-buddy.db";
if (destination === livePath) {
  console.error(`Refusing to overwrite the live database at ${livePath}.`);
  console.error("Restore to a scratch path first, check it, then swap the files with the service stopped.");
  process.exit(1);
}
if (existsSync(destination)) {
  console.error(`${destination} already exists. Choose a path that does not.`);
  process.exit(1);
}

// Fetch the compressed snapshot from wherever backups live.
// Typed over ArrayBuffer specifically: Bun.write rejects a Uint8Array backed by
// a SharedArrayBuffer, which is what the plain Uint8Array type allows.
let gzipped: Uint8Array<ArrayBuffer>;
if (target.kind === "r2") {
  gzipped = new Uint8Array(await target.client.file(key).arrayBuffer());
} else {
  const path = key.startsWith("sprint-buddy/") ? key.slice("sprint-buddy/".length) : key;
  gzipped = new Uint8Array(await Bun.file(`${target.dir}/${path}`).arrayBuffer());
}

// Decrypts first when the snapshot carries the encryption marker, and is a
// no-op otherwise, so this handles both shapes without being told which. A
// snapshot encrypted with a key this process does not have fails loudly here
// rather than writing an unreadable file to the destination.
const plain = await decryptBackup(gzipped);
await Bun.write(destination, Bun.gunzipSync(plain));

// Prove it is a real, openable database and show what it holds. Row counts are
// the point of the drill: a file that opens but is empty is still a failure.
const db = new Database(destination, { readonly: true });
try {
  const integrity = db.query("PRAGMA integrity_check").get() as { integrity_check: string };
  console.log(`Restored ${key} -> ${destination}`);
  console.log(`integrity_check: ${integrity.integrity_check}`);
  console.log("\nRow counts:");
  const tables = [
    "users", "sessions", "invites", "threads", "messages",
    "decisions", "checkins", "visits", "working_genius", "admin_audit",
  ];
  for (const table of tables) {
    try {
      const row = db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      console.log(`  ${table.padEnd(16)} ${row.n}`);
    } catch {
      console.log(`  ${table.padEnd(16)} (table absent)`);
    }
  }
} finally {
  db.close();
}
