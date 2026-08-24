import { cellHash } from "./sample";
import type { AsciiParams, LightPoint } from "./types";

/**
 * Post-effects, layered over the rendered frame in the order the spec lists.
 *
 * Each takes an intensity of 0..100 and is a no-op at 0, so a caller can leave
 * them all enabled and dial them to nothing. They draw onto the same context,
 * mostly with a composite operation rather than by reading pixels back:
 * getImageData on a full-screen canvas every frame is the one thing certain to
 * make this stutter, so only the effects that genuinely need pixels take them.
 */

type Fx = {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** 0..1 */
  amount: number;
  time: number;
};

export function scanLines({ ctx, width, height, amount }: Fx): void {
  if (amount <= 0) return;
  ctx.save();
  ctx.globalAlpha = amount * 0.5;
  ctx.fillStyle = "#000";
  // Two-pixel pitch: one dark line, one gap. Finer than this and it aliases
  // into a flat grey the moment the canvas is not at 1:1.
  for (let y = 0; y < height; y += 2) ctx.fillRect(0, y, width, 1);
  ctx.restore();
}

export function vignette({ ctx, width, height, amount }: Fx): void {
  if (amount <= 0) return;
  const cx = width / 2;
  const cy = height / 2;
  const outer = Math.hypot(cx, cy);
  const grad = ctx.createRadialGradient(cx, cy, outer * 0.35, cx, cy, outer);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, `rgba(0,0,0,${(amount * 0.9).toFixed(3)})`);
  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/**
 * Bloom: a blurred copy of the frame added back over itself.
 *
 * Needs a scratch canvas because a context cannot filter itself in place. The
 * copy is drawn at a quarter scale and blown back up, which is both cheaper
 * than blurring at full size and a wider bleed for the same filter radius.
 */
export function bloom({ ctx, width, height, amount }: Fx, scratch: HTMLCanvasElement): void {
  if (amount <= 0) return;
  const w = Math.max(1, Math.round(width / 4));
  const h = Math.max(1, Math.round(height / 4));
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  const sctx = scratch.getContext("2d");
  if (!sctx) return;
  sctx.clearRect(0, 0, w, h);
  sctx.drawImage(ctx.canvas, 0, 0, w, h);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = amount * 0.75;
  ctx.filter = `blur(${(amount * 6 + 2).toFixed(1)}px)`;
  ctx.drawImage(scratch, 0, 0, width, height);
  ctx.restore();
}

/** Chromatic aberration: the red and blue channels pulled apart horizontally. */
export function chromatic({ ctx, width, height, amount }: Fx, scratch: HTMLCanvasElement): void {
  if (amount <= 0) return;
  if (scratch.width !== width || scratch.height !== height) {
    scratch.width = width;
    scratch.height = height;
  }
  const sctx = scratch.getContext("2d");
  if (!sctx) return;
  sctx.clearRect(0, 0, width, height);
  sctx.drawImage(ctx.canvas, 0, 0);

  const shift = amount * 6;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.5;
  ctx.drawImage(scratch, -shift, 0);
  ctx.drawImage(scratch, shift, 0);
  ctx.restore();
}

/**
 * Film grain.
 *
 * Drawn from a small tile that is regenerated a few times a second rather than
 * every frame: at 60fps a fresh full-screen noise field is both invisible as
 * detail and the most expensive thing on the page.
 */
export function filmGrain({ ctx, width, height, amount, time }: Fx, tile: HTMLCanvasElement): void {
  if (amount <= 0) return;
  const size = 128;
  const tick = Math.floor(time * 12);
  if (tile.width !== size || tile.dataset.tick !== String(tick)) {
    tile.width = size;
    tile.height = size;
    tile.dataset.tick = String(tick);
    const tctx = tile.getContext("2d");
    if (tctx) {
      const img = tctx.createImageData(size, size);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (cellHash(i, tick, 31) * 255) | 0;
        img.data[i] = n;
        img.data[i + 1] = n;
        img.data[i + 2] = n;
        img.data[i + 3] = 255;
      }
      tctx.putImageData(img, 0, 0);
    }
  }

  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = amount * 0.35;
  const pattern = ctx.createPattern(tile, "repeat");
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

/**
 * Glitch: a few horizontal bands displaced sideways.
 *
 * Bands are picked from a hash of a slow tick rather than at random per frame,
 * so a band holds for a moment and reads as a tear rather than as noise.
 */
export function glitch({ ctx, width, height, amount, time }: Fx, scratch: HTMLCanvasElement): void {
  if (amount <= 0) return;
  const tick = Math.floor(time * 6);
  // Not every tick glitches; a constant tear is just a wobble.
  if (cellHash(tick, 0, 41) > 0.35 + amount * 0.3) return;

  if (scratch.width !== width || scratch.height !== height) {
    scratch.width = width;
    scratch.height = height;
  }
  const sctx = scratch.getContext("2d");
  if (!sctx) return;
  sctx.clearRect(0, 0, width, height);
  sctx.drawImage(ctx.canvas, 0, 0);

  const bands = 1 + Math.floor(amount * 4);
  for (let i = 0; i < bands; i++) {
    const y = cellHash(tick, i, 43) * height;
    const h = 4 + cellHash(tick, i, 47) * height * 0.06;
    const dx = (cellHash(tick, i, 53) - 0.5) * amount * 60;
    ctx.drawImage(scratch, 0, y, width, h, dx, y, width, h);
  }
}

/** Halftone: the frame knocked back and re-dotted on a fixed pitch. */
export function halftone({ ctx, width, height, amount }: Fx, scratch: HTMLCanvasElement): void {
  if (amount <= 0) return;
  const pitch = Math.max(3, Math.round(4 + amount * 8));
  const w = Math.max(1, Math.ceil(width / pitch));
  const h = Math.max(1, Math.ceil(height / pitch));
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  const sctx = scratch.getContext("2d");
  if (!sctx) return;
  sctx.clearRect(0, 0, w, h);
  sctx.drawImage(ctx.canvas, 0, 0, w, h);
  const data = sctx.getImageData(0, 0, w, h).data;

  ctx.save();
  ctx.globalAlpha = amount;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      if (lum < 0.02) continue;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath();
      ctx.arc((x + 0.5) * pitch, (y + 0.5) * pitch, (pitch / 2) * lum * amount, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Pixelate: down to a small canvas and back up with smoothing off. */
export function pixelate({ ctx, width, height, amount }: Fx, scratch: HTMLCanvasElement): void {
  if (amount <= 0) return;
  const factor = Math.max(2, Math.round(amount * 24));
  const w = Math.max(1, Math.round(width / factor));
  const h = Math.max(1, Math.round(height / factor));
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  const sctx = scratch.getContext("2d");
  if (!sctx) return;
  sctx.imageSmoothingEnabled = false;
  sctx.clearRect(0, 0, w, h);
  sctx.drawImage(ctx.canvas, 0, 0, w, h);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(scratch, 0, 0, width, height);
  ctx.restore();
}

/** Film dust: sparse specks and the occasional hair. */
export function filmDust({ ctx, width, height, amount, time }: Fx): void {
  if (amount <= 0) return;
  const tick = Math.floor(time * 8);
  const specks = Math.round(amount * 60);
  ctx.save();
  ctx.globalAlpha = amount * 0.5;
  ctx.fillStyle = "#fff";
  for (let i = 0; i < specks; i++) {
    const x = cellHash(tick, i, 61) * width;
    const y = cellHash(tick, i, 67) * height;
    const r = 0.4 + cellHash(tick, i, 71) * 1.4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (cellHash(tick, 0, 73) < 0.25) {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 0.8;
    const x = cellHash(tick, 1, 79) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.quadraticCurveTo(x + 14, height / 2, x - 8, height);
    ctx.stroke();
  }
  ctx.restore();
}

/** Additive glow at each configured light. */
export function drawLights(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  points: LightPoint[],
): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of points) {
    const cx = p.x * width;
    const cy = p.y * height;
    const r = Math.max(1, p.radius * Math.max(width, height));
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const a = Math.max(0, Math.min(1, p.intensity / 100));
    grad.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();
}

/**
 * The CSS filter string for the colour adjustments, in the spec's order.
 *
 * Applied as one `ctx.filter` rather than as separate passes: the browser
 * composes them in a single step, and doing it by hand would mean four
 * full-frame pixel walks for a result the platform already has.
 */
export function colourFilter(params: AsciiParams): string {
  const parts: string[] = [];
  if (params.brightness !== 0) parts.push(`brightness(${(100 + params.brightness) / 100})`);
  if (params.contrast !== 100) parts.push(`contrast(${params.contrast / 100})`);
  if (params.saturation !== 100) parts.push(`saturate(${params.saturation / 100})`);
  if (params.grayscale > 0) parts.push(`grayscale(${params.grayscale / 100})`);
  return parts.length > 0 ? parts.join(" ") : "none";
}

/** The CSS filter string for whichever blur type is selected. */
export function blurFilter(params: AsciiParams): string {
  if (params.blurType === "off" || params.blurAmount <= 0) return "none";
  // Only gaussian is a plain filter; the positional blurs are masked passes
  // handled by the renderer, and all of them start from the same radius.
  return `blur(${(params.blurAmount / 10).toFixed(2)}px)`;
}
