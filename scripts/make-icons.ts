/**
 * Draws the home-screen icons, once, by hand.
 *
 *   bun scripts/make-icons.ts
 *
 * Not wired into `bun run build` and not run by CI, deliberately. The four
 * PNGs it writes are committed, so the icons keep working whatever happens to
 * this script; sharp is only a *transitive* dependency here (Astro pulls it in,
 * package.json pins it under `overrides` and nowhere else), and a build step
 * that depends on a package nobody declared is a build that breaks on an
 * install nobody changed. Run it when the art changes, commit the output.
 *
 * Why PNG at all, when public/favicon.svg is a perfectly good vector: iOS does
 * not read the manifest's icons for a home-screen app and does not accept SVG
 * for apple-touch-icon. A raster set is the only thing that reaches an iPhone.
 */
import { mkdir } from "node:fs/promises";

/*
 * sharp is not imported at the top on purpose. It reaches this repo only as an
 * *optional* dependency of astro — `overrides` pins the version, nothing
 * declares it — and optional means an install is allowed to skip it without
 * failing. Its native binary is per-platform too, so a machine that is not the
 * one these icons were drawn on may not have it.
 *
 * That is survivable precisely because the output is committed: nothing at
 * runtime, in CI, in the Docker image or in the tests touches sharp. Only
 * regenerating breaks, and it should break with a sentence rather than a
 * module-not-found stack.
 */
let sharp: typeof import("sharp").default;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error(
    "sharp is not installed, so the icons cannot be redrawn.\n\n" +
      "It is not a declared dependency here: the app never uses it at runtime and\n" +
      "the PNGs this writes are committed, so adding it would put a ~30 MB native\n" +
      "download into every CI run and Docker build for a file that changes twice a\n" +
      "year. Borrow it for the length of one command instead:\n\n" +
      "  bun add -d sharp@0.35.3 && bun scripts/make-icons.ts && bun remove sharp\n",
  );
  process.exit(1);
}

const OUT = "public/icons";

/* The same three faces as public/favicon.svg, on the same 32-unit grid, so the
   tab icon and the home-screen icon cannot drift apart without both being
   edited. Natural extent: x 4→28 (24 wide), y 4→27 (23 tall). */
const FACES = [
  { d: "M16 4l12 5.5-12 5.5L4 9.5z", fill: "#8f97e4" },
  { d: "M4 9.5l12 5.5v12L4 21.5z", fill: "#4a55b8" },
  { d: "M16 15l12-5.5v12L16 27z", fill: "#5e6ad2" },
];

const CUBE_W = 24;
const CUBE_H = 23;
/* Centre of the cube's bounding box in grid units, which is not the centre of
   the 32-grid: the cube sits 4 from the top and 5 from the bottom. */
const CUBE_CX = 16;
const CUBE_CY = 15.5;

/** The app's own canvas. A transparent icon is composited onto black by iOS
    and cropped to the launcher's mask by Android; neither is what we drew. */
const GROUND = "#08090a";

/**
 * @param size    output edge, in pixels
 * @param cubeFrac how much of that edge the cube's width should occupy
 */
function icon(size: number, cubeFrac: number): string {
  const scale = (size * cubeFrac) / CUBE_W;
  const tx = size / 2 - CUBE_CX * scale;
  const ty = size / 2 - CUBE_CY * scale;
  const paths = FACES.map((f) => `<path d="${f.d}" fill="${f.fill}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
    + `<rect width="${size}" height="${size}" fill="${GROUND}"/>`
    + `<g transform="translate(${tx} ${ty}) scale(${scale})">${paths}</g>`
    + `</svg>`;
}

/*
 * Two framings, because a maskable icon is not a plain icon with a bigger
 * margin — it is a different guarantee. Android crops to a shape it chooses,
 * and only a centred circle of 80% of the width survives every shape. The
 * cube's bounding box has to fit inside that circle, so its width is capped at
 *
 *   0.8 * size * CUBE_W / hypot(CUBE_W, CUBE_H) ≈ 0.578 * size
 *
 * and 0.55 leaves a little room on top of that. The "any" icons are not
 * cropped, so they can be drawn larger; at 0.625 the cube still clears the
 * rounded corners iOS applies to apple-touch-icon.
 */
const ANY = 0.625;
const MASKABLE = 0.55;

const TARGETS = [
  { file: "apple-touch-icon.png", size: 180, frac: ANY },
  { file: "icon-192.png", size: 192, frac: ANY },
  { file: "icon-512.png", size: 512, frac: ANY },
  { file: "icon-maskable-512.png", size: 512, frac: MASKABLE },
];

await mkdir(OUT, { recursive: true });

for (const { file, size, frac } of TARGETS) {
  const svg = icon(size, frac);
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(`${OUT}/${file}`);
  console.log(`${OUT}/${file}  ${size}×${size}  cube ${Math.round(size * frac)}px`);
}
