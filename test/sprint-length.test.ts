import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "bun:test";
import { TOTAL_WEEKS, weekForDate } from "../src/lib/sprint-calendar";

/**
 * The programme is as long as the programme.
 *
 * F26 runs Tuesday 8 September to Thursday 3 December 2026. That is 86 days —
 * twelve whole weeks and two days over — so counting the week of the 8th as
 * week one, the 3rd falls inside week thirteen.
 *
 * TOTAL_WEEKS was 15, from an earlier plan, and nothing failed on it. That is
 * the point: the heatmap drew two columns no check-in could reach, week themes
 * offered two rows nobody would ever fill, and a deadline could be filed into
 * a week that does not happen. A number that is merely wrong, with everything
 * downstream faithfully agreeing with it.
 *
 * So this file pins the number to the dates rather than to itself, and pins
 * the places that used to carry their own copy of it.
 */

const START = "2026-09-08";
const END = "2026-12-03";
const DAY = 86_400_000;
/* weekForDate reads the start from the environment at call time, so this sets
   it rather than depending on how the suite happens to be invoked. CI sets the
   same value; a standalone run of this file should not need it to. */
beforeAll(() => { process.env.SPRINT_START_DATE = START; });

const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
};

describe("the length follows the dates", () => {
  test("8 September to 3 December is thirteen weeks", () => {
    /* Derived here rather than asserted as a bare 13, so that changing the
       cohort's dates changes what this expects. */
    const span = (day(END) - day(START)) / DAY;
    expect(span).toBe(86);
    expect(Math.floor(span / 7) + 1).toBe(TOTAL_WEEKS);
  });

  test("the last day of the programme is inside the last week", () => {
    /*
     * The boundary that matters. At 15 this passed while being wrong, because
     * a longer programme trivially contains its own end; the failure is at the
     * other edge, below.
     */
    expect(weekForDate(new Date(day(END)))).toBe(TOTAL_WEEKS);
  });

  test("the day after the last week is outside the programme", () => {
    // weekForDate returns null outside, rather than clamping — which is what
    // stops the advisor announcing a week that does not exist.
    const afterEnd = new Date(day(START) + TOTAL_WEEKS * 7 * DAY);
    expect(weekForDate(afterEnd)).toBeNull();
  });

  test("the first day is week one", () => {
    expect(weekForDate(new Date(day(START)))).toBe(1);
  });
});

describe("nothing keeps its own copy of the number", () => {
  const read = (p: string) => readFileSync(p, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("the deadline week bound is the programme length", () => {
    /*
     * It was `week > 15` next to an error message that also said 15. Two
     * copies of a number that is not written down anywhere near the constant
     * it is meant to match.
     */
    const api = read("src/pages/api/deadlines.ts");
    expect(api).toContain("week > TOTAL_WEEKS");
    expect(api).not.toMatch(/between 1 and 15/);
  });

  test("the heatmap draws as many columns as there are weeks", () => {
    /*
     * `Array.from({ length: 15 })` and `repeat(15, 24px)` at module scope,
     * while the server sent the real number in the same payload the grid was
     * rendering from.
     */
    const app = read("src/components/SprintBuddy.tsx");
    expect(app).toContain("const weekLabels = (total: number)");
    expect(app).toContain("cohort?.totalWeeks");
    expect(app).toMatch(/repeat\(\$\{totalWeeks\}, 24px\)/);
    expect(app).not.toMatch(/length: 15 \}/);
  });

  test("an optimistic theme arc is as long as a real one", () => {
    // Built client-side at 15 while the server built 13, so a theme touched in
    // this session rendered two cells longer than one loaded from the server.
    const app = read("src/components/SprintBuddy.tsx");
    expect(app).not.toContain("Array(15).fill(0)");
    expect(app).toContain("existing[0]?.arc.length");
  });

  test("the deadline form's week input is capped from the programme", () => {
    // Left at a hard max=15 it accepted weeks the server then refused, with a
    // message naming a different number.
    expect(read("src/pages/admin.astro")).toContain('weekInput.max = String(totalWeeks)');
  });
});
