# Backups and restore

The whole cohort lives in one SQLite file on one Render disk: accounts,
conversations, check-ins, decisions. If that disk goes, everything goes.

## Why not just copy the file

The database runs in WAL mode. Recent writes sit in `sprint-buddy.db-wal` and
have not yet been folded into `sprint-buddy.db`. Copying the `.db` alone
captures a database missing everything since the last checkpoint — and in a
busy moment that is nearly all of it.

This is not theoretical. In the restore drill below, a live database holding
2 users, 7 threads, 21 messages, 5 check-ins and 3 decisions had a `.db` file
of 4 KB and a `-wal` of 642 KB. Copying the `.db`:

```
SQLiteError: unable to open database file (SQLITE_CANTOPEN)
```

The previously documented procedure — `cat` the `.db` file — would have
produced an unopenable backup.

`VACUUM INTO` is the correct primitive. SQLite takes a read lock and writes a
fully checkpointed, self-contained copy that opens standalone with no `-wal` or
`-shm` beside it. That is what `src/lib/backup.ts` does.

## What runs automatically

The web process starts a daily timer at boot (`startBackupScheduler`). It takes
a `VACUUM INTO` snapshot, gzips it, and writes it to Cloudflare R2 under
`sprint-buddy/<UTC timestamp>.db.gz`, then deletes anything older than
`BACKUP_RETENTION_DAYS` (default 30).

It runs once a minute after boot so a fresh deploy is covered immediately, then
every 24 hours. A failure is logged and the timer continues — a backup must
never take the app down.

The timer lives in the web process rather than a Render cron job because a
Render cron service cannot mount the web service's persistent disk, and the
database only exists on that disk. Single instance, so there is nothing to
coordinate.

If R2 is not configured the scheduler logs a warning at boot and does nothing.
It does not fail silently.

## Required configuration

Set these in the Render dashboard (all are `sync: false` in `render.yaml`):

| Variable | Notes |
|---|---|
| `R2_ACCESS_KEY_ID` | R2 API token |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_BUCKET` | e.g. `sprint-buddy-backups` |
| `R2_ENDPOINT` | `https://<account-id>.eu.r2.cloudflarestorage.com` |
| `BACKUP_RETENTION_DAYS` | defaults to 30 |

Create the bucket in an **EU** jurisdiction. The app runs in Frankfurt because
these are Finnish students' private reflections; a backup bucket in another
jurisdiction would quietly undo that.

## Taking a backup by hand

Before anything risky — a migration, a bulk removal — take one first:

```
bun scripts/backup-db.ts
```

## Listing what exists

```
bun scripts/restore-db.ts --list
```

## Restoring

`restore-db.ts` will not write over the live database. Restore to a scratch
path, check it, then swap with the service stopped.

```
bun scripts/restore-db.ts sprint-buddy/2026-08-17T18-17-22Z.db.gz /tmp/check.db
```

It prints `integrity_check` and a row count per table. **Row counts are the
point.** A file that opens but is empty is still a failed backup.

To restore in anger:

1. Suspend the service in the Render dashboard, so nothing writes during the swap.
2. `bun scripts/restore-db.ts <key> /tmp/restored.db`
3. Check the row counts look like a live cohort, not an empty schema.
4. `mv /app/data/sprint-buddy.db /app/data/sprint-buddy.db.broken`
5. Remove the stale `-wal` and `-shm` beside it — they belong to the old database
   and will corrupt the restored one:
   `rm -f /app/data/sprint-buddy.db-wal /app/data/sprint-buddy.db-shm`
6. `mv /tmp/restored.db /app/data/sprint-buddy.db`
7. Resume the service and sign in to confirm.

Keep `.broken` until you are satisfied.

## Rehearsed drill

Run this quarterly and before the cohort starts. It exercises the real scripts
against a throwaway database, so it proves the code path rather than the
documentation.

```
DIR=$(mktemp -d)

# a database with data in it, WAL uncheckpointed — the realistic case
DB_PATH=$DIR/live.db bun -e '...seed...'

DB_PATH=$DIR/live.db BACKUP_DIR=$DIR/backups bun scripts/backup-db.ts
DB_PATH=$DIR/live.db BACKUP_DIR=$DIR/backups bun scripts/restore-db.ts --list
DB_PATH=$DIR/live.db BACKUP_DIR=$DIR/backups \
  bun scripts/restore-db.ts <key> $DIR/restored.db

rm -rf $DIR
```

Last rehearsed 2026-08-17, against the code in this commit:

```
Restored 2026-08-17T18-17-22Z.db.gz -> restored.db
integrity_check: ok

Row counts:
  users            2
  sessions         0
  invites          0
  threads          7
  messages         21
  decisions        3
  checkins         5
  visits           0
  working_genius   0
```

Matching the live database exactly. `test/backup.test.ts` runs the same
round-trip on every CI run so it cannot rot.
