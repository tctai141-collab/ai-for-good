import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * The reflections page, after the reorganisation.
 *
 * It had grown four sections that each restated the others. "Pattern this
 * week" named the top themes, the latest mood and the next open decision;
 * "The sprint so far" charted the mood; "Check-in memory" printed the mood
 * again with the check-in count; and "Your record" at the foot repeated the
 * counts, the themes and the closed decisions one more time. Reading it meant
 * scrolling past the same four facts three times over.
 *
 * What these guard is that each fact has one home, because the failure mode is
 * a section quietly growing back.
 */

const sprint = readFileSync("src/components/SprintBuddy.tsx", "utf-8");

/** The Reflections render, comments stripped. */
const page = (() => {
  const from = sprint.indexOf("function Reflections({");
  const to = sprint.indexOf("function SprintRecord", from);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return sprint.slice(from, to).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
})();

describe("each fact has one home", () => {
  test("the merged sections are gone", () => {
    expect(page).not.toContain("Pattern this week");
    expect(page).not.toContain("The sprint so far");
    expect(page).not.toContain("Check-in memory");
    expect(page).toContain("How it has felt");
  });

  test("the mood signal is stated once", () => {
    // It appeared in the pattern table, on the chart caption and under the
    // quote. The chart's own caption keeps a worded version; the numeric
    // score belongs to the quote.
    expect(page.match(/\{latestCheckin\.mood\}\/100/g)?.length).toBe(1);
  });

  test("the check-in count is stated once", () => {
    // The strip at the top of the page owns it now.
    expect(page).toContain('label={checkins.length === 1 ? "check-in" : "check-ins"}');
    expect(page).not.toContain("check-ins saved");
    const arc = sprint.slice(sprint.indexOf("function Arc({"));
    expect(arc.slice(0, arc.indexOf("function ProgrammeWeek") + 1 || 4000))
      .not.toContain("{points.length}</Stat> check-ins");
  });

  test("the counts moved above the fold", () => {
    // They were the page's summary and sat at the very bottom of it.
    const strip = page.indexOf("<RecordStat");
    const themes = page.indexOf("On your mind");
    expect(strip).toBeGreaterThan(-1);
    expect(strip).toBeLessThan(themes);
  });

  test("print is offered where the page starts, not where it ends", () => {
    expect(page).toContain("record-print btn-glass");
    expect(page.indexOf("record-print")).toBeLessThan(page.indexOf("On your mind"));
  });
});

describe("the printable record", () => {
  test("still holds the whole thing", () => {
    // Hidden on screen, but a printed sheet wants everything on one page.
    const record = sprint.slice(sprint.indexOf("function SprintRecord"));
    expect(record).toContain("<RecordStat");
    expect(record).toContain("What kept coming up");
    expect(record).toContain("Decisions you closed");
  });

  test("is off the screen and on the page", () => {
    expect(sprint).toContain(".sprint-record { display: none; }");
    expect(sprint).toMatch(/@media print \{[\s\S]*?\.sprint-record \{[\s\S]*?display: block !important;/);
  });

  test("the print button never prints itself", () => {
    expect(sprint).toMatch(/@media print \{[\s\S]*?\.record-print \{ display: none !important; \}/);
  });
});

describe("the rows say something", () => {
  test("a theme reports how often it came up, and drops a flat direction", () => {
    // Every row used to read "is steady." — the same three italic words down
    // the middle of the column, true and useless.
    const row = sprint.slice(sprint.indexOf("function ThemeRow"));
    expect(row).not.toContain("is {dir}.");
    expect(row).toContain('now > prev ? "rising" : now < prev ? "easing" : null');
    expect(row).toContain('total === 1 ? "mention" : "mentions"');
  });

  test("open decisions sort to the top", () => {
    // The page carried a separate "open loop to close next" row naming the
    // first one. Ordering says it without a second copy of the decision.
    expect(page).toContain("orderedDecisions.map");
    expect(page).toContain('Number(a.status === "closed") - Number(b.status === "closed")');
  });
});

describe("the one-tap check-in is gone", () => {
  test("no component, no handler, no moods", () => {
    /*
     * Five mood chips beside the real check-in meant a founder could log a day
     * in one click, and the full check-in — the questions the programme needs
     * answered — never got opened.
     */
    for (const gone of ["QuickCheckin", "onQuickCheckin", "QUICK_MOODS", "Or in one tap"]) {
      expect(sprint).not.toContain(gone);
    }
  });

  test("its styles went with it", () => {
    for (const gone of [".quick-row", ".quick-buttons", ".quick-note"]) {
      expect(sprint).not.toContain(gone);
    }
  });

  test("the full check-in is still reachable", () => {
    expect(sprint).toContain("onStartCheckin");
    expect(sprint).toContain("Today's check-in");
  });
});
