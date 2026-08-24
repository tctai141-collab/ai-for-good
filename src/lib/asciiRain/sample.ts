import type { AnimStyle, AsciiParams, CharSet } from "./types";

/**
 * The parts of the code-rain pipeline that are just arithmetic.
 *
 * Everything here is pure and framework-free so it can be tested without a
 * canvas: grid sampling, luminance, the tone curve, edge detection, the
 * coverage decision and the animation modulation. The drawing lives next door
 * and does nothing except turn these numbers into shapes.
 */

export type Cell = {
  col: number;
  row: number;
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  /** 0..1 before any adjustment. */
  lum: number;
  /** 0..1 after invert, density, tone curve, edge emphasis and animation. */
  value: number;
  /** 0..1 local edge strength, before edgeEmphasis is applied. */
  edge: number;
};

export type Grid = { cols: number; rows: number; cells: Cell[] };

/** Rec. 709 luma. The green weight is why a green tint reads as bright. */
export function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * A stable hash for a cell.
 *
 * Coverage has to pick the same cells on every frame. Math.random() per frame
 * would make the whole field seethe, which reads as noise rather than as a
 * partly-drawn image, and would fight whatever the animation style is doing.
 */
export function cellHash(col: number, row: number, salt = 0): number {
  let h = (col * 374761393 + row * 668265263 + salt * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Piecewise-linear tone curve.
 *
 * Points arrive sorted by x in the editor's output, but sorting here costs
 * nothing and a curve that silently inverts because two points arrived the
 * wrong way round is not worth the saving.
 */
export function applyToneCurve(value: number, curve: { x: number; y: number }[]): number {
  if (!curve || curve.length < 2) return value;
  const pts = [...curve].sort((a, b) => a.x - b.x);
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (value <= first.x) return clamp01(first.y);
  if (value >= last.x) return clamp01(last.y);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (value >= a.x && value <= b.x) {
      const span = b.x - a.x;
      const t = span === 0 ? 0 : (value - a.x) / span;
      return clamp01(a.y + (b.y - a.y) * t);
    }
  }
  return clamp01(value);
}

/**
 * Average each cell of the grid.
 *
 * `data` is RGBA from getImageData at `width` x `height`. Cells at the right
 * and bottom edges are usually partial; they are averaged over whatever pixels
 * they actually contain rather than being skipped, so the effect reaches the
 * edge of the canvas instead of stopping short of it.
 */
export function sampleGrid(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cellSize: number,
): Grid {
  const size = Math.max(1, Math.round(cellSize));
  const cols = Math.ceil(width / size);
  const rows = Math.ceil(height / size);
  const cells: Cell[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x0 = col * size;
      const y0 = row * size;
      const x1 = Math.min(x0 + size, width);
      const y1 = Math.min(y0 + size, height);

      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          r += data[i]!;
          g += data[i + 1]!;
          b += data[i + 2]!;
          n++;
        }
      }
      if (n === 0) n = 1;
      r /= n;
      g /= n;
      b /= n;

      cells.push({
        col,
        row,
        x: x0,
        y: y0,
        r,
        g,
        b,
        lum: luminance(r, g, b),
        value: 0,
        edge: 0,
      });
    }
  }

  return { cols, rows, cells };
}

/**
 * Sobel over the cell grid, not over the pixels.
 *
 * Running it on the full-resolution image and then averaging would be more
 * accurate and about `cellSize` squared times the work, for a difference
 * nothing at this scale can show: the result is used to thicken a glyph inside
 * a 14px cell.
 */
export function computeEdges(grid: Grid): void {
  const { cols, rows, cells } = grid;
  const at = (c: number, r: number) => {
    const cc = c < 0 ? 0 : c >= cols ? cols - 1 : c;
    const rr = r < 0 ? 0 : r >= rows ? rows - 1 : r;
    return cells[rr * cols + cc]!.lum;
  };

  for (const cell of cells) {
    const { col: c, row: r } = cell;
    const gx =
      -at(c - 1, r - 1) - 2 * at(c - 1, r) - at(c - 1, r + 1) +
      at(c + 1, r - 1) + 2 * at(c + 1, r) + at(c + 1, r + 1);
    const gy =
      -at(c - 1, r - 1) - 2 * at(c, r - 1) - at(c + 1, r - 1) +
      at(c - 1, r + 1) + 2 * at(c, r + 1) + at(c + 1, r + 1);
    cell.edge = clamp01(Math.hypot(gx, gy) / 4);
  }
}

/**
 * How much the animation nudges a cell at this moment.
 *
 * Returns a multiplier around 1. `flicker` is deliberately hashed per cell
 * rather than random per frame: a cell should have its own rhythm and keep it,
 * which is what reads as a terminal rather than as static.
 */
export function animateValue(
  style: AnimStyle,
  col: number,
  row: number,
  time: number,
  strength: number,
): number {
  if (strength <= 0) return 1;
  const s = strength;
  switch (style) {
    case "wave":
      return 1 + Math.sin(time * 2 + col * 0.35) * 0.5 * s;
    case "pulse":
      return 1 + Math.sin(time * 3) * 0.5 * s;
    case "shimmer":
      return 1 + Math.sin(time * 6 + (col + row) * 0.8) * 0.4 * s;
    case "ripple": {
      const d = Math.hypot(col, row);
      return 1 + Math.sin(time * 4 - d * 0.5) * 0.5 * s;
    }
    case "flicker": {
      const phase = cellHash(col, row, 7) * Math.PI * 2;
      const rate = 3 + cellHash(col, row, 11) * 9;
      return 1 + Math.sin(time * rate + phase) * 0.6 * s;
    }
    default:
      return 1;
  }
}

/**
 * Turn a cell's raw luminance into the value the renderer draws with, applying
 * everything in the order the spec gives.
 */
export function resolveValue(cell: Cell, params: AsciiParams, time: number): number {
  let v = cell.lum;

  if (params.invert) v = 1 - v;
  v = applyToneCurve(v, params.toneCurve);

  // density shifts the whole field up or down; -100..100 arrives as a percent.
  v = clamp01(v + params.density / 100);

  // edgeEmphasis adds outline strength on top rather than replacing the tone,
  // so a flat bright area stays bright instead of hollowing out.
  v = clamp01(v + cell.edge * (params.edgeEmphasis / 100));

  if (params.animated && params.animIntensity.enabled) {
    const strength = params.animIntensity.intensity / 100;
    v = clamp01(v * animateValue(params.animStyle, cell.col, cell.row, time, strength));
  }

  return v;
}

/** Whether a cell is drawn at all, given `coverage` as a percentage. */
export function isCovered(col: number, row: number, coverage: number): boolean {
  if (coverage >= 100) return true;
  if (coverage <= 0) return false;
  return cellHash(col, row, 3) * 100 < coverage;
}

const SETS: Record<Exclude<CharSet, "custom">, string> = {
  // Darkest first, so index = value * (len - 1) reads as "more ink, more mass".
  binary: "01",
  ascii: " .:-=+*#%@",
  blocks: " ░▒▓█",
  hex: "0123456789ABCDEF",
  katakana: "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ",
  dots: " ⠁⠃⠇⠏⠟⠿⡿⣿",
};

export function charsFor(set: CharSet, custom: string): string {
  if (set === "custom") return custom.length > 0 ? custom : SETS.ascii;
  return SETS[set] ?? SETS.ascii;
}

/**
 * Pick a glyph for a value.
 *
 * Sets whose characters are ordered by visual weight (ascii, blocks, dots) map
 * value straight onto the ramp. Sets that are just an alphabet (binary, hex,
 * katakana) have no such order, so picking by value would print a wall of the
 * same character across any flat region; those are chosen by hash instead, and
 * the value drives brightness rather than which glyph appears.
 */
export function glyphFor(
  set: CharSet,
  chars: string,
  value: number,
  col: number,
  row: number,
  time: number,
): string {
  if (chars.length === 0) return " ";
  const ordered = set === "ascii" || set === "blocks" || set === "dots";
  if (ordered) {
    const i = Math.round(clamp01(value) * (chars.length - 1));
    return chars[i] ?? " ";
  }
  // Re-rolled slowly over time so the field churns the way a terminal does.
  const tick = Math.floor(time * 6);
  const i = Math.floor(cellHash(col, row, tick) * chars.length) % chars.length;
  return chars[i] ?? " ";
}
