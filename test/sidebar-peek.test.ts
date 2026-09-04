import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * The peek panel is a hover affordance, and asks whether hover exists.
 *
 * Collapsing the sidebar leaves a rail of icons, and resting a pointer on it
 * opens the full 304px panel *over* the page — deliberately over rather than
 * beside, so the conversation underneath does not reflow every time the
 * pointer crosses the left edge.
 *
 * That reasoning holds while there is a pointer. On a phone there is not, and
 * the browser synthesises the mouse events regardless: one tap near the rail
 * fires mouseover, the panel opens at the top-left corner at z-index 60, and
 * the mouseout that would close it may never arrive because nothing is
 * hovering. Reproduced in the harness by dispatching a single mouseover: a
 * 304px panel carrying the cohort list, covering 240px of the page.
 *
 * That is what an organizer reported twice as the cohort view sitting on top
 * of everything in the top-left corner.
 *
 * The runtime half of this cannot be tested here — a headless viewport does
 * not narrow and does not stop hovering — so these read the source, and the
 * desktop behaviour is what gets checked in a browser.
 */

const source = readFileSync("src/components/SprintBuddy.tsx", "utf-8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("peek only happens where a pointer can rest", () => {
  test("opening it is guarded by whether the device hovers", () => {
    /*
     * The guard is on the open, not the close. mouseleave clearing peek is
     * harmless anywhere and is the thing that rescues a device which fires one
     * but not the other.
     */
    expect(code).toContain("if (!open && canHover) setPeek(true)");
    expect(code).toContain("onMouseLeave={() => setPeek(false)}");
  });

  test("the question asked is (hover: hover), not a touch sniff", () => {
    /*
     * What this needs to know is whether a pointer can rest on something
     * without committing to a tap, which is exactly what the media feature
     * answers. A laptop with a touchscreen still hovers; a phone never does.
     * Sniffing for touch support would take the panel away from the laptop.
     */
    expect(code).toContain('window.matchMedia("(hover: hover)")');
    expect(code).not.toMatch(/ontouchstart|maxTouchPoints/);
  });

  test("losing hover closes a panel that is already open", () => {
    // Otherwise a tablet that switches to touch keeps the overlay it opened
    // with a trackpad, with no way left to dismiss it.
    expect(code).toMatch(/if \(!media\.matches\) setPeek\(false\)/);
  });

  test("the listener is removed when the view goes away", () => {
    const effect = code.slice(code.indexOf('window.matchMedia("(hover: hover)")'));
    expect(effect.slice(0, 400)).toContain("removeEventListener");
  });
});

describe("what the panel still is on a desktop", () => {
  test("it opens over the page rather than pushing it sideways", () => {
    /*
     * Unchanged, and worth pinning: expanding in place would reflow the
     * conversation under the reader every time the pointer crossed the edge,
     * which is the reason it overlays in the first place.
     */
    expect(code).toMatch(/position: "absolute", top: 0, left: 0, height: "100%", width: 304/);
    expect(code).toContain("zIndex: 60");
  });

  test("the rail is what remains when it cannot peek", () => {
    // The icons stay visible and clickable at every width — on a phone that
    // is the whole navigation, and tapping one is how you get anywhere.
    expect(code).toContain('aria-label="Expand sidebar"');
    expect(code).toContain("media.matches ? 48 : 64");
  });
});
