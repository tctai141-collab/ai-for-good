import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * The two organizer pills, and the corner they were parked in.
 *
 * "Cohort view" and "Cohort admin" are fixed to the top of the screen at
 * z-index 40, pinned from the right so they clear the docked mascot in the
 * top-right corner. On a phone that mascot is display: none — so the offsets
 * were dodging something that was not there, and walking backwards into the
 * rail on the left instead.
 *
 * Measured on a 390pt screen: "Cohort view" is 100px wide at right 248, which
 * puts its left edge at 42, over a rail 48px wide. Fixed and at z-index 40, so
 * it sat on the rail and stayed there while the page scrolled underneath.
 *
 * Reported three times as buttons sitting on top of everything in the top-left
 * corner, and named exactly — "cohort view and cohort buttons" was the labels,
 * not the page. Two earlier fixes went after the wrong things because that was
 * read as a description of the cohort screen.
 *
 * The arithmetic is what these tests are: neither pill may reach the rail, and
 * they may not reach each other.
 */

const app = readFileSync("src/components/App.tsx", "utf-8");
const code = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The measured widths these offsets are derived from. */
const WIDTH = { view: 100, admin: 109 };
/** A 390pt phone, and the rail as it is below 700px. */
const PHONE = { viewport: 390, rail: 48, gap: 8 };

/** Left edge of a pill pinned `right` px from the right of a phone screen. */
const leftEdge = (right: number, width: number) => PHONE.viewport - right - width;

describe("the offsets a phone gets", () => {
  /*
   * Read out of the source rather than restated, so this checks the code and
   * not a copy of it — taken in document order, because both labels appear in
   * prose elsewhere in the file and searching by name finds the wrong one.
   * The order is asserted below rather than assumed.
   */
  const found = [...code.matchAll(/right: phone \? (\d+) : (\d+)/g)]
    .map((m) => ({ phone: Number(m[1]), desktop: Number(m[2]) }));

  test("there are exactly two of them, view first", () => {
    expect(found.length).toBe(2);
    const jsx = code.slice(code.indexOf("onClick={() => enterPreview()}"));
    expect(jsx.indexOf("Cohort view")).toBeLessThan(jsx.indexOf("Cohort admin"));
  });

  const [view, admin] = found as [{ phone: number; desktop: number }, { phone: number; desktop: number }];

  test("neither pill reaches the rail", () => {
    /*
     * The whole bug in one assertion. At the old offset this is 42 against a
     * rail of 48 and fails.
     */
    expect(leftEdge(view.phone, WIDTH.view)).toBeGreaterThanOrEqual(PHONE.rail);
    expect(leftEdge(admin.phone, WIDTH.admin)).toBeGreaterThanOrEqual(PHONE.rail);
  });

  test("they do not reach each other either", () => {
    // Fixing one edge by walking into the other pill is not fixing it.
    const viewRight = leftEdge(view.phone, WIDTH.view) + WIDTH.view;
    expect(viewRight + PHONE.gap).toBeLessThanOrEqual(leftEdge(admin.phone, WIDTH.admin));
  });

  test("both stay on the screen", () => {
    expect(leftEdge(view.phone, WIDTH.view)).toBeGreaterThan(0);
    expect(admin.phone).toBeGreaterThanOrEqual(0);
  });

  test("the desktop offsets are untouched", () => {
    /*
     * There the mascot is real and these numbers are what clear it. The phone
     * is the exception, not the new rule.
     */
    expect(view.desktop).toBe(248);
    expect(admin.desktop).toBe(130);
  });
});

describe("how it knows", () => {
  test("it asks the same breakpoint the rail and the mascot use", () => {
    /*
     * 700px is where the sidebar becomes a rail and where the mascot is
     * hidden. Three things have to agree about what a phone is, or the pills
     * dodge a mascot that is still there, or fail to dodge a rail that is.
     */
    expect(code).toContain('window.matchMedia("(max-width: 700px)")');
  });

  test("it keeps up when the width changes", () => {
    // Rotating a tablet crosses this line without reloading.
    const effect = code.slice(code.indexOf('window.matchMedia("(max-width: 700px)")'));
    expect(effect.slice(0, 320)).toContain("addEventListener");
    expect(effect.slice(0, 320)).toContain("removeEventListener");
  });
});
