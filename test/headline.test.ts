import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The login headline.
 *
 * Most of what this thing is, a bulge that follows the cursor across twelve
 * spans, is geometry a unit test cannot see; it was checked in the browser by
 * hovering every letter in turn and reading the transforms back. What is
 * pinned here is the part that is easy to break by accident and silent when
 * broken.
 */

const headline = readFileSync("src/components/Headline.tsx", "utf-8");
const app = readFileSync("src/components/App.tsx", "utf-8");
const css = readFileSync("src/pages/index.astro", "utf-8");

describe("the heading survives the decoration", () => {
  test("the login page still has an h1 that says the product's name", () => {
    /*
     * The visible title is twelve aria-hidden spans. If those were the only
     * "Sprint Buddy" on the page the login screen would have no heading at
     * all, and a screen reader would read the name out one letter at a time.
     */
    expect(app).toContain('<h1 id="login-title" className="sr-only">Sprint Buddy</h1>');
    expect(app).toContain('aria-labelledby="login-title"');
    expect(headline).toContain('aria-hidden="true"');
  });

  test("the name is one phrase, not words taking turns", () => {
    // It used to orbit on a ring with SPRINT on one seat and BUDDY opposite,
    // so the two halves of the name arrived nine seconds apart.
    expect(headline).toContain('const PHRASE = "SPRINT BUDDY"');
    expect(headline).not.toMatch(/\["SPRINT",\s*"BUDDY"\]/);
  });
});

describe("the bend", () => {
  test("it brought no dependencies with it", () => {
    /*
     * The supplied component rendered the text to a canvas, mapped it onto a
     * 150x150 plane and ran a vertex shader. The effect is the falloff curve,
     * and the letters here are already separate elements, so the same easing
     * on translateZ is the same picture without three or a render loop.
     *
     * Asserted on the import statements rather than the file text, because the
     * comment at the top names the packages to explain why they are gone.
     */
    const imports = [...headline.matchAll(/^\s*import[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]!);
    expect(imports).toEqual(["react"]);
  });

  test("positions are read from layout, not from the bent boxes", () => {
    /*
     * This is the bug that shipped twice. getBoundingClientRect on a letter
     * that is already lifted returns its *lifted* box, so measuring through it
     * feeds the effect its own output. Caching the rects instead swapped that
     * for a worse failure: the cache was taken before the serif had loaded, so
     * every centre was short and the bulge landed seven letters right of the
     * cursor.
     *
     * offsetLeft/offsetTop are layout values that transforms do not touch, so
     * there is nothing to invalidate and nothing to feed back.
     */
    expect(headline).toContain("letter.offsetLeft");
    expect(headline).toContain("letter.offsetTop");
    // The line's own rect is fine as an origin: the line is never transformed.
    expect(headline).toContain("line.getBoundingClientRect()");
    expect(headline).not.toMatch(/letter\.getBoundingClientRect|\.querySelectorAll[\s\S]{0,200}getBoundingClientRect\(\)\.left/);
  });

  test("the pointer listener is throttled to a frame and cleaned up", () => {
    // pointermove fires far faster than the display refreshes, and this writes
    // an inline style on twelve elements each time it runs.
    expect(headline).toContain("requestAnimationFrame(paint)");
    expect(headline).toContain('document.removeEventListener("pointermove", onMove)');
    expect(headline).toContain("cancelAnimationFrame(queued)");
  });

  test("reduced motion gets no bend at all", () => {
    // Not a slower bend: the listener is never attached.
    expect(headline).toContain('if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;');
  });
});

describe("the layout", () => {
  test("the line is a positioned flex row, which is what offsetLeft is measured against", () => {
    expect(css).toMatch(/\.headline-line \{[^}]*position: relative/s);
    expect(css).toMatch(/\.headline-line \{[^}]*transform-style: preserve-3d/s);
  });

  test("the letters can move in depth", () => {
    // translateZ does nothing without perspective on an ancestor.
    expect(css).toMatch(/\.headline \{[^}]*perspective:/s);
  });

  test("it never takes a pointer event", () => {
    // It spans the full width across the top of the login screen.
    expect(css).toMatch(/\.headline \{[^}]*pointer-events: none/s);
  });

  test("the login panel paints above it", () => {
    expect(css).toMatch(/\.login-panel \{[^}]*z-index: 10/s);
  });

  test("nothing is left of the ring it replaced", () => {
    // Dead CSS for a component that no longer exists is how a stylesheet ends
    // up with rules nobody dares delete.
    for (const gone of ["ring-orbit", "ring-fade", "ring-stage", "ring-word", "--ring-r"]) {
      expect(css).not.toContain(gone);
    }
    expect(app).not.toContain("WordRing");
  });
});
