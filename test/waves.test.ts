import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  AMP_X,
  AMP_Y,
  COLUMN_GAP,
  INFLUENCE,
  columns,
  falloff,
  makeNoise2D,
  rows,
  waveAngle,
  waveAt,
} from "../src/lib/waves";

/**
 * The sign-in waves.
 *
 * Same split, and the same reason, as the lattice this replaced: the canvas
 * and the loop cannot be watched from here, the geometry can, so the geometry
 * lives in a pure module. The noise being seeded rather than random is what
 * makes any of this assertable at all.
 *
 * The source assertions below are not style policing. Each one names a
 * property of the supplied component that had to be changed before it could
 * go on this page, and that would be silently undone by pasting the original
 * back over it.
 */

const component = readFileSync("src/components/Waves.tsx", "utf-8");
const lib = readFileSync("src/lib/waves.ts", "utf-8");
const index = readFileSync("src/pages/index.astro", "utf-8");
const pkg = readFileSync("package.json", "utf-8");
/** Comments stripped, for the assertions that forbid something the prose
    explaining the prohibition also mentions. */
const code = component.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the noise", () => {
  test("is the same field on every machine and every run", () => {
    /*
     * Seeded, not Math.random(). Without this the field differs per load,
     * which is invisible to a user and fatal to every assertion below.
     */
    const a = makeNoise2D(7);
    const b = makeNoise2D(7);
    for (const [x, y] of [[0.1, 0.2], [12.5, -3.25], [-100.5, 88.125]]) {
      expect(a(x!, y!)).toBe(b(x!, y!));
    }
    expect(makeNoise2D(7)(1.5, 2.5)).not.toBe(makeNoise2D(8)(1.5, 2.5));
  });

  test("stays inside [-1, 1]", () => {
    // The angle it feeds is scaled by SWIRL; an out-of-range sample would
    // spin a point further than its neighbours and tear the surface.
    const noise = makeNoise2D(7);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 4000; i++) {
      const v = noise(i * 0.37, i * 0.11);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBeGreaterThanOrEqual(-1);
    expect(hi).toBeLessThanOrEqual(1);
    // And it is actually varying, rather than a constant that would trivially
    // satisfy the bounds above.
    expect(hi - lo).toBeGreaterThan(0.5);
  });

  test("is continuous, so neighbouring points do not disagree", () => {
    /*
     * This is the property that makes it look like a surface. Adjacent points
     * are one COLUMN_GAP apart in space, which at FREQ_X is a small step in
     * noise space; if the value could jump there, the lines would shear.
     */
    const noise = makeNoise2D(7);
    let worst = 0;
    for (let i = 0; i < 500; i++) {
      const x = i * 0.013;
      worst = Math.max(worst, Math.abs(noise(x, 0.5) - noise(x + 0.003, 0.5)));
    }
    expect(worst).toBeLessThan(0.05);
  });

  test("leaves no seams along the axes", () => {
    /*
     * The reason this is simplex and not the value noise that would have been
     * half the length. Value noise on a square lattice is flat where it
     * crosses an integer boundary, and a background whose grid you can see is
     * the opposite of the point. Sampled either side of integers, the field
     * should still be moving.
     */
    const noise = makeNoise2D(7);
    let moved = 0;
    for (let i = -20; i < 20; i++) {
      if (Math.abs(noise(i - 0.01, 3.7) - noise(i + 0.01, 3.7)) > 1e-6) moved++;
    }
    expect(moved).toBeGreaterThan(35);
  });
});

describe("the motion", () => {
  test("a point never travels further than its amplitude", () => {
    // The field drifts; it does not wander off. If this can exceed the
    // amplitudes the lines cross each other and the weave turns to soup.
    const noise = makeNoise2D(7);
    for (let t = 0; t < 20000; t += 617) {
      const { x, y } = waveAt(noise, t % 900, (t * 7) % 600, t);
      expect(Math.abs(x)).toBeLessThanOrEqual(AMP_X + 1e-9);
      expect(Math.abs(y)).toBeLessThanOrEqual(AMP_Y + 1e-9);
    }
  });

  test("the offset is the angle, in the form the draw loop skips building", () => {
    /*
     * waveAngle exists only so the hot loop can avoid allocating an object per
     * point per frame. If the two ever disagree, the readable version stops
     * describing what actually runs.
     */
    const noise = makeNoise2D(7);
    const angle = waveAngle(noise, 40, 90, 1234);
    const offset = waveAt(noise, 40, 90, 1234);
    expect(offset.x).toBeCloseTo(Math.cos(angle) * AMP_X, 10);
    expect(offset.y).toBeCloseTo(Math.sin(angle) * AMP_Y, 10);
  });

  test("it is still moving a quarter of an hour in", () => {
    // Drift is a multiplier on the clock. Too small and the field is frozen
    // for anyone who leaves the tab open.
    const noise = makeNoise2D(7);
    const early = waveAt(noise, 100, 100, 0);
    const later = waveAt(noise, 100, 100, 15 * 60 * 1000);
    expect(Math.hypot(early.x - later.x, early.y - later.y)).toBeGreaterThan(1);
  });
});

describe("the pointer", () => {
  test("its pull is total at the centre and gone at the edge", () => {
    expect(falloff(0)).toBeCloseTo(1, 10);
    expect(falloff(INFLUENCE)).toBe(0);
    expect(falloff(INFLUENCE + 1)).toBe(0);
    expect(falloff(9999)).toBe(0);
  });

  test("it fades in and out rather than stopping at a rim", () => {
    /*
     * Smoothstep, not a linear ramp. A linear falloff leaves a visible circle
     * where the influence ends, which reads as a bug rather than as light.
     */
    const nearEdge = falloff(INFLUENCE * 0.95);
    const nearMiddle = falloff(INFLUENCE * 0.5);
    expect(nearEdge).toBeLessThan(0.02);
    expect(nearMiddle).toBeCloseTo(0.5, 1);
    // Monotonic: closer is always stronger.
    let previous = Infinity;
    for (let d = 0; d <= INFLUENCE; d += 5) {
      const v = falloff(d);
      expect(v).toBeLessThanOrEqual(previous);
      previous = v;
    }
  });

  test("a zero influence cannot divide by itself", () => {
    expect(falloff(10, 0)).toBe(0);
  });
});

describe("the field covers the window", () => {
  test("it is drawn wider and taller than the viewport", () => {
    /*
     * Overscan is what stops a line being seen to begin. Without it the first
     * and last columns end on screen and the field reads as a rectangle laid
     * on the page rather than as something running under it.
     */
    expect(columns(1440) * COLUMN_GAP).toBeGreaterThan(1440);
    expect(rows(900) * COLUMN_GAP).toBeGreaterThan(900);
  });

  test("a window of nothing still has a field", () => {
    // Guards the Math.max: a zero-width canvas must not produce a zero-length
    // loop that leaves the arrays unallocated.
    expect(columns(0)).toBeGreaterThanOrEqual(2);
    expect(rows(0)).toBeGreaterThanOrEqual(2);
  });
});

describe("what had to change about the supplied component", () => {
  test("it draws to a canvas, not to two hundred SVG paths", () => {
    /*
     * The original appends one <path> per line and rewrites every `d`
     * attribute each frame — at this spacing, twenty-four thousand segments
     * re-serialised into strings sixty times a second, on the first screen
     * anybody opens. Canvas draws the same pixels with no strings and no DOM.
     */
    expect(code).toContain("getContext(\"2d\")");
    expect(code).not.toContain("createElementNS");
    expect(code).not.toContain("setAttribute");
  });

  test("it brought no dependency with it", () => {
    /*
     * The original installs simplex-noise for one function. This repo has
     * eight dependencies deliberately and CI runs `bun audit` over them; the
     * generator is forty lines in src/lib/waves.ts and cannot need patching.
     */
    expect(pkg).not.toContain("simplex-noise");
    const imports = [...component.matchAll(/^\s*import[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]!);
    expect(imports).toEqual(["react", "../lib/waves"]);
  });

  test("it paints no background of its own", () => {
    /*
     * The original fills an opaque colour every frame. Here that would cover
     * the page's gradients and the halo behind the mascot, which are the
     * things the field is supposed to sit under.
     */
    expect(code).toContain("clearRect");
    expect(code).not.toMatch(/fillRect\(0,\s*0,\s*width,\s*height\)/);
    expect(code).not.toContain("backgroundColor");
  });

  test("it does not swallow touches meant for the form", () => {
    /*
     * The original binds touchmove and calls preventDefault on a container
     * covering the screen. On a phone that eats gestures aimed at the page
     * behind it — which here is the sign-in form.
     */
    expect(code).not.toContain("touchmove");
    expect(code).not.toContain("preventDefault");
    expect(code).toContain('pointerType === "touch"');
  });

  test("it is inert, and invisible to a screen reader", () => {
    expect(component).toContain('aria-hidden="true"');
    expect(index).toMatch(/\.waves-field \{[^}]*pointer-events: none/s);
    expect(index).toMatch(/\.waves-field \{[^}]*z-index: -1/s);
  });

  test("it is drawn at device pixel ratio, with setTransform", () => {
    /*
     * The original sizes its surface in CSS pixels, so every line is soft on a
     * retina screen. setTransform rather than scale, because scale multiplies
     * the transform already in place and would compound on each resize.
     */
    expect(code).toContain("devicePixelRatio");
    expect(code).toContain("setTransform");
    expect(code).not.toContain("ctx.scale(");
  });

  test("it stops when nothing is watching", () => {
    // The original runs its loop forever. A hidden tab is throttled, not
    // stopped, so it keeps costing a phone battery for nothing.
    expect(code).toContain("visibilitychange");
    expect(code).toContain("cancelAnimationFrame");
  });

  test("reduced motion gets one still frame, not a slower animation", () => {
    expect(code).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
    // And the loop is genuinely never started, rather than started and paused.
    const stillBranch = code.slice(code.indexOf("if (still) {"));
    expect(stillBranch).toContain("draw(performance.now())");
    expect(stillBranch.slice(0, 200)).not.toContain("requestAnimationFrame");
  });

  test("per-point state is in flat arrays, not objects", () => {
    /*
     * Tens of thousands of points, sixty times a second. An object per point
     * per frame is the one allocation on this page big enough to make the
     * collector visible as a stutter.
     */
    expect(code).toContain("Float32Array");
  });
});
