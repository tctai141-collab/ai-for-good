import { cellHash, charsFor, clamp01, glyphFor, type Cell } from "./sample";
import type { AsciiParams, RenderMode } from "./types";

/**
 * One draw function per render mode.
 *
 * Each is handed a cell, the value that cell resolved to (0..1, everything
 * already applied) and the cell size, and draws a single primitive inside that
 * box. None of them set fillStyle for colour: the pipeline sets the ink once
 * before the loop, because switching fillStyle per cell on a 14px grid across
 * a full-screen canvas is thousands of state changes a frame for a colour that
 * usually has not changed.
 */

export type DrawArgs = {
  ctx: CanvasRenderingContext2D;
  cell: Cell;
  /** Resolved 0..1 value for this cell. */
  v: number;
  size: number;
  params: AsciiParams;
  time: number;
};

const TAU = Math.PI * 2;

/** Centre of the cell, which nearly every mode wants. */
const mid = (cell: Cell, size: number) => ({ cx: cell.x + size / 2, cy: cell.y + size / 2 });

function polygon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, sides: number, rotate = 0) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rotate + (i / sides) * TAU;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, outer: number, points = 5) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : outer * 0.45;
    const a = -Math.PI / 2 + (i / (points * 2)) * TAU;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function heart(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.75);
  ctx.bezierCurveTo(cx - r * 1.6, cy - r * 0.4, cx - r * 0.5, cy - r * 1.2, cx, cy - r * 0.35);
  ctx.bezierCurveTo(cx + r * 0.5, cy - r * 1.2, cx + r * 1.6, cy - r * 0.4, cx, cy + r * 0.75);
  ctx.closePath();
  ctx.fill();
}

/** 4x4 ordered Bayer matrix, the classic dither threshold map. */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const DRAW: Record<RenderMode, (a: DrawArgs) => void> = {
  characters({ ctx, cell, v, size, params, time }) {
    const chars = charsFor(params.charSet, params.customChars);
    const glyph = glyphFor(params.charSet, chars, v, cell.col, cell.row, time);
    if (glyph === " ") return;
    const { cx, cy } = mid(cell, size);
    /* Scaled by value so bright cells read heavier, with a floor: a glyph that
       shrinks to nothing leaves a hole rather than a dark patch. */
    ctx.font = `${(size * (0.62 + v * 0.38)).toFixed(2)}px ui-monospace, "SF Mono", Menlo, monospace`;
    ctx.fillText(glyph, cx, cy);
  },

  dither({ ctx, cell, v, size }) {
    const threshold = (BAYER[cell.row % 4]![cell.col % 4]! + 0.5) / 16;
    if (v < threshold) return;
    ctx.fillRect(cell.x, cell.y, size, size);
  },

  mosaic({ ctx, cell, v, size }) {
    const inset = (1 - v) * size * 0.35;
    ctx.fillRect(cell.x + inset, cell.y + inset, size - inset * 2, size - inset * 2);
  },

  pixel({ ctx, cell, size }) {
    ctx.fillRect(cell.x, cell.y, size, size);
  },

  dots({ ctx, cell, v, size }) {
    const { cx, cy } = mid(cell, size);
    ctx.beginPath();
    ctx.arc(cx, cy, (size / 2) * v, 0, TAU);
    ctx.fill();
  },

  cross({ ctx, cell, v, size }) {
    const { cx, cy } = mid(cell, size);
    const arm = (size / 2) * v;
    const w = Math.max(1, size * 0.16 * v);
    ctx.fillRect(cx - arm, cy - w / 2, arm * 2, w);
    ctx.fillRect(cx - w / 2, cy - arm, w, arm * 2);
  },

  diamond({ ctx, cell, v, size }) {
    const { cx, cy } = mid(cell, size);
    polygon(ctx, cx, cy, (size / 2) * v, 4, Math.PI / 4);
  },

  voxel({ ctx, cell, v, size }) {
    /* An isometric cube whose height tracks value, so the field reads as a
       relief map rather than as flat tiles. */
    const h = size * v * 0.6;
    const x = cell.x;
    const y = cell.y + size - h;
    const w = size;
    ctx.globalAlpha *= 1;
    ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.globalAlpha *= 0.55;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w * 0.25, y - w * 0.2);
    ctx.lineTo(x + w * 1.25, y - w * 0.2);
    ctx.lineTo(x + w, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },

  lego({ ctx, cell, v, size }) {
    ctx.fillRect(cell.x, cell.y, size, size);
    const { cx } = mid(cell, size);
    ctx.save();
    ctx.globalAlpha *= 0.45;
    ctx.beginPath();
    ctx.arc(cx, cell.y + size * 0.32, size * 0.2 * (0.5 + v * 0.5), 0, TAU);
    ctx.fill();
    ctx.restore();
  },

  mixed(args) {
    const pick = cellHash(args.cell.col, args.cell.row, 21);
    const modes: RenderMode[] = ["dots", "cross", "diamond", "pixel", "rings"];
    const mode = modes[Math.floor(pick * modes.length) % modes.length]!;
    DRAW[mode](args);
  },

  lines({ ctx, cell, v, size }) {
    const h = Math.max(1, size * v);
    ctx.fillRect(cell.x, cell.y + (size - h) / 2, size, h);
  },

  diagonal({ ctx, cell, v, size }) {
    ctx.save();
    ctx.lineWidth = Math.max(0.5, size * 0.22 * v);
    ctx.strokeStyle = ctx.fillStyle;
    ctx.beginPath();
    ctx.moveTo(cell.x, cell.y + size);
    ctx.lineTo(cell.x + size, cell.y);
    ctx.stroke();
    ctx.restore();
  },

  braille({ ctx, cell, v, size }) {
    /* Six dots on a 2x3 lattice, lit in order, which is how a braille cell
       actually fills and gives six clean steps of tone from one glyph box. */
    const lit = Math.round(v * 6);
    const dot = size * 0.13;
    for (let i = 0; i < lit; i++) {
      const dx = i % 2;
      const dy = Math.floor(i / 2);
      ctx.beginPath();
      ctx.arc(cell.x + size * (0.32 + dx * 0.36), cell.y + size * (0.22 + dy * 0.28), dot, 0, TAU);
      ctx.fill();
    }
  },

  disco({ ctx, cell, v, size, time }) {
    const { cx, cy } = mid(cell, size);
    ctx.save();
    /* The one mode that sets its own colour: the point of it is that each
       facet is a different hue, cycling. */
    const hue = (cellHash(cell.col, cell.row, 5) * 360 + time * 40) % 360;
    ctx.fillStyle = `hsl(${hue.toFixed(1)}, 90%, ${(35 + v * 45).toFixed(1)}%)`;
    polygon(ctx, cx, cy, (size / 2) * (0.5 + v * 0.5), 6);
    ctx.restore();
  },

  hexdump({ ctx, cell, v, size, time }) {
    const chars = "0123456789ABCDEF";
    const tick = Math.floor(time * 5);
    const glyph = chars[Math.floor(cellHash(cell.col, cell.row, tick) * 16) % 16]!;
    const { cx, cy } = mid(cell, size);
    ctx.font = `${(size * 0.8).toFixed(2)}px ui-monospace, Menlo, monospace`;
    ctx.fillText(glyph, cx, cy);
  },

  matrix({ ctx, cell, v, size, time, params }) {
    /*
     * Self-animated, per the spec, so it ignores animStyle and runs its own
     * fall. Each column has its own speed and offset from the hash, and a head
     * that is brighter than its tail; the image only decides which columns are
     * dense enough to show at all.
     */
    const speed = 2 + cellHash(cell.col, 0, 13) * 6;
    const offset = cellHash(cell.col, 0, 17) * 60;
    const head = (time * speed + offset) % 40;
    const dist = (cell.row - head + 40) % 40;
    if (dist > 12) return;

    const fall = 1 - dist / 12;
    const alpha = clamp01(fall * (0.25 + v));
    if (alpha <= 0.02) return;

    const chars = charsFor(params.charSet === "binary" ? "katakana" : params.charSet, params.customChars);
    const tick = Math.floor(time * 8);
    const glyph = chars[Math.floor(cellHash(cell.col, cell.row, tick) * chars.length) % chars.length]!;
    const { cx, cy } = mid(cell, size);

    ctx.save();
    ctx.globalAlpha *= alpha;
    // The leading glyph is near-white; the tail keeps the ink colour.
    if (dist < 1) ctx.fillStyle = "#d8ffe8";
    ctx.font = `${(size * 0.85).toFixed(2)}px ui-monospace, Menlo, monospace`;
    ctx.fillText(glyph, cx, cy);
    ctx.restore();
  },

  rings({ ctx, cell, v, size }) {
    const { cx, cy } = mid(cell, size);
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = Math.max(0.6, size * 0.12);
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(0.5, (size / 2 - ctx.lineWidth) * v), 0, TAU);
    ctx.stroke();
    ctx.restore();
  },

  hearts({ ctx, cell, v, size }) {
    const { cx, cy } = mid(cell, size);
    heart(ctx, cx, cy, (size / 2) * v);
  },

  stars({ ctx, cell, v, size }) {
    const { cx, cy } = mid(cell, size);
    star(ctx, cx, cy, (size / 2) * v);
  },

  hexagons({ ctx, cell, v, size }) {
    /* Honeycomb: odd rows step half a cell across, which is what turns a
       square grid into a tessellation. */
    const offset = cell.row % 2 === 1 ? size / 2 : 0;
    const cx = cell.x + size / 2 + offset;
    const cy = cell.y + size / 2;
    polygon(ctx, cx, cy, (size / 2) * v, 6, Math.PI / 6);
  },

  triangles({ ctx, cell, v, size }) {
    /* Two triangles per cell, alternating orientation, so a run of cells reads
       as a low-poly surface rather than a row of arrows. */
    const up = (cell.col + cell.row) % 2 === 0;
    const s = size * v;
    const x = cell.x + (size - s) / 2;
    const y = cell.y + (size - s) / 2;
    ctx.beginPath();
    if (up) {
      ctx.moveTo(x + s / 2, y);
      ctx.lineTo(x + s, y + s);
      ctx.lineTo(x, y + s);
    } else {
      ctx.moveTo(x, y);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x + s / 2, y + s);
    }
    ctx.closePath();
    ctx.fill();
  },

  bubbles({ ctx, cell, v, size }) {
    const { cx, cy } = mid(cell, size);
    const r = (size / 2) * v;
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = Math.max(0.5, size * 0.07);
    ctx.globalAlpha *= 0.85;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(0.5, r), 0, TAU);
    ctx.stroke();
    // The highlight is what makes it a bubble rather than a ring.
    ctx.globalAlpha *= 0.7;
    ctx.beginPath();
    ctx.arc(cx - r * 0.3, cy - r * 0.3, Math.max(0.4, r * 0.22), 0, TAU);
    ctx.fill();
    ctx.restore();
  },

  hatch({ ctx, cell, v, size }) {
    /* Pencil cross-hatch: one direction for mid tones, both for dark ones,
       which is how hatching actually builds density. */
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = Math.max(0.4, size * 0.08);
    ctx.globalAlpha *= 0.9;
    const strokes = Math.round(v * 3);
    for (let i = 0; i < strokes; i++) {
      const o = (i + 1) * (size / (strokes + 1));
      ctx.beginPath();
      ctx.moveTo(cell.x, cell.y + o);
      ctx.lineTo(cell.x + o, cell.y);
      ctx.stroke();
    }
    if (v > 0.6) {
      for (let i = 0; i < strokes; i++) {
        const o = (i + 1) * (size / (strokes + 1));
        ctx.beginPath();
        ctx.moveTo(cell.x + size - o, cell.y);
        ctx.lineTo(cell.x + size, cell.y + o);
        ctx.stroke();
      }
    }
    ctx.restore();
  },

  contour({ ctx, cell, v, size }) {
    /*
     * Topographic lines: draw only where the value crosses one of a set of
     * evenly spaced levels. Everything between levels stays empty, which is
     * what makes it read as a contour map and not as a gradient.
     */
    const levels = 6;
    const band = (v * levels) % 1;
    if (band > 0.18) return;
    ctx.fillRect(cell.x, cell.y + size * 0.4, size, Math.max(1, size * 0.2));
  },

  halfblocks({ ctx, cell, v, size }) {
    /*
     * Two half-height blocks per cell, so vertical detail is twice the grid.
     * The value is split into an upper and a lower half rather than shared,
     * which is the whole reason this mode exists.
     */
    const half = size / 2;
    const upper = clamp01(v * 2);
    const lower = clamp01(v * 2 - 1);
    if (upper > 0.05) {
      ctx.save();
      ctx.globalAlpha *= upper;
      ctx.fillRect(cell.x, cell.y, size, half);
      ctx.restore();
    }
    if (lower > 0.05) {
      ctx.save();
      ctx.globalAlpha *= lower;
      ctx.fillRect(cell.x, cell.y + half, size, half);
      ctx.restore();
    }
  },
};

export function drawCell(mode: RenderMode, args: DrawArgs): void {
  (DRAW[mode] ?? DRAW.characters)(args);
}

/** Modes that animate themselves and so ignore animStyle. */
export const SELF_ANIMATED: ReadonlySet<RenderMode> = new Set<RenderMode>(["matrix"]);

/** Modes that centre their glyph, so the pipeline sets the text baseline once. */
export const TEXT_MODES: ReadonlySet<RenderMode> = new Set<RenderMode>([
  "characters",
  "hexdump",
  "matrix",
]);
