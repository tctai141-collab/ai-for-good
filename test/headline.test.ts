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

describe("the liquid fill", () => {
  test("it brought no shader dependency with it", () => {
    /*
     * The supplied component ran a WebGL metaballs shader from
     * @paper-design/shaders-react and masked it to the text with an SVG <text>
     * in a data URI. Two things ruled that out, both checked rather than
     * assumed: the mask cannot see a webfont, so asked for Source Serif 4 it
     * renders a generic serif 4.1% narrower with different letterforms and the
     * headline quietly changes typeface; and it loads an image from
     * shaders.paper.design, which this app's CSP blocks.
     */
    expect(headline).not.toContain("@paper-design");
    expect(css).not.toContain("shaders.paper.design");
    const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("@paper-design/shaders-react");
  });

  test("the flow is one sheet across the line, not twelve restarts", () => {
    /*
     * Each letter clips its own background to its own glyph, so without these
     * two properties every letter shows the same slice and the flow restarts
     * at each glyph. --lw sizes each letter's background to the whole line and
     * --x shifts it back by that letter's offset, so the slices line up.
     */
    expect(headline).toContain('setProperty("--lw"');
    expect(headline).toContain('setProperty("--x"');
    expect(css).toContain("var(--lw, 100%)");
    expect(css).toContain("var(--x, 0px)");
  });

  test("the drift keyframes are lengths, because the properties are registered as lengths", () => {
    /*
     * This shipped broken once. The properties are @property ... <length>, and
     * the first keyframes were written in percentages. A percentage is an
     * invalid value for a <length> property, so every keyframe was dropped
     * silently and --flow-a held at its 0px initial value: the blobs never
     * moved, and nothing errored.
     *
     * Percentages would have been wrong even if they had been accepted, since
     * background-position percentages resolve against each letter's own box,
     * which is the opposite of the single sheet above.
     */
    for (const name of ["--flow-a", "--flow-b", "--flow-c"]) {
      expect(css).toContain(`@property ${name} { syntax: "<length>"`);
    }
    const keyframes = css.slice(css.indexOf("@keyframes flow-a"), css.indexOf("@keyframes flow-c") + 200);
    expect(keyframes).toContain("calc(var(--lw, 100vw)");
    expect(keyframes).not.toMatch(/--flow-[abc]:\s*-?[\d.]+%/);
  });

  test("the headline is monochrome", () => {
    /*
     * Tai: black and white, no red. The brand red stays on the sign-in button
     * and the mascot; on the headline it fought both of them.
     *
     * The first version of this test sliced from ".headline-letter {" to
     * "@keyframes flow-a", but the keyframes are written above the letter rule,
     * so start came after end and the slice was empty. An empty string contains
     * nothing, so it passed with the red put back. Hence the length guard: a
     * test that cannot fail is worse than no test.
     */
    const start = css.indexOf(".headline-letter {");
    const end = css.indexOf("@media (prefers-reduced-motion: reduce)", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const block = css.slice(start, end);
    expect(block.length).toBeGreaterThan(500);
    expect(block).toContain("background-image:");

    for (const red of ["232, 23, 10", "253, 99, 96", "247, 225, 89", "--brand-accent", "--color-energy"]) {
      expect(block).not.toContain(red);
    }
  });

  test("reduced motion holds a frame with the blobs still on the line", () => {
    // animation: none on its own would leave the flow at its initial 0px,
    // which parks two of the three blobs off the end of the phrase.
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {", css.indexOf(".headline-letter {")));
    expect(reduced).toContain(".headline-line {");
    expect(reduced).toContain("--flow-a: calc(var(--lw, 100vw) * 0.22)");
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
