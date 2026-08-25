import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * The cohort heatmap, after the review.
 *
 * The grid draws fifteen weeks whatever week the sprint is in, and it drew a
 * week that has not happened exactly like a week nobody checked in: an empty
 * cell. In week three that is twelve future weeks per row being read as twelve
 * absences, under a legend that says in as many words "an empty cell is an
 * absence, not a verdict". The chart was stating something false about every
 * founder, every week, and the more of the sprint was left the worse it was.
 */

const sprint = readFileSync("src/components/SprintBuddy.tsx", "utf-8");
const grid = sprint.slice(sprint.indexOf("function Cohort("), sprint.indexOf("function Cohort(") + 9000);

describe("weeks that have not happened", () => {
  test("are drawn as something other than a cell", () => {
    expect(grid).toContain("const future = i + 1 > week;");
    expect(grid).toContain('`${t.name}, ${WEEKS[i]}, not reached yet`');
  });

  test("are not clickable, so they cannot be read as data", () => {
    expect(grid).toContain("disabled={future}");
  });

  test("the legend says what that mark means", () => {
    expect(grid).toContain("Not reached yet");
  });
});

describe("the current week", () => {
  test("is marked in the header", () => {
    expect(grid).toContain("i + 1 === week ? C.ink : C.faint");
    expect(grid).toContain("i + 1 === week ? 700 : 400");
  });
});

describe("every cell has a name", () => {
  test("not just a native tooltip", () => {
    /*
     * Fifteen buttons per row with a `title` and no accessible name is fifteen
     * unlabelled buttons to a screen reader, and `title` never appears on a
     * touch screen at all.
     */
    expect(grid).toContain("aria-label={");
    expect(grid).toContain("${tempLabel(v)}");
  });
});

describe("row order", () => {
  test("puts whoever needs attention first", () => {
    // The page is called "where to put your attention"; the answer used to be
    // in whatever order the database returned.
    expect(grid).toContain("sortedTeams.map");
    expect(sprint).toContain("const sortedTeams = useMemo(");
  });

  test("is ordering only — colour never follows the row's position", () => {
    /*
     * The one thing a sorted heatmap must not do. A founder's colour comes
     * from tempColor(v) where v is their own check-in, and there is no index
     * anywhere in that call.
     */
    expect(grid).toContain("background: future");
    expect(grid).toContain("tempColor(v)");
    expect(grid).not.toMatch(/tempColor\([^)]*\bi\b[^)]*\)/);
  });
});
