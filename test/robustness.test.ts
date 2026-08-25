import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * The bug sweep.
 *
 * Every case here was reproduced before it was fixed, and every one of them
 * failed *silently* — no error a founder would see, no failing test, nothing
 * in a log anybody reads.
 */

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const boundary = readFileSync("src/components/ErrorBoundary.tsx", "utf-8");
/* Comments stripped: the code carries a note naming the very call the test
   forbids, and a check that cannot tell a prohibition from its violation is
   not a check. */
const boundaryCode = strip(boundary);
const root = readFileSync("src/components/Root.tsx", "utf-8");
const index = readFileSync("src/pages/index.astro", "utf-8");
const tasks = readFileSync("src/components/Tasks.tsx", "utf-8");
const persistence = readFileSync("src/lib/persistence.ts", "utf-8");
const admin = readFileSync("src/pages/admin.astro", "utf-8");
const sprint = readFileSync("src/components/SprintBuddy.tsx", "utf-8");

describe("a render failure does not blank the app", () => {
  test("there is a boundary, with both halves of the contract", () => {
    // getDerivedStateFromError switches the UI; componentDidCatch records it.
    // One without the other is half a boundary.
    expect(boundary).toContain("static getDerivedStateFromError()");
    expect(boundary).toContain("componentDidCatch(");
  });

  test("it is mounted as one island, not two nested ones", () => {
    /*
     * The bug this encodes: writing
     *   <ErrorBoundary client:only><App client:only /></ErrorBoundary>
     * in the page gives each its own React tree, so the boundary never sees
     * the app throw. Verified by forcing a render failure and watching the
     * page go black anyway. Root is the fix — one component, one island.
     */
    expect(root).toContain("<ErrorBoundary>");
    expect(root).toContain("<App />");
    expect(index).toContain('<Root client:only="react" />');
    expect(index).not.toContain("<ErrorBoundary client:only");
  });

  test("the handler cannot itself throw", () => {
    /*
     * reportError reads process.env for the Sentry DSN, which does not exist
     * in a browser bundle. Calling it from componentDidCatch would throw
     * inside the one handler that must not.
     */
    expect(boundaryCode).not.toContain("reportError");
    expect(boundaryCode).not.toContain("process.env");
    expect(boundaryCode).toContain("console.error");
  });

  test("the fallback depends on nothing that could be the broken thing", () => {
    // It renders after something has already gone wrong, so no design tokens,
    // no webfont, no shared components.
    expect(boundaryCode).not.toContain("var(--");
    expect(boundaryCode).not.toMatch(/^import .* from "\.\//m);
  });
});

describe("payload shapes", () => {
  test("a deadlines response without progress does not throw", () => {
    // Reproduced: a 200 whose body lacked this one key took out the entire
    // app — black screen, no message, reload failed the same way.
    expect(tasks).toContain("data.progress ?? { completed: 0, total: 0 }");
  });

  test("an unparseable working-genius row does not discard the whole account", () => {
    /*
     * loadUserData is awaited inside a try in App.enter, so a throw here does
     * not surface: the founder signs in with no threads, no check-ins and no
     * history, and nothing says why. The takes mapping directly above already
     * guarded exactly this; this block did not.
     */
    const block = persistence.slice(
      persistence.indexOf("primary: row.primary_type"),
    ).slice(0, 700);
    expect(block).toContain("catch");
    // Both parses have to be inside the guard, not just one.
    expect(block.indexOf("JSON.parse(row.counts_json)")).toBeGreaterThan(-1);
    expect(block.indexOf("try {")).toBeLessThan(block.indexOf("JSON.parse(row.counts_json)"));
  });

  test("a knowledge response without a size block does not render NaN", () => {
    // approxTokens was already guarded and the percentage was not, so the
    // operator saw "NaN% of the budget".
    expect(admin).toContain("size.budgetChars\n          ? Math.round(((size.chars || 0) / size.budgetChars) * 100)\n          : 0;");
  });
});

describe("colour means one thing", () => {
  test("no theme borrows a status colour", () => {
    /*
     * Runway and Self-doubt were painted in C.red — the same red as "Needs
     * attention" and an overdue deadline — so the word Runway in "most of it
     * circled Runway" read as an alarm. Survivable while the accent was red
     * too; not now that red means exactly one thing.
     */
    const block = sprint.slice(
      sprint.indexOf("const THEME_COLOR"),
      sprint.indexOf("const themeColor"),
    );
    expect(block.length).toBeGreaterThan(50);
    for (const status of ["C.red", "C.yellow", "C.green", "C.accent"]) {
      expect(block).not.toContain(status);
    }
  });

  test("an unlisted theme gets its own colour, not a neighbour's", () => {
    expect(sprint).toContain("THEME_FALLBACK");
    expect(sprint).toContain("THEME_COLOR[t] || THEME_FALLBACK");
  });

  test("the hues are fixed to the theme, not to its rank", () => {
    // Colour that moves when the set changes is worse than no colour.
    const block = sprint.slice(sprint.indexOf("const THEME_COLOR"), sprint.indexOf("const THEME_FALLBACK"));
    expect(block).toMatch(/Runway: "#[0-9a-f]{6}"/);
    expect(block).not.toContain("[index");
    expect(block).not.toContain("% RAMP");
  });
});

describe("the admin page on a phone", () => {
  test("row actions are reachable at 390px", () => {
    /*
     * The people table is five columns and the last one holds the only buttons
     * on the row. At 390px it ran off the side of the screen: you could read
     * the cohort on a phone and do nothing to it. Each row becomes a block.
     */
    expect(admin).toMatch(/@media \(max-width: 700px\) \{[\s\S]*?\.panel table, \.panel tbody, \.panel tr, \.panel td \{ display: block/);
    expect(admin).toContain('actions.className = "row-actions"');
    expect(admin).not.toContain('actions.style.textAlign');
  });

  test("nothing sits under the quick-actions trigger", () => {
    // It is fixed to the corner, so the page needs somewhere to end.
    expect(admin).toMatch(/@media \(max-width: 700px\) \{[\s\S]*?main \{ padding-bottom: 96px; \}/);
  });

  test("a status pill stays on one line", () => {
    // "not set up" broke over three lines the moment the column was narrow.
    expect(admin).toContain(".pill { white-space: nowrap; }");
  });
});

describe("form spacing", () => {
  test("a field row after explanatory copy is not flush against it", () => {
    // .note ends with margin-bottom 0, so the first uppercase field label read
    // as one more line of the paragraph.
    expect(admin).toContain(".note + .row,");
    expect(admin).toContain("margin-top: 16px;");
  });
});
