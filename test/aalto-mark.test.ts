import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * The Aalto mark, bottom right, on every screen.
 *
 * It ships as a slot with no artwork. The mark is a trademarked asset that has
 * to be the approved file rather than something reconstructed, so this is the
 * placement and the guard; the SVG goes in by hand.
 */

const mark = readFileSync("src/components/AaltoMark.astro", "utf-8");
const index = readFileSync("src/pages/index.astro", "utf-8");
const admin = readFileSync("src/pages/admin.astro", "utf-8");
const quick = readFileSync("src/components/QuickActions.tsx", "utf-8");

describe("where it appears", () => {
  test("both pages, from one component", () => {
    /*
     * index.astro carries the sign-in screen and the whole app, because the
     * app is a React island inside that same page. admin.astro is the other
     * half. One component so the two cannot drift.
     */
    for (const page of [index, admin]) {
      expect(page).toContain("<AaltoMark />");
      expect(page).toContain('import AaltoMark from "../components/AaltoMark.astro"');
    }
  });

  test("fixed in the bottom right, on top of nothing", () => {
    expect(mark).toContain("position: fixed");
    expect(mark).toContain("right: 26px");
    expect(mark).toContain("bottom: 26px");
  });
});

describe("what it must never do", () => {
  test("it does not intercept clicks", () => {
    // It sits over a composer somebody may be typing into.
    expect(mark).toContain("pointer-events: none");
  });

  test("it is not a link", () => {
    /*
     * It sits over a check-in somebody may be halfway through writing, and a
     * corner of the screen that navigates away from unsaved words is a corner
     * nobody should have put there.
     */
    expect(mark).not.toContain("<a ");
    expect(mark).not.toContain("href=");
  });

  test("it removes itself when the file is not there", () => {
    // A broken-image icon in the corner of a login screen is worse than
    // nothing, and the artwork is not in the repository.
    expect(mark).toContain('img.addEventListener("error"');
    expect(mark).toContain("box.remove()");
    expect(mark).toContain("hidden");
    // A cached image can finish loading before the listener is attached.
    expect(mark).toContain("img.complete");
  });

  test("no artwork is committed, invented or reconstructed", () => {
    /* If this ever fails, somebody has drawn a trademark from memory. The file
       is dropped in by hand from Aalto's own approved set. */
    expect(existsSync("public/aalto-logo.svg")).toBe(false);
    expect(mark).toContain("/aalto-logo.svg");
    expect(mark).not.toContain("<path");
    expect(mark).not.toContain("<svg");
  });
});

describe("it shares the corner", () => {
  test("the quick-actions button lifts clear of it", () => {
    // Both are fixed to the bottom right; the button floats above the mark.
    expect(quick).toContain("bottom: 68px");
    expect(quick).toContain(".qa { right: 16px; bottom: 52px; }");
  });
});
