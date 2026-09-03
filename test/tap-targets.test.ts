import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * Controls big enough to hit, and small text with enough contrast to read.
 *
 * These came out of measuring every screen in a browser rather than reading
 * the CSS. Both faults are the kind nothing reports: a 21px button works
 * perfectly with a mouse and is a coin-toss with a thumb, and 4.16:1 looks
 * fine to whoever picked the colour on the monitor they picked it on.
 *
 * WCAG 2.2 puts the floor for a target at 24x24 CSS px, and 4.5:1 for text
 * below 18.66px bold / 24px regular. The measured numbers are in the comments
 * so the next person can tell a considered value from a copied one.
 */

const admin = readFileSync("src/pages/admin.astro", "utf-8");
const library = readFileSync("src/components/Library.tsx", "utf-8");

/* Comments stripped: several rules carry notes quoting the very values these
   assertions rule out. */
const adminCss = (() => {
  const s = admin.indexOf("<style is:global>");
  return admin.slice(s, admin.indexOf("</style>")).replace(/\/\*[\s\S]*?\*\//g, "");
})();

/** The declaration block for one selector, comments already gone. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(selector + " {");
  expect(`${selector} exists`).toBe(at >= 0 ? `${selector} exists` : `${selector} missing`);
  return css.slice(at, css.indexOf("}", at));
}

describe("anything you tap is at least 24px tall", () => {
  /*
   * Measured before the fix, on a full F26 programme:
   *   .pr-actions button   43x21   (the week list — 29 of them)
   *   .ev-actions button   43x24   (the dates list — exactly the floor)
   *   .bc-tag              97x23
   *   label.inline        124x22   (the target for a 16px checkbox inside it)
   *   #tab-broadcast summary      20px
   *   .bk-note summary            15px
   *   .li-booknote summary        15px  (founder-facing)
   */
  const needsMinHeight: [string, string][] = [
    ["the week list's Edit and Remove", ".pr-actions button"],
    ["the dates list's Edit and Remove", ".ev-actions button"],
    ["the broadcast merge-tag chips", ".bc-tag"],
    ["a checkbox's label, which is the real target", ".inline"],
    ["the book-note disclosure", ".bk-note summary"],
    ["the loan-history disclosure", ".bk-history summary"],
  ];

  for (const [what, selector] of needsMinHeight) {
    test(`${what} has a floor`, () => {
      const body = rule(adminCss, selector);
      const match = body.match(/min-height:\s*(\d+)px/);
      expect(`${selector} sets min-height`).toBe(match ? `${selector} sets min-height` : `${selector} does not`);
      expect(Number(match![1])).toBeGreaterThanOrEqual(24);
    });
  }

  test("the founder's book-note disclosure has one too", () => {
    // Different component, same 15px fault: admin calls it .bk-note, the
    // founder app calls it .li-booknote, and only one of them was fixed first.
    const css = library.replace(/\/\*[\s\S]*?\*\//g, "");
    const body = css.slice(css.indexOf(".li-booknote summary {"), css.indexOf("}", css.indexOf(".li-booknote summary {")));
    const match = body.match(/min-height:\s*(\d+)px/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(24);
  });
});

describe("small text carries its contrast", () => {
  test("the organizer's own avatar is not dark ink on the base indigo", () => {
    /*
     * 12px initials. #0b0c0f on --accent (#5e6ad2) measures 4.16:1 against the
     * 4.5 that size asks for; on --accent-hover (#6e79d6) it is 5.0:1. White
     * on the base indigo was the other candidate and only reaches 4.42, so the
     * lighter disc is the one that clears it.
     */
    expect(adminCss).toMatch(/\.avatar\.you\s*\{[^}]*background:\s*var\(--accent-hover\)/);
  });

  test("the organizer role pill is not the base indigo on the panel", () => {
    // 4.05:1 on --accent, 4.87:1 on --accent-hover, at 12px.
    expect(adminCss).toMatch(/\.pill\.organizer\s*\{[^}]*color:\s*var\(--accent-hover\)/);
  });

  test("the pill's border may stay the base indigo", () => {
    /*
     * Deliberate, not an oversight. A 1px edge is a boundary, held to 3:1 and
     * not 4.5:1, and the base indigo clears that — so the border keeps the
     * family colour while the text takes the lighter step.
     */
    expect(adminCss).toMatch(/\.pill\.organizer\s*\{[^}]*border-color:\s*rgba\(94, 106, 210/);
  });
});

describe("no rule asks for a colour that does not exist", () => {
  test("every var() in the admin stylesheet names a token it defines", () => {
    /*
     * This already happened twice. A var() naming nothing makes the whole
     * declaration invalid at computed-value time and the browser says nothing:
     * eighteen declarations were in that state, and .ev-row's border computed
     * to 0px, so forty-five rows had no separators at all.
     */
    const defined = new Set([...adminCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
    const used = [...new Set([...adminCss.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]!))];
    expect(used.filter((name) => !defined.has(name))).toEqual([]);
  });
});
