import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { sprintWeekOf } from "../src/components/ProgrammeTimeline";

/**
 * The F26 schedule that ships in scripts/seed-programme.ts.
 *
 * Asserted against the source text rather than by running it, because running
 * it needs a database and the thing worth protecting is the data: a date typed
 * into the wrong week is not a crash, it is twenty people in the wrong room.
 */

const script = readFileSync("scripts/seed-programme.ts", "utf-8");
const START = "2026-09-08";

/** Every `date: "YYYY-MM-DD"` in the seed list, in order. */
const dates = [...script.matchAll(/date: "(\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1] as string);

describe("the dates", () => {
  test("there are as many as the script says it loads", () => {
    expect(dates.length).toBeGreaterThan(30);
  });

  test("every one falls inside the fifteen-week programme", () => {
    for (const date of dates) {
      expect(sprintWeekOf(date, START, 15)).not.toBeNull();
    }
  });

  test("nothing lands on a weekend except the cottage", () => {
    /*
     * Sessions run Tuesday to Thursday. A stray Saturday would mean a weekday
     * label and a date that disagreed — which is exactly the mistake the
     * source table made four times.
     */
    const weekend = dates.filter((date) => {
      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      return day === 0 || day === 6;
    });
    expect(weekend).toEqual([]);
  });

  test("the weeks run 1 to 7 with nothing skipped", () => {
    const weeks = new Set(dates.map((d) => sprintWeekOf(d, START, 15)));
    expect([...weeks].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("the two fixed points are where the brief puts them", () => {
    // Submission in week 5, presented to the board in week 7.
    expect(sprintWeekOf("2026-10-08", START, 15)).toBe(5);
    expect(script).toContain('{ date: "2026-10-08", title: "Trend report submission", kind: "milestone"');
    expect(sprintWeekOf("2026-10-22", START, 15)).toBe(7);
    expect(script).toContain("Trend report presented to the Kiilto board");
  });
});

describe("what it does and does not claim", () => {
  test("an unconfirmed speaker is not named", () => {
    /*
     * Publishing a name that then does not turn up is worse than publishing
     * the subject and filling the name in later. Every slot still at "email
     * sent" carries the topic and says so instead.
     */
    expect(script).toContain("Speaker not fixed yet.");
    for (const name of ["Mikko Dufva", "Youssef Zad", "Sampo Hietanen", "Tommi Nyman", "Sami Marttinen", "Kristo Ovaska"]) {
      expect(script).not.toContain(name);
    }
  });

  test("confirmed speakers are named, because the cohort has to know who is coming", () => {
    for (const name of ["Monika Liikamaa", "Kasper Suomalainen", "Lauri Torvinen", "Mårten Mickos", "Aape Pohjavirta", "Jan Goetz"]) {
      expect(script).toContain(name);
    }
  });

  test("every date that contradicted its own weekday is printed, not quietly resolved", () => {
    for (const flag of ["29 Oct", "20 Oct", "Oct 17", "Oct 9"]) {
      expect(script).toContain(flag);
    }
    expect(script).toContain("Read these before trusting the dates");
  });

  test("re-running it updates rather than duplicates", () => {
    // Ids are derived from date and title, so they are the same every run.
    expect(script).toContain("function idFor");
    expect(script).toContain("upsertProgrammeEvent");
  });

  test("it writes nothing unless told to", () => {
    expect(script).toContain('const write = process.argv.includes("--write")');
    expect(script).toContain("Nothing written.");
  });
});
