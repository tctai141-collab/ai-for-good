import { Database } from "bun:sqlite";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { reportError } from "./errors";
import { tmpdir } from "node:os";

/**
 * Database backups.
 *
 * The whole cohort — accounts, conversations, check-ins, decisions — is one
 * SQLite file on one Render disk. Before this there was no backup at all, only
 * a documented manual `cat`, and a raw copy of a live WAL database is not a
 * valid snapshot anyway: the .db file alone can be missing everything still
 * sitting in the -wal.
 *
 * `VACUUM INTO` is the right primitive. SQLite takes a read lock, writes a
 * fully checkpointed, self-contained copy, and leaves the live database alone.
 * The result opens standalone with no -wal or -shm alongside it.
 *
 * Target is Cloudflare R2 (EU jurisdiction, matching the Frankfurt region the
 * app runs in) over its S3-compatible API, using Bun's built-in S3 client so
 * this adds no dependency.
 */

const DEFAULT_RETENTION_DAYS = 30;
const KEY_PREFIX = "sprint-buddy/";

/**
 * Optional encryption of the snapshot before it leaves the box.
 *
 * A backup is the whole database: Argon2id password hashes, every founder's
 * private conversations, thirty days of them sitting in object storage. Gzip is
 * not a protection — anyone who reaches the bucket reads the lot.
 *
 * Off unless `BACKUP_ENCRYPTION_KEY` is set, and deliberately so. Turning it on
 * means that losing the key loses every backup, which is a real way to destroy
 * the data you were protecting. That trade belongs to whoever runs the service,
 * not to this file, so the default is the previous behaviour and enabling it is
 * an explicit act. `scripts/restore-db.ts` reads the same variable.
 *
 * AES-256-GCM via WebCrypto, which Bun ships — no dependency. The nonce is 12
 * random bytes prepended to the ciphertext, and GCM's tag means a truncated or
 * altered snapshot fails to decrypt rather than restoring as silent garbage.
 */
const ENCRYPTED_MAGIC = "SBENC1";

function encryptionKeyMaterial(): string | null {
  const raw = process.env.BACKUP_ENCRYPTION_KEY?.trim();
  return raw ? raw : null;
}

async function importKey(secret: string): Promise<CryptoKey> {
  // The env value is arbitrary text, so it is hashed to exactly 256 bits
  // rather than requiring the operator to produce a correctly sized key.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Returns the payload to upload, and the suffix that describes it. */
export async function maybeEncrypt(
  payload: Uint8Array,
): Promise<{ bytes: Uint8Array; suffix: string }> {
  const secret = encryptionKeyMaterial();
  if (!secret) return { bytes: payload, suffix: ".db.gz" };

  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload as BufferSource),
  );

  // magic | iv | ciphertext+tag. The magic makes a wrongly-named file obvious
  // instead of failing as a corrupt gzip.
  const magic = new TextEncoder().encode(ENCRYPTED_MAGIC);
  const out = new Uint8Array(magic.length + iv.length + sealed.length);
  out.set(magic, 0);
  out.set(iv, magic.length);
  out.set(sealed, magic.length + iv.length);
  return { bytes: out, suffix: ".db.gz.enc" };
}

/** Reverses maybeEncrypt. Throws rather than returning a corrupt snapshot. */
export async function decryptBackup(payload: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const magic = new TextEncoder().encode(ENCRYPTED_MAGIC);
  const looksEncrypted =
    payload.length > magic.length &&
    magic.every((b, i) => payload[i] === b);
  if (!looksEncrypted) return new Uint8Array(payload.slice()) as Uint8Array<ArrayBuffer>;

  const secret = encryptionKeyMaterial();
  if (!secret) {
    throw new Error(
      "This snapshot is encrypted but BACKUP_ENCRYPTION_KEY is not set. " +
        "Without the key it cannot be restored.",
    );
  }
  const key = await importKey(secret);
  const iv = payload.slice(magic.length, magic.length + 12);
  const body = payload.slice(magic.length + 12);
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, body as BufferSource),
  ) as Uint8Array<ArrayBuffer>;
}

export type BackupTarget =
  | { kind: "r2"; client: Bun.S3Client }
  | { kind: "local"; dir: string }
  | { kind: "none"; reason: string };

export type BackupResult = {
  key: string;
  bytes: number;
  target: BackupTarget["kind"];
  pruned: string[];
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/**
 * Where backups go. R2 when it is configured, otherwise a local directory if
 * one is named (used by the restore drill and by anyone running this by hand),
 * otherwise nowhere — and we say so rather than exiting 0 having done nothing.
 */
export function resolveTarget(): BackupTarget {
  const accessKeyId = env("R2_ACCESS_KEY_ID");
  const secretAccessKey = env("R2_SECRET_ACCESS_KEY");
  const bucket = env("R2_BUCKET");
  const endpoint = env("R2_ENDPOINT");

  if (accessKeyId && secretAccessKey && bucket && endpoint) {
    return {
      kind: "r2",
      client: new Bun.S3Client({ accessKeyId, secretAccessKey, bucket, endpoint, region: "auto" }),
    };
  }

  const dir = env("BACKUP_DIR");
  if (dir) return { kind: "local", dir };

  const missing = [
    !accessKeyId && "R2_ACCESS_KEY_ID",
    !secretAccessKey && "R2_SECRET_ACCESS_KEY",
    !bucket && "R2_BUCKET",
    !endpoint && "R2_ENDPOINT",
  ].filter(Boolean);

  return { kind: "none", reason: `not configured — missing ${missing.join(", ")} (or set BACKUP_DIR)` };
}

/** UTC, sortable, filesystem- and key-safe: 2026-08-17T21-30-00Z. */
function stamp(now: Date): string {
  return now.toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
}

/** Parses the timestamp back out of a key so retention can compare dates. */
function timeFromKey(key: string): number | null {
  const match = key.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z/);
  if (!match) return null;
  const iso = `${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Takes a consistent snapshot, compresses it, and stores it under a dated key.
 * Returns what it wrote so callers can log or assert on it.
 */
export async function runBackup(options: { dbPath?: string; now?: Date } = {}): Promise<BackupResult> {
  const dbPath = options.dbPath ?? process.env.DB_PATH ?? "./data/sprint-buddy.db";
  const now = options.now ?? new Date();
  const target = resolveTarget();
  if (target.kind === "none") throw new Error(`Backup target ${target.reason}`);

  const scratch = join(tmpdir(), `sprint-buddy-backup-${crypto.randomUUID()}`);
  mkdirSync(scratch, { recursive: true });
  const snapshot = join(scratch, "snapshot.db");

  try {
    // Consistent point-in-time copy, fully checkpointed. Read-only against the
    // live database — it does not block writers for more than the read lock.
    const db = new Database(dbPath, { readonly: true });
    try {
      db.run(`VACUUM INTO ${JSON.stringify(snapshot)}`);
    } finally {
      db.close();
    }

    const raw = await Bun.file(snapshot).arrayBuffer();
    const gzipped = Bun.gzipSync(new Uint8Array(raw));
    const { bytes: payload, suffix } = await maybeEncrypt(gzipped);
    const key = `${KEY_PREFIX}${stamp(now)}${suffix}`;

    if (target.kind === "r2") {
      await target.client.write(key, payload, {
        type: suffix.endsWith(".enc") ? "application/octet-stream" : "application/gzip",
      });
    } else {
      mkdirSync(target.dir, { recursive: true });
      await Bun.write(join(target.dir, key.replace(KEY_PREFIX, "")), payload);
    }

    const pruned = await pruneOldBackups(target, now);
    return { key, bytes: payload.byteLength, target: target.kind, pruned };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Deletes snapshots older than the retention window. */
export async function pruneOldBackups(target: BackupTarget, now: Date): Promise<string[]> {
  const days = Number(env("BACKUP_RETENTION_DAYS") ?? DEFAULT_RETENTION_DAYS);
  if (!Number.isFinite(days) || days <= 0) return [];
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  const pruned: string[] = [];

  if (target.kind === "r2") {
    const listing = await target.client.list({ prefix: KEY_PREFIX });
    for (const object of listing.contents ?? []) {
      const at = timeFromKey(object.key);
      if (at !== null && at < cutoff) {
        await target.client.delete(object.key);
        pruned.push(object.key);
      }
    }
  } else if (target.kind === "local") {
    const glob = new Bun.Glob("*.db.gz{,.enc}");
    for await (const name of glob.scan({ cwd: target.dir })) {
      const at = timeFromKey(name);
      if (at !== null && at < cutoff) {
        rmSync(join(target.dir, name), { force: true });
        pruned.push(name);
      }
    }
  }

  return pruned;
}

export async function listBackups(target: BackupTarget): Promise<{ key: string; bytes: number }[]> {
  if (target.kind === "r2") {
    const listing = await target.client.list({ prefix: KEY_PREFIX });
    return (listing.contents ?? []).map((o) => ({ key: o.key, bytes: o.size ?? 0 }));
  }
  if (target.kind === "local") {
    const out: { key: string; bytes: number }[] = [];
    const glob = new Bun.Glob("*.db.gz{,.enc}");
    for await (const name of glob.scan({ cwd: target.dir })) {
      out.push({ key: name, bytes: statSync(join(target.dir, name)).size });
    }
    return out;
  }
  return [];
}

/**
 * Daily backup from inside the web process.
 *
 * A Render cron job would be tidier, but a cron service cannot mount the web
 * service's persistent disk, and the database only exists on that disk. Since
 * this runs as a single instance there is nothing to coordinate, so a timer in
 * the server process is the honest option. A failure is logged and the timer
 * keeps running; a backup that throws must never take the app down.
 */
let scheduled = false;

export function startBackupScheduler(): void {
  if (scheduled) return;
  if (process.env.NODE_ENV !== "production") return;
  const target = resolveTarget();
  if (target.kind === "none") {
    console.warn(`[backup] scheduler not started: ${target.reason}`);
    return;
  }
  scheduled = true;

  const everyMs = 24 * 60 * 60 * 1000;
  const tick = async () => {
    try {
      const result = await runBackup();
      console.info(`[backup] wrote ${result.key} (${result.bytes} bytes), pruned ${result.pruned.length}`);
    } catch (error) {
      reportError(error, { where: "backup" });
    }
  };

  // One shortly after boot so a fresh deploy is covered, then daily.
  const first = setTimeout(tick, 60_000);
  const repeat = setInterval(tick, everyMs);
  first.unref?.();
  repeat.unref?.();
}
