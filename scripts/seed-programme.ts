#!/usr/bin/env bun
/**
 * Loads the F26 Trend Research and Builder Sprint schedule, weeks 1 to 7.
 *
 *   bun scripts/seed-programme.ts            # show what would change
 *   bun scripts/seed-programme.ts --write    # write it
 *
 * Idempotent: each entry has a stable id derived from its date and title, so
 * running it twice updates rather than duplicating. Editing a session on
 * /admin and re-running this would put the typed version back — change it here
 * if it is going to be re-run, or stop running it once the schedule is being
 * maintained in the app.
 *
 * Two rules were applied to the source, both about not telling the cohort
 * something that is not true yet:
 *
 *   A speaker is named only where the schedule said CONFIRMED. Everything
 *   still at "email sent" or "requested on LinkedIn" keeps its topic and says
 *   the speaker is not fixed. Publishing a name that then does not turn up is
 *   worse than publishing the subject and filling the name in later.
 *
 *   Dates come from the week ranges and the weekday labels, which agree with
 *   each other everywhere. Four cells carried a date that contradicted its own
 *   weekday; those are listed at the bottom of this file and printed on every
 *   run rather than being quietly resolved.
 */

import { listProgrammeEvents, upsertProgrammeEvent, type ProgrammeEventRow } from "../src/db/index";

type Seed = {
  date: string;
  start?: string;
  end?: string;
  title: string;
  kind: ProgrammeEventRow["kind"];
  where?: string;
  note?: string;
};

/** Weekly fixtures, so seven weeks of them are not typed out fourteen times. */
const weekly = (date: string): Seed[] => [
  { date, start: "10:00", end: "11:00", title: "Team weekly check-up", kind: "checkpoint", where: "With Tai and Gleb" },
  { date, start: "11:00", end: "11:45", title: "Kiilto Ventures weekly check-up", kind: "checkpoint", note: "Progress on the trend report." },
];

const SEEDS: Seed[] = [
  // ── Week 1 · 8–14 Sep ───────────────────────────────────────────────────
  { date: "2026-09-08", start: "10:00", end: "11:45", title: "Intro to the Sprint, and onboarding", kind: "session", where: "With Tai and Gleb" },
  { date: "2026-09-08", start: "12:00", end: "13:00", title: "Trend report onboarding", kind: "session", where: "Kiilto Ventures" },
  { date: "2026-09-08", start: "13:00", end: "14:30", title: "Getting the most out of the Sprint", kind: "social",
    where: "With the S26 cohort — Vu, Vedant, SK, Pietu", note: "Casual lunch and networking." },
  { date: "2026-09-08", start: "14:30", end: "15:30", title: "Entrepreneurship mindset", kind: "session", where: "Monika Liikamaa" },

  { date: "2026-09-09", start: "13:00", end: "14:00", title: "How to conduct interviews, and the framework for it", kind: "session", where: "Marizeh Soleimani" },
  { date: "2026-09-09", start: "14:15", end: "15:00", title: "How a professional trend report is built", kind: "session",
    note: "Speaker not fixed yet." },
  { date: "2026-09-09", start: "17:30", end: "21:30", title: "Tech Founder Crash Course", kind: "session",
    where: "Hive, Slush, Startup Foundation and Founder School",
    note: "Registering a startup, a business model draft, and a pitch. https://luma.com/5co0j9jo" },

  { date: "2026-09-10", start: "16:00", end: "17:30", title: "Outreach and cold-calling", kind: "session", where: "Lauri Torvinen" },

  // ── Week 2 · 15–21 Sep ──────────────────────────────────────────────────
  ...weekly("2026-09-15"),
  { date: "2026-09-15", start: "12:00", end: "14:00", title: "F26 photoshoot", kind: "session", where: "Studio booked", note: "Headshots. With Dani and Tai." },
  { date: "2026-09-15", start: "16:00", end: "17:00", title: "Coaching: a founder building in smart cities, with traction", kind: "session",
    note: "Speaker not fixed yet." },

  { date: "2026-09-16", start: "13:00", end: "14:00", title: "Giving and receiving feedback", kind: "session", where: "Kasper Suomalainen" },
  { date: "2026-09-16", start: "14:00", end: "15:00", title: "Managing a team of ambitious people", kind: "session",
    note: "Speaker not fixed yet." },
  { date: "2026-09-16", start: "16:00", title: "Sauna, and teach us something", kind: "social", where: "Sauna booked" },

  { date: "2026-09-18", title: "Cottage weekend", kind: "trip", note: "Friday to Sunday." },

  // ── Week 3 · 22–28 Sep ──────────────────────────────────────────────────
  ...weekly("2026-09-22"),
  { date: "2026-09-22", start: "16:30", end: "17:30", title: "Coaching: selling in a heavily regulated industry", kind: "session", where: "Monika Liikamaa" },

  { date: "2026-09-23", start: "13:00", end: "14:30", title: "Selling to cities, and how cities buy", kind: "session",
    note: "Speaker not fixed yet. The intention is to have a seller and a buyer in the room together." },

  { date: "2026-09-24", start: "16:00", end: "17:30", title: "Market sizing, and telling a real opportunity from one that is not", kind: "session",
    note: "Speaker not fixed yet." },

  // ── Week 4 · 29 Sep – 5 Oct ─────────────────────────────────────────────
  ...weekly("2026-09-29"),
  { date: "2026-09-29", start: "16:30", end: "17:30", title: "Coaching: unit economics and gross margin", kind: "session", where: "Mårten Mickos" },

  { date: "2026-09-30", start: "13:00", end: "14:00", title: "Unit economics, gross margin, and a founding journey", kind: "session",
    note: "Speaker not fixed yet." },
  { date: "2026-09-30", start: "14:00", end: "15:00", title: "Business writing, and editing to a single voice", kind: "session",
    note: "Speaker not fixed yet." },

  { date: "2026-10-01", start: "16:00", end: "17:30", title: "Working session: the trend report", kind: "session",
    note: "No mentor. The room is for building the report." },

  // ── Week 5 · 6–12 Oct ───────────────────────────────────────────────────
  ...weekly("2026-10-06"),
  { date: "2026-10-06", start: "16:30", end: "17:30", title: "Coaching with Monika Liikamaa", kind: "session", where: "Monika Liikamaa", note: "Topic to be set." },

  { date: "2026-10-07", start: "13:00", end: "14:30", title: "Communicating to external stakeholders: thesis, narrative, board-level storytelling", kind: "session",
    where: "Margarita, co-founder and CCMO at Sensible 4" },

  { date: "2026-10-08", title: "Trend report submission", kind: "milestone", note: "Hard freeze." },

  // ── Week 6 · 13–19 Oct ──────────────────────────────────────────────────
  { date: "2026-10-13", start: "10:00", end: "11:00", title: "Team weekly check-up", kind: "checkpoint", where: "With Tai and Gleb" },
  { date: "2026-10-13", start: "16:30", end: "17:30", title: "Coaching: finding a problem worth solving", kind: "session", where: "Mårten Mickos" },

  { date: "2026-10-14", start: "13:00", end: "14:30", title: "Pitching and storytelling", kind: "session", where: "Aape Pohjavirta" },

  { date: "2026-10-15", start: "16:30", end: "17:30", title: "Founder Talks: Jan Goetz", kind: "session", where: "Jan Goetz" },

  // ── Week 7 · 20–26 Oct ──────────────────────────────────────────────────
  { date: "2026-10-20", start: "10:00", end: "11:00", title: "Team weekly check-up", kind: "checkpoint", where: "With Tai and Gleb" },
  { date: "2026-10-20", start: "16:30", end: "17:30", title: "Coaching: the 0 to 1 plan", kind: "session", where: "Monika Liikamaa" },

  { date: "2026-10-21", start: "13:00", end: "14:30", title: "Validating ideas, and the B2B story flow", kind: "session",
    note: "Speaker not fixed yet." },

  { date: "2026-10-22", start: "09:00", end: "11:30", title: "Trend report presented to the Kiilto board", kind: "milestone",
    where: "Kiilto Ventures board of directors" },
  { date: "2026-10-22", start: "16:00", end: "17:30", title: "Startup look and feel as your wedge, and deeptech marketing", kind: "session",
    note: "Speaker not fixed yet — the slot is held, the name is not." },
];

/** Stable, readable, and the same on every run. */
function idFor(seed: Seed): string {
  const slug = seed.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return `f26-${seed.date}-${slug}`;
}

const rows: ProgrammeEventRow[] = SEEDS.map((seed) => ({
  id: idFor(seed),
  title: seed.title,
  kind: seed.kind,
  startsOn: seed.date,
  startTime: seed.start ?? "",
  endTime: seed.end ?? "",
  location: seed.where ?? "",
  description: seed.note ?? "",
}));

const CONFLICTS = [
  'Week 4 coaching read "29 Oct" under a week running 29 Sep – 5 Oct. Entered as Tue 29 Sep.',
  'Week 6 coaching read "20 Oct", which is the Tuesday of week 7. Entered as Tue 13 Oct.',
  'Founder Talks read "Oct 17", which is a Saturday. Entered as Thu 15 Oct.',
  'Report submission read "Thursday Oct 9"; 9 Oct is a Friday. Entered as Thu 8 Oct.',
  'Week 1 had two different speakers booked into Wed 9 Sep 14:15–15:00. Entered once, as one slot.',
  'The interviews mentor is "Marizeh Soleimani" here and "Marzieh" in the mentor corpus filename.',
];

const write = process.argv.includes("--write");
const existing = new Map(listProgrammeEvents().map((event) => [event.id, event]));

let added = 0;
let changed = 0;
let same = 0;
for (const row of rows) {
  const before = existing.get(row.id);
  if (!before) added++;
  else if (JSON.stringify(before) !== JSON.stringify(row)) changed++;
  else same++;
  // No author: nobody typed these, and created_by has a foreign key to users.
  if (write) upsertProgrammeEvent(row, null);
}

console.log(`${rows.length} entries, weeks 1 to 7.`);
console.log(`  ${added} new, ${changed} changed, ${same} already identical.`);
console.log(write ? "Written." : "Nothing written. Re-run with --write.");
console.log("\nRead these before trusting the dates:");
for (const line of CONFLICTS) console.log(`  - ${line}`);
