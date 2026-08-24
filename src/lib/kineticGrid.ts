/**
 * The geometry behind the sign-in lattice.
 *
 * Pulled out of the component so it can be tested. Everything here is pure:
 * given a lattice point, a cursor and a set of live ripples, it says where the
 * point should be drawn and how lit it should be. The component owns the
 * canvas, the loop and the listeners; none of that is interesting, and all of
 * this is.
 */

export type Point = { x: number; y: number };
export type Ripple = { x: number; y: number; born: number };

/** Lattice pitch in CSS px. Drives how many cells the viewport gets. */
export const CELL = 55;
/** How far from the cursor the warp still reaches. */
export const INFLUENCE = 260;
/** Peak displacement of a point toward the cursor. */
export const MAX_WARP = 24;
/** How quickly the drawn cursor catches up to the real one, per frame. */
export const EASE = 0.08;

export const RIPPLE_SPEED = 400; // px per second
export const RIPPLE_LIFE = 1 / 1.2; // seconds until fully faded
export const RIPPLE_WIDTH = 55; // width of the travelling wavefront

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Smoothstep, so a point brightens into range rather than switching on. */
export const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * How much of the warp a point at (col, row) is allowed to feel.
 *
 * The outermost rows and columns are held still. Without this the cursor drags
 * the boundary inward and the lattice visibly peels away from the edges of the
 * window, which is the one place a background cannot be seen to move.
 */
export function edgePin(col: number, row: number, cols: number, rows: number): number {
  const margin = 1.5;
  const c = Math.min(col / margin, (cols - 1 - col) / margin, 1);
  const r = Math.min(row / margin, (rows - 1 - row) / margin, 1);
  return c * c * r * r;
}

/** A ripple's radius and remaining strength at a given moment. */
export function rippleAt(ripple: Ripple, now: number) {
  const age = (now - ripple.born) / 1000;
  return {
    age,
    /* Clamped at zero: a frame timestamped before `born` would otherwise give
       a negative radius, and a negative radius throws out of arc(). */
    radius: Math.max(0, age * RIPPLE_SPEED),
    strength: Math.max(0, 1 - age / RIPPLE_LIFE),
  };
}

export function isDead(ripple: Ripple, now: number): boolean {
  return (now - ripple.born) / 1000 >= RIPPLE_LIFE;
}

/**
 * Where a lattice point is drawn, and how lit it is.
 *
 * `near` is 0 outside the cursor's reach and 1 underneath it, before
 * smoothstep; the component uses it for line colour, node size and glow.
 */
export function displace(
  gx: number,
  gy: number,
  col: number,
  row: number,
  cols: number,
  rows: number,
  cursor: Point,
  ripples: readonly Ripple[],
  now: number,
): { x: number; y: number; near: number } {
  const pin = edgePin(col, row, cols, rows);

  const dx = gx - cursor.x;
  const dy = gy - cursor.y;
  const dist = Math.hypot(dx, dy);
  const near = Math.max(0, 1 - dist / INFLUENCE) * pin;

  let ox = 0;
  let oy = 0;

  for (const ripple of ripples) {
    const { radius, strength } = rippleAt(ripple, now);
    const rdx = gx - ripple.x;
    const rdy = gy - ripple.y;
    const offset = Math.hypot(rdx, rdy) - radius;
    if (Math.abs(offset) >= RIPPLE_WIDTH) continue;
    const push = (1 - Math.abs(offset) / RIPPLE_WIDTH) * strength * 18 * pin;
    const angle = Math.atan2(rdy, rdx);
    /* Points inside the ring are pushed outward and points outside are pulled
       in, so the wavefront reads as a crest passing through rather than as an
       expanding shove. */
    const sign = offset < 0 ? 1 : -1;
    ox += Math.cos(angle) * push * sign;
    oy += Math.sin(angle) * push * sign;
  }

  if (dist < INFLUENCE && dist > 0 && pin > 0) {
    /* Squared falloff, damped again very close in so the point directly under
       the cursor does not collapse onto it. */
    const t = dist / INFLUENCE;
    const pull = (1 - t) * (1 - t) * Math.min(1, dist / 60) * MAX_WARP * pin;
    const angle = Math.atan2(dy, dx);
    return { x: gx - Math.cos(angle) * pull + ox, y: gy - Math.sin(angle) * pull + oy, near };
  }

  return { x: gx + ox, y: gy + oy, near };
}
