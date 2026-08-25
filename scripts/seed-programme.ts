#!/usr/bin/env bun
/**
 * Loads the F26 schedule into the database from a shell.
 *
 *   bun scripts/seed-programme.ts            # show what would change
 *   bun scripts/seed-programme.ts --write    # write it
 *
 * The same entries are behind the "Load the F26 schedule" button on /admin,
 * which is the easier route and needs no shell. Both read src/lib/f26-schedule.
 *
 * Idempotent: ids come from date and title, so running it twice updates rather
 * than duplicating. That also means it puts back anything edited on /admin, so
 * stop running it once the schedule is being maintained there.
 */

import { upsertProgrammeEvent, listProgrammeEvents } from "../src/db/index";
import { F26_SCHEDULE, F26_DATE_CONFLICTS } from "../src/lib/f26-schedule";

const write = process.argv.includes("--write");
const existing = new Map(listProgrammeEvents().map((event) => [event.id, event]));

let added = 0;
let changed = 0;
let same = 0;
for (const row of F26_SCHEDULE) {
  const before = existing.get(row.id);
  if (!before) added++;
  else if (JSON.stringify(before) !== JSON.stringify(row)) changed++;
  else same++;
  // No author: nobody typed these, and created_by has a foreign key to users.
  if (write) upsertProgrammeEvent(row, null);
}

console.log(`${F26_SCHEDULE.length} entries, weeks 1 to 7.`);
console.log(`  ${added} new, ${changed} changed, ${same} already identical.`);
console.log(write ? "Written." : "Nothing written. Re-run with --write.");
console.log("\nRead these before trusting the dates:");
for (const line of F26_DATE_CONFLICTS) console.log(`  - ${line}`);
