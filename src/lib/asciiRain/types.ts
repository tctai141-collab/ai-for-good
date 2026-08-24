/**
 * Parameters for the code-rain renderer.
 *
 * The shape is taken from the supplied spec verbatim, including the names that
 * only apply to one blur type or one render mode. Keeping them as given means
 * a settings blob from the editor drops straight in with no translation layer
 * to get out of step.
 */

export type RenderMode =
  | "characters"
  | "dither"
  | "mosaic"
  | "pixel"
  | "dots"
  | "cross"
  | "diamond"
  | "voxel"
  | "lego"
  | "mixed"
  | "lines"
  | "diagonal"
  | "braille"
  | "disco"
  | "hexdump"
  | "matrix"
  | "rings"
  | "hearts"
  | "stars"
  | "hexagons"
  | "triangles"
  | "bubbles"
  | "hatch"
  | "contour"
  | "halfblocks";

export type BgMode = "blur" | "solid" | "photo" | "none";
export type CharSet = "binary" | "ascii" | "blocks" | "hex" | "katakana" | "dots" | "custom";
export type AnimStyle = "wave" | "pulse" | "shimmer" | "ripple" | "flicker";
export type BlurType = "off" | "gaussian" | "directional" | "tilt" | "lens" | "progressive";

export type Toggle = { enabled: boolean; intensity: number };

export type PostEffectKey =
  | "scanLines"
  | "vignette"
  | "bloom"
  | "chromatic"
  | "filmGrain"
  | "glitch"
  | "halftone"
  | "pixelate"
  | "filmDust";

export type LightPoint = { x: number; y: number; radius: number; intensity: number };

export type AsciiParams = {
  renderMode: RenderMode;
  bgMode: BgMode;
  bgBlur: number;
  bgOpacity: number;
  bgColor?: string;

  cellSize: number;
  coverage: number;
  invert: boolean;
  styleBlend: GlobalCompositeOperation;

  charSet: CharSet;
  customChars: string;

  brightness: number;
  contrast: number;
  edgeEmphasis: number;
  density: number;
  toneCurve: { x: number; y: number }[];

  tint: string;
  tintOpacity: number;
  overlayBlend: GlobalCompositeOperation;
  saturation: number;
  grayscale: number;

  blurType: BlurType;
  blurAmount: number;
  blurAngle: number;
  directionalBothSides: boolean;
  tiltFocus: number;
  tiltPosition: number;
  tiltFeather: number;
  lensFocus: number;
  blurCenterX: number;
  blurCenterY: number;
  progressivePosition: number;
  progressiveReverse: boolean;

  pfx: Record<PostEffectKey, Toggle>;

  animated: boolean;
  animStyle: AnimStyle;
  animSpeed: Toggle;
  animIntensity: Toggle;

  lights: { enabled: boolean; points: LightPoint[] };
  mask: {
    enabled: boolean;
    tool: string;
    brushSize: number;
    showOverlay: boolean;
    invert: boolean;
    dataUrl: string | null;
    shapes: unknown[];
  };
};

/** The supplied preset, used as the default and as the base for any partial. */
export const CODE_RAIN: AsciiParams = {
  renderMode: "characters",
  bgMode: "solid",
  bgBlur: 12,
  bgOpacity: 90,
  bgColor: "#000000",

  cellSize: 14,
  coverage: 96,
  invert: false,
  styleBlend: "source-over",

  charSet: "binary",
  customChars: "",

  brightness: 0,
  contrast: 115,
  edgeEmphasis: 40,
  density: 0,
  toneCurve: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],

  tint: "#00ff66",
  tintOpacity: 45,
  overlayBlend: "overlay",
  saturation: 100,
  grayscale: 0,

  blurType: "off",
  blurAmount: 35,
  blurAngle: 0,
  directionalBothSides: false,
  tiltFocus: 35,
  tiltPosition: 50,
  tiltFeather: 15,
  lensFocus: 40,
  blurCenterX: 50,
  blurCenterY: 50,
  progressivePosition: 55,
  progressiveReverse: false,

  pfx: {
    vignette: { enabled: true, intensity: 38 },
    scanLines: { enabled: true, intensity: 28 },
    chromatic: { enabled: false, intensity: 15 },
    bloom: { enabled: true, intensity: 25 },
    filmGrain: { enabled: true, intensity: 40 },
    glitch: { enabled: true, intensity: 20 },
    pixelate: { enabled: false, intensity: 15 },
    halftone: { enabled: false, intensity: 20 },
    filmDust: { enabled: false, intensity: 20 },
  },

  animated: true,
  animStyle: "flicker",
  animSpeed: { enabled: true, intensity: 100 },
  animIntensity: { enabled: true, intensity: 60 },

  lights: { enabled: false, points: [] },
  mask: {
    enabled: false,
    tool: "freehand",
    brushSize: 30,
    showOverlay: true,
    invert: false,
    dataUrl: null,
    shapes: [],
  },
};

/** Merge a partial over the preset, one level deep for pfx/lights/mask. */
export function withDefaults(partial: Partial<AsciiParams> = {}): AsciiParams {
  return {
    ...CODE_RAIN,
    ...partial,
    pfx: { ...CODE_RAIN.pfx, ...(partial.pfx ?? {}) },
    lights: { ...CODE_RAIN.lights, ...(partial.lights ?? {}) },
    mask: { ...CODE_RAIN.mask, ...(partial.mask ?? {}) },
  };
}
