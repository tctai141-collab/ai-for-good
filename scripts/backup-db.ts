/**
 * Take a database backup now.
 *
 *   bun scripts/backup-db.ts
 *
 * Uses R2 when R2_* is configured, otherwise BACKUP_DIR. Run it from Render's
 * shell for an on-demand snapshot before anything risky (a migration, a bulk
 * removal), and in the restore drill described in docs/operations/backups.md.
 */
import { listBackups, resolveTarget, runBackup } from "../src/lib/backup";

const target = resolveTarget();
if (target.kind === "none") {
  console.error(`Backup target ${target.reason}`);
  console.error("Set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_ENDPOINT,");
  console.error("or BACKUP_DIR=/some/path for a local snapshot.");
  process.exit(1);
}

const result = await runBackup();
console.log(`Wrote ${result.key} (${(result.bytes / 1024).toFixed(1)} KiB) to ${result.target}.`);
if (result.pruned.length) {
  console.log(`Pruned ${result.pruned.length} snapshot(s) past the retention window.`);
}

const all = await listBackups(target);
console.log(`\n${all.length} snapshot(s) held:`);
for (const item of all.sort((a, b) => a.key.localeCompare(b.key))) {
  console.log(`  ${item.key}  ${(item.bytes / 1024).toFixed(1)} KiB`);
}
