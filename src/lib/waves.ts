/**
 * The maths behind the sign-in waves.
 *
 * Split out of the component for the same reason kineticGrid.ts was: the
 * canvas, the loop and the listeners are not interesting and cannot be watched
 * from a test, but the geometry is and can. Everything here is pure.
 *
 * The noise is written out rather than installed. The supplied component
 * brought in simplex-noise for one function; this repo has eight dependencies
 * on purpose, CI runs `bun audit` over them, and a fixed-seed generator is
 * forty lines that will never need patching. Writing it here also makes the
 * field deterministic, so a test can assert the shape of the motion instead of
 * asserting that a library was called.
 */

export type Vec = { x: number; y: number };

/* --- Layout ---------------------------------------------------------- */

/** Horizontal distance between lines, and vertical distance between the
    points that make one up. Eight, as supplied: it is what makes the field
    read as a woven surface rather than a set of separate strings. */
export const COLUMN_GAP = 8;
export const POINT_GAP = 8;

/* Drawn wider and taller than the viewport so the lines are never seen to
   begin or end — the field runs off every edge. */
export const OVERSCAN_X = 220;
export const OVERSCAN_Y = 48;

export const columns = (width: number) =>
  Math.max(2, Math.ceil((width + OVERSCAN_X) / COLUMN_GAP));
export const rows = (height: number) =>
  Math.max(2, Math.ceil((height + OVERSCAN_Y) / POINT_GAP));

/* --- Motion ---------------------------------------------------------- */

/*
 * Noise gives an angle, not an offset. Feeding it through cos/sin is what
 * turns a smooth scalar field into something that curls, and it is the whole
 * reason this looks like moving water rather than a flag.
 *
 * SWIRL is how many radians a unit of noise is worth. Above about 8 the angle
 * wraps more than a full turn between neighbouring points and the surface
 * shears into noise; below about 4 it barely curls. Six holds together.
 */
export const SWIRL = 6;
export const AMP_X = 11;
export const AMP_Y = 5.5;

/* Deliberately slower than the component this came from, which ran at 0.008
   and 0.003. At that speed the field reads as busy; the point of it is to be
   noticed second, after the wordmark. */
export const DRIFT_X = 0.0055;
export const DRIFT_Y = 0.0022;
export const FREQ_X = 0.003;
export const FREQ_Y = 0.002;

/**
 * The angle of the field at a point, at a moment.
 *
 * Returned as a bare number rather than the offset, because the draw loop
 * calls this once per point per frame — around twenty-four thousand times at
 * 1440x900 — and handing back an object there would mean allocating twenty-four
 * thousand of them sixty times a second for the collector to sweep up. The
 * component turns it into cos/sin itself; waveAt below is the readable form,
 * for tests and for anyone reading this file rather than the hot loop.
 */
export function waveAngle(
  noise: (x: number, y: number) => number,
  x: number,
  y: number,
  timeMs: number,
): number {
  return noise((x + timeMs * DRIFT_X) * FREQ_X, (y + timeMs * DRIFT_Y) * FREQ_Y) * SWIRL;
}

/** Where a point sits, relative to its resting place, at a given moment. */
export function waveAt(
  noise: (x: number, y: number) => number,
  x: number,
  y: number,
  timeMs: number,
): Vec {
  const angle = waveAngle(noise, x, y, timeMs);
  return { x: Math.cos(angle) * AMP_X, y: Math.sin(angle) * AMP_Y };
}

/* --- The cursor ------------------------------------------------------ */

export const INFLUENCE = 190;
export const MAX_PUSH = 34;

/**
 * How strongly a point at `distance` from the pointer is moved: one at the
 * centre, zero at the edge of the influence, and eased at both ends so the
 * lit patch has no visible rim.
 */
export function falloff(distance: number, influence: number = INFLUENCE): number {
  if (distance >= influence || influence <= 0) return 0;
  return smooth(1 - distance / influence);
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Smoothstep. Flat at both ends, so nothing starts or stops abruptly. */
export const smooth = (t: number) => t * t * (3 - 2 * t);

/* --- Noise ----------------------------------------------------------- */

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

/* The twelve gradient directions of the classic implementation, x and y only,
   flattened so the hot loop indexes a typed array instead of objects. */
const GRAD = new Int8Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0, -1]);

/**
 * Two-dimensional simplex noise, in [-1, 1], from a fixed seed.
 *
 * Simplex rather than the value noise that would have been shorter: value
 * noise on a square lattice leaves visible horizontal and vertical seams, and
 * a background whose grid you can see is the opposite of the point.
 */
export function makeNoise2D(seed = 1): (x: number, y: number) => number {
  /* mulberry32, so the permutation is identical on every machine and in every
     run. A Math.random() shuffle would make the field untestable. */
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = p[i]!;
    p[i] = p[j]!;
    p[j] = tmp;
  }

  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255]!;
    permMod12[i] = perm[i]! % 12;
  }

  return (xin: number, yin: number): number => {
    const skew = (xin + yin) * F2;
    const i = Math.floor(xin + skew);
    const j = Math.floor(yin + skew);
    const unskew = (i + j) * G2;
    const x0 = xin - (i - unskew);
    const y0 = yin - (j - unskew);

    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;

    let n = 0;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = permMod12[ii + perm[jj]!]! * 2;
      t0 *= t0;
      n += t0 * t0 * (GRAD[g]! * x0 + GRAD[g + 1]! * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = permMod12[ii + i1 + perm[jj + j1]!]! * 2;
      t1 *= t1;
      n += t1 * t1 * (GRAD[g]! * x1 + GRAD[g + 1]! * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = permMod12[ii + 1 + perm[jj + 1]!]! * 2;
      t2 *= t2;
      n += t2 * t2 * (GRAD[g]! * x2 + GRAD[g + 1]! * y2);
    }

    /* 70 is the scale that brings the sum of three kernels to roughly [-1, 1];
       it comes with the algorithm rather than from taste. */
    return 70 * n;
  };
}
