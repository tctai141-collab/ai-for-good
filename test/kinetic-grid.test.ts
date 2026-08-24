import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  INFLUENCE,
  MAX_WARP,
  RIPPLE_LIFE,
  RIPPLE_SPEED,
  displace,
  edgePin,
  isDead,
  rippleAt,
  smooth,
} from "../src/lib/kineticGrid";

/**
 * The sign-in lattice.
 *
 * The canvas, the loop and the listeners are not interesting; the geometry is,
 * and it lives in a pure module so it can be exercised here. That split was
 * forced by something practical: the component parks its frame when the tab is
 * hidden, and the browser this was built in kept the automation tab hidden, so
 * there was no way to watch the warp happen. Reasoning about it from a
 * screenshot would have been guessing.
 */

const grid = readFileSync("src/components/KineticGrid.tsx", "utf-8");
const css = readFileSync("src/pages/index.astro", "utf-8");

/*
 * The component's own comments name the colours and the calls these checks
 * forbid, in order to explain why they are gone. A check that cannot tell a
 * prohibition from its violation is not a check, so the "must not contain"
 * assertions below read this instead of the raw file.
 */
const code = grid.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const NO_RIPPLES: never[] = [];
const FAR = { x: -9999, y: -9999 };
/** A point in the middle of a lattice, so the edge pin is fully out of the way. */
const mid = (x: number, y: number, cursor: { x: number; y: number }, ripples = NO_RIPPLES) =>
  displace(x, y, 10, 10, 30, 30, cursor, ripples, 0);

describe("the cursor warp", () => {
  test("a point out of reach does not move", () => {
    const p = mid(500, 500, { x: 500 + INFLUENCE + 1, y: 500 });
    expect(p.x).toBe(500);
    expect(p.y).toBe(500);
    expect(p.near).toBe(0);
  });

  test("a point in reach is pulled toward the cursor, never past it", () => {
    const cursor = { x: 600, y: 500 };
    const p = mid(500, 500, cursor);
    // Moved toward the cursor on the x axis, and not overshot onto its far side.
    expect(p.x).toBeGreaterThan(500);
    expect(p.x).toBeLessThan(cursor.x);
    expect(Math.abs(p.y - 500)).toBeLessThan(0.001);
    expect(p.x - 500).toBeLessThanOrEqual(MAX_WARP);
  });

  test("the pull is damped to nothing directly under the cursor", () => {
    /*
     * Without the near-field damping the point at the cursor is displaced by
     * the full amount, and since the direction is undefined there it flickers.
     * The falloff peaks somewhere in the middle of the reach, not at zero.
     */
    const atCursor = mid(500, 500, { x: 500, y: 500 });
    expect(atCursor.x).toBe(500);
    expect(atCursor.y).toBe(500);

    const veryClose = mid(500, 500, { x: 505, y: 500 });
    const middling = mid(500, 500, { x: 590, y: 500 });
    expect(veryClose.x - 500).toBeLessThan(middling.x - 500);
  });

  test("`near` is 1 under the cursor and falls to 0 at the edge of reach", () => {
    expect(mid(500, 500, { x: 500, y: 500 }).near).toBeCloseTo(1, 5);
    expect(mid(500, 500, { x: 500 + INFLUENCE / 2, y: 500 }).near).toBeCloseTo(0.5, 5);
    expect(mid(500, 500, { x: 500 + INFLUENCE, y: 500 }).near).toBeCloseTo(0, 5);
  });
});

describe("the edge pin", () => {
  test("the boundary is held completely still", () => {
    // Otherwise the cursor drags the lattice away from the sides of the window.
    expect(edgePin(0, 10, 30, 30)).toBe(0);
    expect(edgePin(29, 10, 30, 30)).toBe(0);
    expect(edgePin(10, 0, 30, 30)).toBe(0);
    expect(edgePin(10, 29, 30, 30)).toBe(0);
  });

  test("the middle is entirely free", () => {
    expect(edgePin(15, 15, 30, 30)).toBe(1);
  });

  test("a pinned point ignores the cursor sitting right on it", () => {
    const corner = displace(0, 0, 0, 0, 30, 30, { x: 0, y: 0 }, NO_RIPPLES, 0);
    expect(corner.x).toBe(0);
    expect(corner.y).toBe(0);
    expect(corner.near).toBe(0);
  });
});

describe("ripples", () => {
  test("the radius is never negative", () => {
    /*
     * A negative radius throws out of ctx.arc, and a frame timestamped before
     * the ripple was born is enough to produce one. The supplied component
     * carried a fix for exactly this; it is kept, and pinned here.
     */
    expect(rippleAt({ x: 0, y: 0, born: 1000 }, 0).radius).toBe(0);
    expect(rippleAt({ x: 0, y: 0, born: 0 }, 500).radius).toBeCloseTo(RIPPLE_SPEED / 2, 5);
  });

  test("it fades out and then reports itself dead", () => {
    const r = { x: 0, y: 0, born: 0 };
    expect(rippleAt(r, 0).strength).toBe(1);
    expect(isDead(r, 0)).toBe(false);
    expect(rippleAt(r, RIPPLE_LIFE * 1000).strength).toBe(0);
    expect(isDead(r, RIPPLE_LIFE * 1000)).toBe(true);
  });

  test("the wavefront displaces points, and only points it has reached", () => {
    /*
     * `mid` evaluates at now = 0, so the ripple is dated backwards to give it
     * a radius: born at -250ms is 0.25s old, which is 100px across. The first
     * version of this test passed `now` as a variable that the helper ignored,
     * so the ripple had radius 0 and nothing moved.
     */
    const ripple = { x: 500, y: 500, born: -250 };
    const onFront = mid(600, 500, FAR, [ripple] as never); // 100px out: on the crest
    const wellInside = mid(505, 500, FAR, [ripple] as never); // 5px out: long since passed

    expect(Math.abs(onFront.x - 600)).toBeGreaterThan(0.5);
    expect(Math.abs(wellInside.x - 505)).toBeLessThan(0.001);
  });

  test("points inside the ring go out and points outside come in", () => {
    // What makes it read as a crest passing through rather than a shove.
    const ripple = { x: 500, y: 500, born: -250 }; // radius 100 at now = 0
    const inside = mid(560, 500, FAR, [ripple] as never);
    const outside = mid(640, 500, FAR, [ripple] as never);
    expect(inside.x).toBeGreaterThan(560);
    expect(outside.x).toBeLessThan(640);
  });
});

describe("smoothstep", () => {
  test("it is flat at both ends and passes through the middle", () => {
    expect(smooth(0)).toBe(0);
    expect(smooth(1)).toBe(1);
    expect(smooth(0.5)).toBe(0.5);
    // Flatter than linear near the ends, which is the point of it.
    expect(smooth(0.1)).toBeLessThan(0.1);
    expect(smooth(0.9)).toBeGreaterThan(0.9);
  });
});

describe("what a background is allowed to do", () => {
  test("the comment-stripped source is still the source", () => {
    // If this ever empties out, every "must not contain" below passes for the
    // wrong reason. That exact bug shipped once in the headline suite.
    expect(code.length).toBeGreaterThan(1000);
    expect(code).toContain("requestAnimationFrame");
    expect(code).not.toContain("Adapted from a supplied KineticGrid");
  });

  test("it paints no background of its own", () => {
    /*
     * The supplied component fills #000 or #161618 every frame. Here that
     * would cover the login screen's gradients and the red halo behind the
     * cube, and the page would lose its only colour.
     */
    expect(code).not.toContain("fillRect");
    expect(code).toContain("clearRect");
    expect(code).not.toContain("#161618");
  });

  test("nothing in it is blue", () => {
    // The supplied default active colour is #4a9eff. Blue is the one colour
    // this codebase has deliberately removed.
    expect(code).not.toContain("4a9eff");
    expect(code).not.toMatch(/\b74,\s*158,\s*255\b/);
    expect(code).not.toMatch(/\b100,\s*180,\s*255\b/);
  });

  test("it is drawn at device pixel ratio, with setTransform", () => {
    // ctx.scale multiplies the transform already in place, so it compounds on
    // every resize; setTransform replaces it.
    expect(grid).toContain("devicePixelRatio");
    expect(grid).toContain("ctx.setTransform(dpr, 0, 0, dpr, 0, 0)");
    expect(code).not.toContain("ctx.scale(");
  });

  test("it stops when nothing is watching, and cleans up after itself", () => {
    expect(grid).toContain('document.addEventListener("visibilitychange", onVisibility)');
    expect(grid).toContain("cancelAnimationFrame(frame)");
    for (const off of ["resize", "pointermove", "click", "visibilitychange"]) {
      expect(grid).toContain(`removeEventListener("${off}"`);
    }
  });

  test("reduced motion draws one still frame and attaches nothing", () => {
    expect(grid).toMatch(/if \(still\) \{\s*draw\(performance\.now\(\)\);/);
  });

  test("it can never take a click meant for the form", () => {
    expect(grid).toContain('aria-hidden="true"');
    expect(css).toMatch(/\.kinetic-grid \{[^}]*pointer-events: none/s);
    expect(css).toMatch(/\.kinetic-grid \{[^}]*z-index: -1/s);
  });
});
