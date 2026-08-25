import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The wordmark above the sign-in fields.
 *
 * Each of the programme's three names arrives as noise and resolves into
 * itself. The animation is judged by watching it; what is pinned here is the
 * copy, and the decisions that are silent when they go wrong.
 */

const scramble = readFileSync("src/components/ScrambleText.tsx", "utf-8");
const app = readFileSync("src/components/App.tsx", "utf-8");
const css = readFileSync("src/pages/index.astro", "utf-8");
/* The component's comments name the faults it fixes, so "must not contain"
   checks read a comment-stripped copy. */
const code = scramble.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("what it says", () => {
  test("the three names, in order", () => {
    expect(app).toContain(
      'const PROGRAMME_NAMES = ["Aalto Founder School", "Aalto Founder Sprint", "Sprint Buddy \\u276F"]',
    );
  });

  test("it sits above the sign-in fields, inside the panel", () => {
    const panel = app.slice(
      app.indexOf('<div className="login-panel"'),
      app.indexOf('<form className="login-form"'),
    );
    expect(panel).toContain("<ScrambleText texts={PROGRAMME_NAMES} />");
  });

  test("the page keeps a readable heading", () => {
    /*
     * The characters change dozens of times a second, so a screen reader
     * following them would get a stream of noise. They are aria-hidden, which
     * makes the .sr-only h1 the only title the page has.
     */
    expect(scramble).toContain('aria-hidden="true"');
    expect(app).toContain('<h1 id="login-title" className="sr-only">Sprint Buddy</h1>');
    expect(app).toContain('aria-labelledby="login-title"');
  });
});

describe("the scramble", () => {
  test("it brought no dependencies with it", () => {
    // The supplied component pulls in motion/react for a useInView it does not
    // need here: this is on screen the moment the page is.
    const imports = [...scramble.matchAll(/^\s*import[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]!);
    expect(imports).toEqual(["react"]);
    expect(code).not.toContain("useInView");
  });

  test("one chained timeout, not an interval rebuilt every step", () => {
    /*
     * The supplied version lists its step counter in the dependencies of the
     * effect that owns the interval, so it clears and recreates one on every
     * animation step: eighty per pass on a twenty-character line.
     */
    expect(code).not.toContain("setInterval");
    expect(code).toContain("window.setTimeout(tick");
    expect(code).toContain("window.clearTimeout(timer)");
  });

  test("it steps by code point, not by code unit", () => {
    // text[i] splits anything outside the basic plane into two broken halves.
    expect(code).toContain("[...texts[0]!]");
    expect(code).toContain("[...texts[index]!]");
  });

  test("the box is held at the width of the longest name", () => {
    /*
     * This is the difference between an effect and a page that shakes. The
     * noise alphabet is nothing like the letters it stands in for, so without
     * a gauge the line is sized by whatever is on screen this frame and the
     * fields below jog for the whole animation. Measured after: the box holds
     * at the panel's full width and never changes.
     */
    expect(code).toContain("const widest = texts.reduce");
    expect(scramble).toContain('<span className="scramble-gauge">{widest}</span>');
    expect(css).toMatch(/\.scramble-gauge \{[^}]*visibility: hidden/s);
    expect(css).toMatch(/\.scramble-live \{[^}]*position: absolute/s);
  });

  test("the unfilled tail holds its width", () => {
    // Padding with real spaces lets HTML collapse them, so the line has no
    // width until the first tick and everything below it jumps.
    expect(code).toContain('out.push("\\u00A0")');
  });

  test("reduced motion just shows a name", () => {
    // A line shaking itself out of static is exactly what that setting is for.
    expect(code).toContain('window.matchMedia("(prefers-reduced-motion: reduce)").matches');
    expect(code).toContain("setShown(texts[0]!)");
  });
});

describe("the sizing", () => {
  test("it is sized against the panel, not the viewport", () => {
    /*
     * Measured when this was first set: sized in vw, the longest of the three
     * names drifted against the panel as the viewport and the panel's
     * max-width diverged. In cqw it holds its proportion everywhere.
     *
     * The numbers themselves are not pinned — they moved once already when the
     * type scale was rebuilt, and a test that fails on a size change is a test
     * that gets edited rather than read. What matters is the pair and the
     * order.
     */
    expect(css).toMatch(/\.login-panel \{[^}]*container-type: inline-size/s);

    /* Comments stripped before comparing order: the explanation above the rule
       names cqw, so indexOf would find the prose and report the fallback as
       coming second. */
    const block = css
      .slice(css.indexOf("  .scramble {"), css.indexOf("  .scramble-gauge {"))
      .replace(/\/\*[\s\S]*?\*\//g, "");

    const sizes = [...block.matchAll(/font-size: clamp\([^)]*\);/g)].map((m) => m[0]!);
    expect(sizes.length).toBe(2);
    /* The vw line first, as the fallback: a browser without container queries
       treats the cqw declaration as invalid and keeps whichever came before
       it. Reverse these two and such a browser gets no size at all. */
    expect(sizes[0]).toContain("vw");
    expect(sizes[0]).not.toContain("cqw");
    expect(sizes[1]).toContain("cqw");
  });
});

describe("what it replaced", () => {
  test("nothing is left of the melt, or of the headline before it", () => {
    expect(app).not.toContain("MorphingText");
    expect(app).not.toContain("Headline");
    for (const gone of [".morph-line", ".morph-filter", "morph-threshold", ".headline-letter", "@keyframes flow-a"]) {
      expect(css).not.toContain(gone);
    }
  });
});
