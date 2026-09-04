import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * The button that reopens the sidebar stays in the sidebar.
 *
 * Reported from an iPhone: a round button in the top-left corner sitting on
 * top of the cohort view. It was a rule left over from a design that had been
 * replaced. The sidebar used to collapse to zero width, leaving nothing on
 * screen to reopen it with, so the button was pinned to the corner of the
 * viewport with position: fixed and z-index 80. The rail replaced that — below
 * 700px the sidebar collapses to a 48px column and this button is the first
 * thing inside it — and the floating rule was never removed.
 *
 * The arithmetic of the overlap: a 40px button pinned at left 12 spans 12–52px
 * across a rail that ends at 48. It covered the rail, crossed into the content
 * and floated above both. Organizers saw it worst, because MobileActions
 * renders for founders only, so nothing else on their screen made room for it.
 *
 * These read the source. Neither the media query nor the phone can be
 * reproduced in the harness — a headless viewport does not narrow — so what is
 * checked is that the rule is gone and cannot come back unnoticed.
 */

const source = readFileSync("src/components/SprintBuddy.tsx", "utf-8");

/* Comments stripped: the rule that replaced this one describes it in prose,
   naming the very declarations these assertions forbid. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the rail's expand button", () => {
  test("is never taken out of the layout", () => {
    /*
     * Any of these three brings the bug back: fixed positioning lifts it off
     * the rail, and the offsets and stacking are what put it over the content
     * rather than merely beside it.
     */
    expect(code).not.toMatch(/\.sidebar-collapse-button\s*\{[^}]*position:\s*fixed/);
    expect(code).not.toMatch(/\.sidebar-collapse-button\s*\{[^}]*z-index/);
  });

  test("nothing in the phone rules positions it at all", () => {
    /*
     * Scoped to the breakpoint the phone actually uses, because that is where
     * the rule lived and where nobody was looking.
     */
    const mobile = code
      .split(/@media \(max-width: 700px\) \{/)
      .slice(1)
      .join("\n");
    expect(mobile).not.toContain("sidebar-collapse-button");
  });

  test("the rail is still the thing that holds it", () => {
    // The button is the first child of the rail column, and the rail keeps a
    // width on a phone — 48px — precisely so there is somewhere for it to be.
    expect(code).toContain('aria-label="Expand sidebar"');
    expect(code).toContain("media.matches ? 48 : 64");
  });
});

describe("the founder's mobile strip", () => {
  test("no longer holds space against a button that does not float", () => {
    /*
     * The 48px indent on the first row existed only to clear the floating
     * button. The strip already starts after the rail, so with the button back
     * in the rail the indent was pushing the check-in pill in from the edge
     * for no reason.
     */
    expect(code).not.toMatch(/\.mobile-actions-row:first-child\s*\{[^}]*padding-left:\s*48px/);
  });

  test("it is still a founder-only strip", () => {
    /*
     * Not a bug, but the reason organizers hit this hardest, and worth pinning
     * so the asymmetry is deliberate rather than forgotten: the check-in and
     * the deadline list it surfaces are founder things.
     */
    expect(code).toContain('{persona === "founder" && (');
    expect(code).toContain("<MobileActions");
  });
});
