import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  animateValue,
  applyToneCurve,
  cellHash,
  charsFor,
  computeEdges,
  glyphFor,
  isCovered,
  luminance,
  resolveValue,
  sampleGrid,
} from "../src/lib/asciiRain/sample";
import { CODE_RAIN, withDefaults } from "../src/lib/asciiRain/types";

/**
 * The code-rain pipeline.
 *
 * The drawing needs a canvas and is checked in the browser; everything here is
 * the arithmetic underneath it, which is where the effect is actually decided:
 * what each cell samples to, what the tone curve does to it, which cells are
 * drawn at all, and which glyph comes out.
 */

/** Build an RGBA buffer from a per-pixel function. */
function image(w: number, h: number, fn: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

describe("sampling", () => {
  test("a flat image gives every cell the same colour", () => {
    const grid = sampleGrid(image(20, 20, () => [10, 200, 40]), 20, 20, 10);
    expect(grid.cols).toBe(2);
    expect(grid.rows).toBe(2);
    expect(grid.cells).toHaveLength(4);
    for (const c of grid.cells) {
      expect(c.r).toBeCloseTo(10, 5);
      expect(c.g).toBeCloseTo(200, 5);
      expect(c.b).toBeCloseTo(40, 5);
    }
  });

  test("each cell averages only its own pixels", () => {
    // Left half black, right half white, on a two-cell grid.
    const grid = sampleGrid(
      image(20, 10, (x) => (x < 10 ? [0, 0, 0] : [255, 255, 255])),
      20,
      10,
      10,
    );
    expect(grid.cells[0]!.lum).toBeCloseTo(0, 5);
    expect(grid.cells[1]!.lum).toBeCloseTo(1, 5);
  });

  test("a partial edge cell averages what it has instead of being dropped", () => {
    /*
     * 25px across a 10px grid is two whole cells and a 5px sliver. Skipping the
     * sliver would leave a strip of untouched canvas down the right-hand edge,
     * which on a full-screen background is the one place it would be obvious.
     */
    const grid = sampleGrid(image(25, 10, () => [255, 255, 255]), 25, 10, 10);
    expect(grid.cols).toBe(3);
    expect(grid.cells[2]!.lum).toBeCloseTo(1, 5);
  });

  test("luminance weights green most, which is why a green tint reads bright", () => {
    expect(luminance(255, 0, 0)).toBeCloseTo(0.2126, 4);
    expect(luminance(0, 255, 0)).toBeCloseTo(0.7152, 4);
    expect(luminance(0, 0, 255)).toBeCloseTo(0.0722, 4);
    expect(luminance(255, 255, 255)).toBeCloseTo(1, 5);
  });
});

describe("edges", () => {
  test("a flat field has no edges anywhere", () => {
    const grid = sampleGrid(image(40, 40, () => [128, 128, 128]), 40, 40, 10);
    computeEdges(grid);
    for (const c of grid.cells) expect(c.edge).toBeCloseTo(0, 6);
  });

  test("a hard boundary registers, and the flat areas either side do not", () => {
    const grid = sampleGrid(
      image(60, 30, (x) => (x < 30 ? [0, 0, 0] : [255, 255, 255])),
      60,
      30,
      10,
    );
    computeEdges(grid);
    const row = grid.cells.filter((c) => c.row === 1);
    const atBoundary = row.find((c) => c.col === 2 || c.col === 3)!;
    const farLeft = row.find((c) => c.col === 0)!;
    expect(atBoundary.edge).toBeGreaterThan(0.2);
    expect(farLeft.edge).toBeCloseTo(0, 6);
  });
});

describe("the tone curve", () => {
  test("the identity curve changes nothing", () => {
    const identity = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      expect(applyToneCurve(v, identity)).toBeCloseTo(v, 6);
    }
  });

  test("it interpolates between control points", () => {
    const curve = [{ x: 0, y: 0 }, { x: 0.5, y: 0.9 }, { x: 1, y: 1 }];
    expect(applyToneCurve(0.25, curve)).toBeCloseTo(0.45, 5);
    expect(applyToneCurve(0.5, curve)).toBeCloseTo(0.9, 5);
  });

  test("points arriving out of order still describe the same curve", () => {
    // The editor emits them sorted; nothing guarantees a hand-written blob is.
    const jumbled = [{ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0.5, y: 0.9 }];
    expect(applyToneCurve(0.5, jumbled)).toBeCloseTo(0.9, 5);
  });

  test("a missing or degenerate curve is a pass-through, not a crash", () => {
    expect(applyToneCurve(0.4, [])).toBeCloseTo(0.4, 6);
    expect(applyToneCurve(0.4, [{ x: 0, y: 0 }])).toBeCloseTo(0.4, 6);
  });
});

describe("coverage", () => {
  test("100 draws everything and 0 draws nothing", () => {
    for (let i = 0; i < 50; i++) {
      expect(isCovered(i, i * 3, 100)).toBe(true);
      expect(isCovered(i, i * 3, 0)).toBe(false);
    }
  });

  test("the same cell decides the same way every time", () => {
    /*
     * This is the whole reason coverage is hashed rather than random. Rolling
     * per frame would make the field seethe, which reads as noise instead of a
     * partly drawn image, and would fight whatever animStyle is doing.
     */
    const first = Array.from({ length: 200 }, (_, i) => isCovered(i % 20, (i / 20) | 0, 60));
    const second = Array.from({ length: 200 }, (_, i) => isCovered(i % 20, (i / 20) | 0, 60));
    expect(second).toEqual(first);
  });

  test("roughly the requested proportion is drawn", () => {
    let drawn = 0;
    const total = 100 * 100;
    for (let c = 0; c < 100; c++) for (let r = 0; r < 100; r++) if (isCovered(c, r, 60)) drawn++;
    expect(drawn / total).toBeGreaterThan(0.55);
    expect(drawn / total).toBeLessThan(0.65);
  });

  test("the hash is well spread, not clumped into a corner", () => {
    const buckets = new Array(10).fill(0);
    for (let c = 0; c < 60; c++) {
      for (let r = 0; r < 60; r++) buckets[Math.floor(cellHash(c, r) * 10)]!++;
    }
    for (const b of buckets) expect(b).toBeGreaterThan(3600 / 10 / 2);
  });
});

describe("glyphs", () => {
  test("ordered sets map value onto the ramp, dark to light", () => {
    const ascii = charsFor("ascii", "");
    expect(glyphFor("ascii", ascii, 0, 0, 0, 0)).toBe(" ");
    expect(glyphFor("ascii", ascii, 1, 0, 0, 0)).toBe("@");
  });

  test("an alphabet is picked by hash, not by value", () => {
    /*
     * binary, hex and katakana have no order of visual weight. Mapping value
     * onto them would print a wall of the same character across any flat area:
     * every dark cell a "0", every bright one a "1".
     */
    const binary = charsFor("binary", "");
    const sameValue = new Set(
      Array.from({ length: 40 }, (_, i) => glyphFor("binary", binary, 0.5, i, 0, 0)),
    );
    expect(sameValue.size).toBe(2);
  });

  test("custom characters are used, and an empty custom set falls back", () => {
    expect(charsFor("custom", "AB")).toBe("AB");
    expect(charsFor("custom", "")).toBe(charsFor("ascii", ""));
  });
});

describe("resolving a cell's value", () => {
  const cell = { col: 3, row: 4, x: 0, y: 0, r: 128, g: 128, b: 128, lum: 0.5, value: 0, edge: 0 };
  const still = { ...CODE_RAIN, animated: false, edgeEmphasis: 0, contrast: 100 };

  test("invert flips it", () => {
    expect(resolveValue({ ...cell }, { ...still, invert: false }, 0)).toBeCloseTo(0.5, 5);
    expect(resolveValue({ ...cell }, { ...still, invert: true }, 0)).toBeCloseTo(0.5, 5);
    const dark = { ...cell, lum: 0.2 };
    expect(resolveValue(dark, { ...still, invert: true }, 0)).toBeCloseTo(0.8, 5);
  });

  test("density lifts or drops the whole field, and clamps", () => {
    expect(resolveValue({ ...cell }, { ...still, density: 30 }, 0)).toBeCloseTo(0.8, 5);
    expect(resolveValue({ ...cell }, { ...still, density: -30 }, 0)).toBeCloseTo(0.2, 5);
    expect(resolveValue({ ...cell }, { ...still, density: 200 }, 0)).toBe(1);
    expect(resolveValue({ ...cell }, { ...still, density: -200 }, 0)).toBe(0);
  });

  test("edgeEmphasis adds to the tone rather than replacing it", () => {
    /*
     * Replacing it would hollow out flat bright areas into outlines. An edge
     * should thicken what is there, not stand in for it.
     */
    const edgy = { ...cell, edge: 0.5 };
    const plain = resolveValue({ ...edgy }, { ...still, edgeEmphasis: 0 }, 0);
    const emphasised = resolveValue({ ...edgy }, { ...still, edgeEmphasis: 40 }, 0);
    expect(plain).toBeCloseTo(0.5, 5);
    expect(emphasised).toBeCloseTo(0.7, 5);
  });
});

describe("animation", () => {
  test("zero strength is exactly no change, whatever the style", () => {
    for (const style of ["wave", "pulse", "shimmer", "ripple", "flicker"] as const) {
      expect(animateValue(style, 2, 3, 1.234, 0)).toBe(1);
    }
  });

  test("flicker gives each cell its own rhythm rather than a shared one", () => {
    // A single global flicker reads as the whole screen blinking, which is not
    // what a terminal does.
    const a = animateValue("flicker", 1, 1, 0.7, 1);
    const b = animateValue("flicker", 2, 1, 0.7, 1);
    expect(a).not.toBeCloseTo(b, 3);
  });

  test("a cell's flicker is reproducible at the same moment", () => {
    expect(animateValue("flicker", 5, 6, 2.5, 1)).toBe(animateValue("flicker", 5, 6, 2.5, 1));
  });

  test("pulse moves the whole field together", () => {
    expect(animateValue("pulse", 1, 1, 0.9, 1)).toBeCloseTo(animateValue("pulse", 9, 9, 0.9, 1), 6);
  });
});

describe("the supplied preset", () => {
  test("it is carried verbatim", () => {
    // The point of matching the spec's names exactly is that a settings blob
    // from the editor drops in with no translation layer to drift out of date.
    expect(CODE_RAIN.renderMode).toBe("characters");
    expect(CODE_RAIN.charSet).toBe("binary");
    expect(CODE_RAIN.tint).toBe("#00ff66");
    expect(CODE_RAIN.cellSize).toBe(14);
    expect(CODE_RAIN.coverage).toBe(96);
    expect(CODE_RAIN.contrast).toBe(115);
    expect(CODE_RAIN.edgeEmphasis).toBe(40);
    expect(CODE_RAIN.animStyle).toBe("flicker");
    expect(CODE_RAIN.overlayBlend).toBe("overlay");
    expect(CODE_RAIN.pfx.vignette).toEqual({ enabled: true, intensity: 38 });
    expect(CODE_RAIN.pfx.scanLines).toEqual({ enabled: true, intensity: 28 });
    expect(CODE_RAIN.pfx.bloom).toEqual({ enabled: true, intensity: 25 });
    expect(CODE_RAIN.pfx.filmGrain).toEqual({ enabled: true, intensity: 40 });
    expect(CODE_RAIN.pfx.glitch).toEqual({ enabled: true, intensity: 20 });
    expect(CODE_RAIN.pfx.chromatic.enabled).toBe(false);
  });

  test("a partial override keeps the rest of the preset", () => {
    const p = withDefaults({ cellSize: 22 });
    expect(p.cellSize).toBe(22);
    expect(p.tint).toBe("#00ff66");
    // pfx merges one level, so overriding one effect does not drop the others.
    const q = withDefaults({ pfx: { ...CODE_RAIN.pfx, glitch: { enabled: false, intensity: 0 } } });
    expect(q.pfx.glitch.enabled).toBe(false);
    expect(q.pfx.vignette.intensity).toBe(38);
  });
});

describe("the welcome splash", () => {
  const splash = readFileSync("src/components/WelcomeSplash.tsx", "utf-8");
  const typewriter = readFileSync("src/components/Typewriter.tsx", "utf-8");
  const app = readFileSync("src/components/App.tsx", "utf-8");
  const css = readFileSync("src/pages/index.astro", "utf-8");

  test("it greets them by name, with a break it chose", () => {
    /*
     * As one string the line wrapped wherever the box's width happened to
     * fall, which orphaned "It" at the end of the first line and dropped
     * "begins here!" alone on the second. With a name in it there is no width
     * that fixes that, because the break moves as the name changes length. So
     * the newline is written, and pre-line renders it.
     */
    expect(splash).toContain("`Welcome, ${clean}.`");
    expect(splash).toContain('const SECOND_LINE = "It begins here!"');
    expect(splash).toContain("${greeting(name)}\\n${SECOND_LINE}");
    expect(css).toMatch(/\.splash-line \{[^}]*white-space: pre-line/s);
  });

  test("an account with no name still gets a greeting", () => {
    // A blank line is worse than the cohort's own word.
    expect(splash).toContain('"Welcome Sprinters."');
  });

  test("the name comes from the session, not from the app's user state", () => {
    /*
     * The splash is raised the moment the server accepts the password, before
     * `enter` has finished setting `user`. Reading it from there would greet
     * nobody for the first second.
     */
    expect(app).toContain("setSplashName(data.user.name)");
    expect(app).toContain("<WelcomeSplash name={splashName}");
  });

  test("the three seconds are a floor, not a cut", () => {
    // The splash also waits for the user to be set, so a slow data load stays
    // covered by the welcome instead of revealing a half-empty app.
    expect(app).toContain("if (splashing && held && user) setSplashing(false)");
  });

  test("it belongs to signing in, not to arriving already signed in", () => {
    /*
     * `enter` also runs when an existing session is restored on page load. If
     * the splash hung off that, every refresh would cost three seconds.
     */
    const login = app.slice(app.indexOf("const handleLogin"), app.indexOf("if (splashing)"));
    expect(login).toContain("setSplashing(true)");
    /* Just the callback body. Slicing as far as handleLogin swept in the
       effect that *clears* the splash, which sits between them, so the check
       failed on the very line that makes the behaviour correct. */
    const from = app.indexOf("const enter =");
    const restore = app.slice(from, app.indexOf("}, []);", from));
    expect(restore).toContain("setUser(signedIn)");
    expect(restore).not.toContain("setSplashing");
  });

  test("a failed sign-in never reaches it", () => {
    const login = app.slice(app.indexOf("const handleLogin"), app.indexOf("if (splashing)"));
    const guard = login.indexOf("if (!response.ok || !data.user)");
    expect(guard).toBeGreaterThan(-1);
    expect(login.indexOf("setSplashing(true)")).toBeGreaterThan(guard);
  });

  test("the typewriter brought no dependencies and cleans up every timer", () => {
    /*
     * The supplied component nests a bare setTimeout inside another and clears
     * neither, so unmounting mid-pause sets state on a dead component. This
     * splash unmounts on a timer, so that is the normal path here.
     */
    const imports = [...typewriter.matchAll(/^\s*import[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]!);
    expect(imports).toEqual(["react"]);
    expect(typewriter).toContain("for (const t of timers) window.clearTimeout(t)");
  });

  test("the typewriter steps by code point, not by code unit", () => {
    // text[i] splits anything outside the basic plane into two broken halves.
    expect(typewriter).toContain("const chars = [...text]");
  });

  test("reduced motion gets the whole line at once", () => {
    // Typing is motion. The message is the point, not the typing.
    expect(typewriter).toContain('window.matchMedia("(prefers-reduced-motion: reduce)").matches');
    expect(typewriter).toContain("setShown(chars.length)");
  });

  test("the rain is decoration and the message is not", () => {
    expect(splash).toContain('aria-hidden="true"');
    expect(splash).toContain('role="status"');
  });
});
