import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * Editing the programme without leaving your place in it.
 *
 * Two complaints produced this file, and a third fault turned up underneath
 * them. Measured on a realistic F26 programme — fifteen weeks and forty-five
 * dated items — the Programme tab was 4,288px, five full screens, because it
 * carried both sections. The form sat above the list in each, so clicking Edit
 * on the last event scrolled 2,201px away from the row and left you to find it
 * again. And week themes had no Remove at all on any of the fifteen rows.
 *
 * The faults are cheap to reintroduce and invisible when you do, so each one
 * has a guard here rather than a note in a commit message.
 */

const source = readFileSync("src/pages/admin.astro", "utf-8");

/* Comments stripped before any assertion that forbids a string: several of the
   rules below carry notes quoting the very thing they rule out, and a check
   that cannot tell a prohibition from its violation is not a check. */
const CSS = (() => {
  const start = source.indexOf("<style is:global>");
  const end = source.indexOf("</style>");
  return source.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
})();

const SCRIPT = source
  .slice(source.indexOf("<script is:inline>"))
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("every colour and rule the page asks for exists", () => {
  test("no custom property is used without being defined", () => {
    /*
     * This is not hygiene, it is a rendering bug with no error attached.
     *
     * A `var(--x)` naming nothing makes the whole declaration invalid at
     * computed-value time, so the property silently falls back to its initial
     * value and the browser says nothing. Eighteen declarations were in that
     * state: `.ev-row`'s `border-bottom: 1px solid var(--line)` computed to
     * `0px`, so the forty-five rows of the programme list had no separators at
     * all, and `.ev-time`, `.ev-kind` and `.ev-month` all resolved to
     * `rgb(247,248,248)` — the same full white as the titles beside them, so
     * nothing in the list read as secondary.
     *
     * The names came from the app's own stylesheet, where they are all real;
     * this page calls the same things --muted, --border and --accent. The
     * comment beside the library table had already diagnosed exactly this for
     * one rule and fixed only that one.
     */
    const defined = new Set([...CSS.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
    const used = [...new Set([...CSS.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]!))];
    const undefinedTokens = used.filter((name) => !defined.has(name));
    expect(undefinedTokens).toEqual([]);
  });

  test("the programme rows are separated and their metadata is not full white", () => {
    // The two symptoms above, pinned directly so the intent survives a refactor.
    expect(CSS).toMatch(/\.ev-row\s*\{[^}]*border-bottom:\s*1px solid var\(--border\)/);
    expect(CSS).toMatch(/\.ev-time\s*\{[^}]*color:\s*var\(--muted\)/);
  });
});

describe("the form goes to the row, not the row to the form", () => {
  test("each list has a home for its form to return to", () => {
    expect(source).toContain('id="ev-form-home"');
    expect(source).toContain('id="pr-form-home"');
  });

  test("the form is homed before either list is rewritten", () => {
    /*
     * The sharp edge of the whole approach. `innerHTML` on the list destroys
     * its subtree, and while a row is being edited the live form node is
     * inside it — so a re-render at that moment deletes the form, taking the
     * half-typed values and every listener with it. Homing first is one line
     * and it is the only thing standing between an organizer and losing what
     * they were typing.
     */
    for (const [fn, home] of [["renderEvents", "homeEventForm"], ["renderProgramme", "homeWeekForm"]] as const) {
      const body = SCRIPT.slice(SCRIPT.indexOf(`function ${fn}(`));
      const homed = body.indexOf(`${home}()`);
      const written = body.indexOf(".innerHTML");
      expect(`${fn}: homes form`).toBe(`${fn}: ${homed >= 0 ? "homes form" : "does not"}`);
      expect(`${fn}: homes before writing`).toBe(`${fn}: ${homed < written ? "homes before writing" : "writes first"}`);
    }
  });

  test("clicking Edit does not scroll the page to the form", () => {
    /*
     * The old handler ended in scrollIntoView, which is what made editing the
     * last of forty-five events a 2,200px trip each way. The form now arrives
     * where the click was, and the focus call must not undo that.
     */
    expect(SCRIPT).not.toContain("evTitle.scrollIntoView");
    expect(SCRIPT).toContain("preventScroll: true");
  });

  test("the row that was clicked keeps its position across the re-render", () => {
    // Taking the form out of its home removes that height from above the
    // viewport, so everything below rides up — 264px, measured. Small enough
    // to read as a glitch, big enough to lose your place.
    expect(SCRIPT).toContain("function renderKeepingStill(");
    expect(SCRIPT).toContain("renderKeepingStill(");
  });
});

describe("a week can be removed", () => {
  test("every filled week row offers it", () => {
    expect(SCRIPT).toContain("data-delete-week=");
  });

  test("it asks first, and not with a browser modal", () => {
    /*
     * The page settled on a two-step armed button in five other places and
     * says why at each: a modal blocks everything to ask about one row. A week
     * theme is prose somebody wrote and is not recoverable from the page, so
     * it does get asked — just not like that.
     */
    const handler = SCRIPT.slice(SCRIPT.indexOf('getAttribute("data-delete-week")'));
    expect(handler).toContain('dataset.armed !== "yes"');
    expect(handler).toContain('"Sure?"');
    /* Scoped to this handler on purpose. One confirm() survives in the People
       section from before the convention existed; asserting page-wide here
       would be this test claiming a cleanup it did not do. */
    expect(handler.slice(0, handler.indexOf("loadProgramme()"))).not.toContain("confirm(");
  });

  test("an empty week offers Add instead, and nothing to remove", () => {
    // Removing a week that holds nothing is a button that does nothing.
    const render = SCRIPT.slice(SCRIPT.indexOf("function renderProgramme("));
    expect(render).toContain('w ? \'<button type="button" class="ghost danger" data-delete-week=');
  });

  test("all fifteen weeks are listed, not only the ones already written", () => {
    /*
     * The list showed stored rows only, so filling in week nine meant noticing
     * it was absent and finding it in a dropdown above. A fifteen-week
     * programme has fifteen rows whether or not anyone has written them yet.
     */
    const render = SCRIPT.slice(SCRIPT.indexOf("function renderProgramme("));
    expect(render).toContain("for (let week = 1; week <= totalWeeks; week++)");
  });
});

describe("the tab was split, and the quick action went with it", () => {
  test("week themes have their own tab and panel", () => {
    expect(source).toContain('class="tab" data-tab="weeks"');
    expect(source).toContain('id="tab-weeks"');
  });

  test("the week form lives in the weeks panel, not the programme one", () => {
    const weeks = source.slice(source.indexOf('id="tab-weeks"'));
    const panel = weeks.slice(0, weeks.indexOf('class="tabpanel"', 1));
    expect(panel).toContain('id="pr-phase"');
    expect(panel).toContain('id="programme-form"');
  });

  test("the dates form stayed in the programme panel", () => {
    const programme = source.slice(source.indexOf('id="tab-programme"'));
    const panel = programme.slice(0, programme.indexOf('id="tab-weeks"'));
    expect(panel).toContain('id="ev-title"');
    expect(panel).toContain('id="event-list"');
  });

  test("the quick action points at the tab that now holds its field", () => {
    /*
     * "Set the week" focuses pr-phase, which moved. admin-nav.test.ts checks
     * that every focus target really lives inside the tab named beside it, so
     * these two have to travel together or the fan drops somebody on a panel
     * that does not contain the field it is about to focus.
     */
    const quick = readFileSync("src/components/QuickActions.tsx", "utf-8");
    const item = quick.slice(quick.indexOf('focus: "pr-phase"') - 200, quick.indexOf('focus: "pr-phase"'));
    expect(item).toContain('tab: "weeks"');
  });
});

describe("the list opens on what is next", () => {
  test("months entirely behind us start folded", () => {
    // By week eight most of a fifteen-week programme is in the past, and the
    // row somebody came to change is nearly always the next one.
    expect(SCRIPT).toContain("openPastMonths");
    expect(SCRIPT).toContain("data-show-earlier");
  });

  test("the month you are in never folds away underneath you", () => {
    const render = SCRIPT.slice(SCRIPT.indexOf("function renderEvents("));
    expect(render).toContain("group.key < thisMonth");
  });

  test("the month heading stays put while its rows scroll", () => {
    expect(CSS).toMatch(/\.ev-month\s*\{[^}]*position:\s*sticky/);
    // Without a ground of its own the rows scroll through the text.
    expect(CSS).toMatch(/\.ev-month\s*\{[^}]*background:\s*var\(--panel\)/);
  });
});
