import { SELF_ANIMATED, TEXT_MODES, drawCell } from "./modes";
import {
  blurFilter,
  bloom,
  chromatic,
  colourFilter,
  drawLights,
  filmDust,
  filmGrain,
  glitch,
  halftone,
  pixelate,
  scanLines,
  vignette,
} from "./post";
import { computeEdges, isCovered, resolveValue, sampleGrid, type Grid } from "./sample";
import { withDefaults, type AsciiParams } from "./types";

export * from "./types";
export { sampleGrid, resolveValue, isCovered, computeEdges } from "./sample";

/**
 * The code-rain renderer.
 *
 * Runs the pipeline in the order the spec sets out: background, then a shape
 * per grid cell, then colour adjustment, then post-effects, then lights, then
 * the reveal mask. Each stage is skipped entirely when its parameters say it
 * would be a no-op, which is what keeps a full-screen 14px grid inside a frame.
 *
 * The source is anything drawable, or a function that paints one. That last
 * form matters here: the spec names a photo this project does not have, and a
 * painter lets the effect run over the wordmark, a gradient or another canvas
 * without one.
 */

export type Source =
  | HTMLImageElement
  | HTMLCanvasElement
  | HTMLVideoElement
  | ((ctx: CanvasRenderingContext2D, width: number, height: number) => void);

type Scratch = {
  source: HTMLCanvasElement;
  bloom: HTMLCanvasElement;
  chromatic: HTMLCanvasElement;
  grain: HTMLCanvasElement;
  glitch: HTMLCanvasElement;
  halftone: HTMLCanvasElement;
  pixelate: HTMLCanvasElement;
  mask: HTMLCanvasElement;
};

const makeCanvas = () => document.createElement("canvas");

function makeScratch(): Scratch {
  return {
    source: makeCanvas(),
    bloom: makeCanvas(),
    chromatic: makeCanvas(),
    grain: makeCanvas(),
    glitch: makeCanvas(),
    halftone: makeCanvas(),
    pixelate: makeCanvas(),
    mask: makeCanvas(),
  };
}

function paintSource(
  ctx: CanvasRenderingContext2D,
  source: Source,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);
  if (typeof source === "function") {
    source(ctx, width, height);
    return;
  }
  /* Cover, not stretch: an aspect-correct crop, because a face squashed to the
     viewport is worse than a face with its edges outside it. */
  const sw = "naturalWidth" in source ? source.naturalWidth : (source as HTMLCanvasElement).width;
  const sh = "naturalHeight" in source ? source.naturalHeight : (source as HTMLCanvasElement).height;
  if (!sw || !sh) return;
  const scale = Math.max(width / sw, height / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(source as CanvasImageSource, (width - dw) / 2, (height - dh) / 2, dw, dh);
}

export class AsciiRainRenderer {
  private ctx: CanvasRenderingContext2D;
  private scratch = makeScratch();
  private grid: Grid | null = null;
  private gridKey = "";
  private maskImage: HTMLImageElement | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private source: Source,
    private params: AsciiParams,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas2D is unavailable");
    this.ctx = ctx;
    this.loadMask();
  }

  setParams(params: Partial<AsciiParams>): void {
    this.params = withDefaults({ ...this.params, ...params });
    this.loadMask();
  }

  setSource(source: Source): void {
    this.source = source;
    this.gridKey = ""; // force a resample
  }

  private loadMask(): void {
    const { mask } = this.params;
    if (!mask.enabled || !mask.dataUrl) {
      this.maskImage = null;
      return;
    }
    const img = new Image();
    img.onload = () => {
      this.maskImage = img;
    };
    img.src = mask.dataUrl;
  }

  /**
   * Resample the source into the cell grid.
   *
   * Only redone when the size, cell size or source changes: for a still image
   * the grid is identical every frame, and re-reading it is a full getImageData
   * per frame for no new information. A video source re-reads every frame,
   * which is what `live` is for.
   */
  private ensureGrid(width: number, height: number, live: boolean): Grid {
    const key = `${width}x${height}@${this.params.cellSize}`;
    if (!live && this.grid && this.gridKey === key) return this.grid;

    const { source: canvas } = this.scratch;
    canvas.width = width;
    canvas.height = height;
    const sctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!sctx) throw new Error("Canvas2D is unavailable");
    paintSource(sctx, this.source, width, height);

    const data = sctx.getImageData(0, 0, width, height).data;
    const grid = sampleGrid(data, width, height, this.params.cellSize);
    if (this.params.edgeEmphasis > 0) computeEdges(grid);

    this.grid = grid;
    this.gridKey = key;
    return grid;
  }

  /** Stage 1: whatever shows behind the effect. */
  private drawBackground(width: number, height: number): void {
    const { ctx, params } = this;
    const alpha = params.bgOpacity / 100;
    ctx.clearRect(0, 0, width, height);
    if (params.bgMode === "none" || alpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    if (params.bgMode === "solid") {
      ctx.fillStyle = params.bgColor ?? "#000";
      ctx.fillRect(0, 0, width, height);
    } else {
      if (params.bgMode === "blur" && params.bgBlur > 0) {
        ctx.filter = `blur(${params.bgBlur}px)`;
      }
      ctx.drawImage(this.scratch.source, 0, 0, width, height);
    }
    ctx.restore();
  }

  /** Stage 3: a shape per covered cell. */
  private drawCells(grid: Grid, time: number): void {
    const { ctx, params } = this;
    const size = Math.max(1, Math.round(params.cellSize));
    const selfAnimated = SELF_ANIMATED.has(params.renderMode);

    ctx.save();
    ctx.globalCompositeOperation = params.styleBlend;
    // The ink is set once. Per-cell fillStyle would be thousands of state
    // changes a frame for a colour that only two modes actually vary.
    ctx.fillStyle = params.tint;
    if (TEXT_MODES.has(params.renderMode)) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
    }

    for (const cell of grid.cells) {
      if (!isCovered(cell.col, cell.row, params.coverage)) continue;
      const v = selfAnimated
        ? resolveValue(cell, { ...params, animated: false }, time)
        : resolveValue(cell, params, time);
      if (v <= 0.01 && params.renderMode !== "matrix") continue;

      const before = ctx.globalAlpha;
      /*
       * Value drives opacity as well as size, which is what stops a low cell
       * reading as a small bright dot instead of a dim one.
       *
       * The floor is low on purpose. At 0.25 every dark cell still showed at a
       * quarter strength, so the whole field came out an even wash and
       * whatever the source contained was invisible in it. At 0.08 the dark
       * areas go dark and the image reads through the rain, which is the point
       * of sampling a source at all.
       */
      ctx.globalAlpha = before * (params.renderMode === "matrix" ? 1 : Math.min(1, 0.08 + v * 1.15));
      drawCell(params.renderMode, { ctx, cell, v, size, params, time });
      ctx.globalAlpha = before;
    }
    ctx.restore();
  }

  /** Stage 4: colour adjustments, then the tint, then blur. */
  private applyColour(width: number, height: number): void {
    const { ctx, params } = this;

    const filter = colourFilter(params);
    if (filter !== "none") {
      const copy = this.scratch.chromatic;
      if (copy.width !== width || copy.height !== height) {
        copy.width = width;
        copy.height = height;
      }
      const cctx = copy.getContext("2d");
      if (cctx) {
        cctx.clearRect(0, 0, width, height);
        cctx.drawImage(ctx.canvas, 0, 0);
        ctx.save();
        ctx.clearRect(0, 0, width, height);
        ctx.filter = filter;
        ctx.drawImage(copy, 0, 0);
        ctx.restore();
      }
    }

    if (params.tintOpacity > 0) {
      ctx.save();
      ctx.globalCompositeOperation = params.overlayBlend;
      ctx.globalAlpha = params.tintOpacity / 100;
      ctx.fillStyle = params.tint;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    const blur = blurFilter(params);
    if (blur !== "none") {
      const copy = this.scratch.pixelate;
      if (copy.width !== width || copy.height !== height) {
        copy.width = width;
        copy.height = height;
      }
      const cctx = copy.getContext("2d");
      if (cctx) {
        cctx.clearRect(0, 0, width, height);
        cctx.drawImage(ctx.canvas, 0, 0);
        ctx.save();
        ctx.clearRect(0, 0, width, height);
        ctx.filter = blur;
        ctx.drawImage(copy, 0, 0);
        ctx.restore();
      }
    }
  }

  /** Stage 5: the post-effect stack, in the spec's order. */
  private applyPost(width: number, height: number, time: number): void {
    const { ctx, params } = this;
    const fx = (key: keyof typeof params.pfx) => {
      const t = params.pfx[key];
      return t?.enabled ? Math.max(0, Math.min(1, t.intensity / 100)) : 0;
    };
    const base = { ctx, width, height, time };

    if (fx("pixelate")) pixelate({ ...base, amount: fx("pixelate") }, this.scratch.pixelate);
    if (fx("halftone")) halftone({ ...base, amount: fx("halftone") }, this.scratch.halftone);
    if (fx("bloom")) bloom({ ...base, amount: fx("bloom") }, this.scratch.bloom);
    if (fx("chromatic")) chromatic({ ...base, amount: fx("chromatic") }, this.scratch.chromatic);
    if (fx("glitch")) glitch({ ...base, amount: fx("glitch") }, this.scratch.glitch);
    if (fx("scanLines")) scanLines({ ...base, amount: fx("scanLines") });
    if (fx("filmGrain")) filmGrain({ ...base, amount: fx("filmGrain") }, this.scratch.grain);
    if (fx("filmDust")) filmDust({ ...base, amount: fx("filmDust") });
    if (fx("vignette")) vignette({ ...base, amount: fx("vignette") });
  }

  /** Stage 7: reveal the plain source back through the mask. */
  private applyMask(width: number, height: number): void {
    const { ctx, params } = this;
    if (!params.mask.enabled || !this.maskImage) return;

    const layer = this.scratch.mask;
    if (layer.width !== width || layer.height !== height) {
      layer.width = width;
      layer.height = height;
    }
    const lctx = layer.getContext("2d");
    if (!lctx) return;

    lctx.clearRect(0, 0, width, height);
    lctx.drawImage(this.scratch.source, 0, 0, width, height);
    lctx.globalCompositeOperation = params.mask.invert ? "destination-out" : "destination-in";
    lctx.drawImage(this.maskImage, 0, 0, width, height);
    lctx.globalCompositeOperation = "source-over";

    ctx.drawImage(layer, 0, 0);
  }

  /** Draw one frame. `time` is seconds; the caller owns the clock. */
  render(time: number): void {
    const { canvas, params } = this;
    const width = canvas.width;
    const height = canvas.height;
    if (width === 0 || height === 0) return;

    const live = typeof this.source !== "function" && "readyState" in (this.source as object);
    const grid = this.ensureGrid(width, height, live as boolean);

    this.drawBackground(width, height);
    this.drawCells(grid, time);
    this.applyColour(width, height);
    this.applyPost(width, height, time);
    if (params.lights.enabled && params.lights.points.length > 0) {
      drawLights(this.ctx, width, height, params.lights.points);
    }
    this.applyMask(width, height);
  }
}

/**
 * Drive a renderer with requestAnimationFrame.
 *
 * Returns a stop function. The loop parks itself when the tab is hidden, and
 * draws exactly one frame when the viewer has asked for reduced motion, since
 * `animated` describes an effect and reduced motion is not a slower one.
 */
export function runAsciiRain(
  canvas: HTMLCanvasElement,
  source: Source,
  partial: Partial<AsciiParams> = {},
): () => void {
  const params = withDefaults(partial);
  const renderer = new AsciiRainRenderer(canvas, source, params);
  const still =
    !params.animated || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (still) {
    renderer.render(0);
    return () => {};
  }

  const speed = params.animSpeed.enabled ? params.animSpeed.intensity / 100 : 1;
  const start = performance.now();
  let frame = 0;

  const tick = (now: number) => {
    renderer.render(((now - start) / 1000) * speed);
    frame = requestAnimationFrame(tick);
  };

  const onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else if (!frame) {
      frame = requestAnimationFrame(tick);
    }
  };

  document.addEventListener("visibilitychange", onVisibility);
  frame = requestAnimationFrame(tick);

  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    if (frame) cancelAnimationFrame(frame);
  };
}
