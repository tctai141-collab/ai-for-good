import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The morphing wordmark above the sign-in fields.
 *
 * The melt itself is two blurs under a threshold filter and can only be judged
 * by looking at it. What is pinned here is the handful of things that are
 * silent when wrong.
 */

const morph = readFileSync("src/components/MorphingText.tsx", "utf-8");
const app = readFileSync("src/components/App.tsx", "utf-8");
const css = readFileSync("src/pages/index.astro", "utf-8");
/* The component's comments name the faults it fixes, so the "must not
   contain" checks read a comment-stripped copy. */
const code = morph.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("what it says", () => {
  test("the three names, in order", () => {
    expect(app).toContain(
      'const PROGRAMME_NAMES = ["Aalto Founder School", "Aalto Founder Sprint", "Sprint Buddy \\u276F"]',
    );
  });

  test("it sits above the sign-in fields, inside the panel", () => {
    const panel = app.slice(app.indexOf('<div className="login-panel"'), app.indexOf("<form className=\"login-form\""));
    expect(panel).toContain("<MorphingText texts={PROGRAMME_NAMES} />");
  });

  test("the page keeps a readable heading", () => {
    /*
     * Both lines are rewritten by textContent every frame, so a screen reader
     * following them would get a stream of half-finished words. They are
     * aria-hidden, which means the .sr-only h1 is the only title the page has
     * and has to stay.
     */
    expect(morph).toContain('aria-hidden="true"');
    expect(app).toContain('<h1 id="login-title" className="sr-only">Sprint Buddy</h1>');
    expect(app).toContain('aria-labelledby="login-title"');
  });
});

describe("the melt", () => {
  test("it brought no dependencies with it", () => {
    const imports = [...morph.matchAll(/^\s*import[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]!);
    expect(imports).toEqual(["react"]);
  });

  test("it is typed", () => {
    // The supplied component opens with a blanket ts-nocheck.
    expect(code).not.toContain("ts-nocheck");
  });

  test("the blur scales with the type size", () => {
    /*
     * This is the bug that made the first attempt unreadable. The supplied
     * component blurs by a fixed `8 / fraction - 8` pixels, tuned for the
     * ~96px display type in its demo. At the size this sits at above the
     * fields, that is proportionally three times too strong, and the threshold
     * filter turned both lines into blobs. In em it scales with whatever size
     * the wordmark is set at.
     */
    expect(code).toContain("em)`");
    expect(code).not.toMatch(/blur\(\$\{[^}]*\}px\)/);
  });

  test("it is sized against the panel, not the viewport", () => {
    /*
     * Measured: at the first size the longest of the three names filled 72% of
     * the panel, which is what made it read as small beside the fields instead
     * of as their heading. Sizing in cqw against .login-panel puts it at ~93%
     * and holds that proportion at every viewport, rather than drifting as vw
     * and the panel's max-width diverge.
     *
     * The vw declaration stays as the fallback: a browser without container
     * queries treats the cqw one as invalid and keeps it.
     */
    expect(css).toMatch(/\.login-panel \{[^}]*container-type: inline-size/s);
    expect(css).toContain("font-size: clamp(1.5rem, 10.2cqw, 2.9rem)");
    expect(css).toContain("font-size: clamp(1.5rem, 4.3vw, 2.75rem)");
    /* Comments stripped before comparing order: the explanation above the rule
       names 10.2cqw, so indexOf found the prose rather than the declaration
       and reported the fallback as coming second. */
    const morph = css
      .slice(css.indexOf("  .morph {"), css.indexOf("  .morph-line {"))
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(morph).toContain("4.3vw");
    expect(morph.indexOf("4.3vw")).toBeLessThan(morph.indexOf("10.2cqw"));
  });

  test("the fraction is clamped off both ends", () => {
    // At exactly 0 the supplied version computes 8/0 - 8 = Infinity and writes
    // blur(Infinitypx), which is invalid, so the browser drops the declaration
    // and the outgoing line snaps instead of melting.
    expect(code).toContain("Math.min(Math.max(fraction, 0.001), 0.999)");
  });

  test("the frame time comes from the frame, not from a new Date each tick", () => {
    expect(code).not.toContain("new Date()");
    expect(code).toContain("const tick = (now: number)");
  });

  test("the filter id is namespaced", () => {
    /*
     * SVG filter ids are global to the document. The supplied component calls
     * its filter `threshold`, and this app renders other filters into the same
     * page; a collision would silently apply the wrong one.
     */
    expect(code).toContain('id="morph-threshold"');
    expect(code).not.toMatch(/id="threshold"/);
    expect(css).toContain("url(#morph-threshold)");
  });

  test("it stops when the tab is hidden, and resets its clock on return", () => {
    // Without the reset, a tab left in the background comes back and jumps
    // several names at once as the accumulated delta is applied in one frame.
    expect(code).toContain('document.addEventListener("visibilitychange", onVisibility)');
    expect(code).toContain("last = 0;");
    expect(code).toContain('document.removeEventListener("visibilitychange", onVisibility)');
    expect(code).toContain("cancelAnimationFrame(frame)");
  });

  test("reduced motion holds one line and drops the filter", () => {
    // The threshold is only worth its cost while something moves through it.
    expect(code).toContain('window.matchMedia("(prefers-reduced-motion: reduce)").matches');
    expect(css).toMatch(/prefers-reduced-motion[\s\S]{0,220}\.morph \{ filter: none; \}/);
  });
});

describe("what it replaced", () => {
  test("the full-bleed headline is gone, and so is its CSS", () => {
    // Tai: too big, and ugly. Leaving the rules behind is how a stylesheet
    // ends up with blocks nobody dares delete.
    expect(app).not.toContain("Headline");
    for (const gone of [".headline-letter", ".headline-line", "--flow-a", "@keyframes flow-a"]) {
      expect(css).not.toContain(gone);
    }
  });
});
