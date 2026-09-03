import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { get, startServer, type Harness } from "./helpers/harness";

/**
 * Add to Home Screen.
 *
 * The whole feature is four static files and six tags, and every way it breaks
 * is silent. A browser that cannot read the manifest does not report anything;
 * it just declines to offer the install, or installs a blank square, and the
 * first anyone hears is a founder saying the icon looks wrong.
 *
 * So this suite fetches the real files off the built server rather than
 * reading them off disk. That distinction matters more here than elsewhere:
 * static files never reach Astro's middleware — the Node adapter's handler
 * serves dist/client and only falls through to app.render() when there is no
 * file — so a manifest that exists in public/ and a manifest that is actually
 * served are two different claims.
 *
 * Content types are asserted, which nothing else in this repo does. A manifest
 * served as text/plain is ignored by every browser, and it looks perfectly
 * fine in curl.
 */

let h: Harness;
let manifest: Record<string, unknown>;

const index = readFileSync("src/pages/index.astro", "utf-8");
/* Comments removed, for the assertions that forbid a string: the head carries
   a note naming the very tag one of them rules out, and a check that cannot
   tell a prohibition from its violation is not a check. */
const markup = index.replace(/<!--[\s\S]*?-->/g, "");

/** Width and height out of a PNG's IHDR, which is always the first chunk. */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

beforeAll(async () => {
  h = await startServer();
  manifest = await (await get(h, "/manifest.webmanifest")).json();
});

afterAll(() => h?.stop());

describe("the manifest", () => {
  test("is served, as a manifest", async () => {
    // application/manifest+json, not application/json and not text/plain:
    // the wrong type here is the difference between installable and not.
    const res = await get(h, "/manifest.webmanifest");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/manifest+json");
  });

  test("is readable without signing in", async () => {
    /*
     * The browser fetches it before anyone has an account, and on iOS it is
     * fetched from a context that carries no cookie at all. It is reachable
     * today only because static files bypass the middleware; this is here so
     * that a future change putting them behind a session fails loudly.
     */
    const res = await get(h, "/manifest.webmanifest");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Sprint Buddy");
  });

  test("names the app, and where it opens", () => {
    expect(manifest.name).toBe("Sprint Buddy");
    expect(manifest.short_name).toBe("Sprint Buddy");
    expect(manifest.start_url).toBe("/");
    /* Not for the reason it looks like. /setup and /report arrive by email, so
       they open in the default browser whatever the scope says. It matters
       because App.tsx renders a plain <a href="/admin"> for organizers: any
       scope narrower than "/" throws them out of the installed window into
       Safari, which has its own cookie jar and therefore no session. */
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    // Pins identity independently of start_url: change the start URL later
    // and this updates the installed app rather than adding a second one.
    expect(manifest.id).toBe("/");
  });

  test("its colours are the app's own, not a second set", () => {
    /*
     * background_color is the ground Android paints while the app boots. If it
     * drifts from the canvas the app actually renders, every cold start opens
     * with a flash of the wrong colour.
     */
    expect(manifest.background_color).toBe("#08090a");
    expect(manifest.theme_color).toBe("#08090a");
    expect(index).toContain("--surface-bg: #08090a");
  });

  test("orientation is not locked", () => {
    // Nothing here needs portrait, and locking it fights anyone on a tablet.
    expect(manifest.orientation).toBeUndefined();
  });
});

describe("the icons", () => {
  test("every icon the manifest names is really there", async () => {
    /*
     * A manifest pointing at a missing icon installs a blank square, and the
     * manifest itself still validates. Fetched rather than stat'd, because
     * "in public/" and "served" are different claims.
     */
    const icons = manifest.icons as { src: string; sizes: string; type: string }[];
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      const res = await get(h, icon.src);
      expect(`${icon.src} ${res.status}`).toBe(`${icon.src} 200`);
      expect(res.headers.get("content-type")).toContain("image/png");
    }
  });

  test("each one is the size it claims to be", async () => {
    // sizes is a promise to the browser, and nothing checks it at build time.
    const icons = manifest.icons as { src: string; sizes: string }[];
    for (const icon of icons) {
      const bytes = new Uint8Array(await (await get(h, icon.src)).arrayBuffer());
      const { width, height } = pngSize(bytes);
      expect(`${icon.src} ${width}x${height}`).toBe(`${icon.src} ${icon.sizes}`);
    }
  });

  test("one of them is maskable, and it is not the same file as the plain one", () => {
    /*
     * Android crops to a shape the launcher picks. A maskable icon has to keep
     * everything inside a centred circle of 80% of the width, which is a
     * different drawing from an uncropped one — declaring a single file as
     * both leaves it either too small everywhere or clipped on Android.
     */
    const icons = manifest.icons as { src: string; purpose: string }[];
    const maskable = icons.filter((i) => i.purpose === "maskable");
    const any = icons.filter((i) => i.purpose === "any");
    expect(maskable.length).toBe(1);
    expect(any.length).toBeGreaterThan(0);
    expect(any.map((i) => i.src)).not.toContain(maskable[0]!.src);
  });

  test("the icon iOS actually uses is served", async () => {
    /*
     * iOS reads neither the manifest's icons nor an SVG for a home-screen app.
     * apple-touch-icon.png is the only art that reaches an iPhone, and it is
     * referenced from the page rather than the manifest, so nothing above
     * would catch its absence.
     */
    const res = await get(h, "/icons/apple-touch-icon.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    const { width, height } = pngSize(new Uint8Array(await res.arrayBuffer()));
    expect([width, height]).toEqual([180, 180]);
  });
});

describe("the page that declares it", () => {
  test("start_url opens for somebody with no session", async () => {
    // Where the installed app lands every time it is opened.
    expect((await get(h, "/")).status).toBe(200);
  });

  test("the app shell links the manifest and the Apple icon", () => {
    expect(index).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(index).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
    expect(index).toContain('<meta name="theme-color" content="#08090a" />');
  });

  test("the utility pages are left out of it", () => {
    /*
     * There is no shared layout in this project, so tags in four heads are
     * four copies that drift. /admin, /setup and /report are noindex pages
     * nobody installs; the app shell is the only one that earns them.
     */
    for (const page of ["src/pages/admin.astro", "src/pages/setup.astro", "src/pages/report.astro"]) {
      const bare = readFileSync(page, "utf-8").replace(/<!--[\s\S]*?-->/g, "");
      expect(`${page}: ${bare.includes("manifest")}`).toBe(`${page}: false`);
    }
  });

  test("the status bar is opaque black, and not translucent", () => {
    /*
     * Two assertions because the two failures are different. Dropping the tag
     * does not give a neutral result — it gives iOS's `default`, a light strip
     * above a near-black app, which reads as a rendering fault.
     *
     * black-translucent is the one to resist. It runs the canvas under the
     * clock and needs the top safe-area inset honoured, which nothing here
     * does: the only rule that pads for it is .app-root, on a class no
     * component renders. Change that first, on a real phone, then this test.
     */
    expect(markup).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black" />');
    expect(markup).not.toContain("black-translucent");
  });
});

describe("telling people it exists", () => {
  const onb = readFileSync("src/components/Onboarding.tsx", "utf-8");
  const code = onb.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("the walkthrough carries the instruction", () => {
    // Safari has no install prompt. Unsaid, this feature is undiscoverable.
    expect(onb).toContain("Add to Home Screen");
  });

  test("it sends them to a browser that can actually install", () => {
    /*
     * Founders arrive through an emailed setup link, which on a phone opens
     * inside the mail client's own webview — coarse pointer, no Add to Home
     * Screen anywhere in its share sheet. Sniffing for those webviews is a
     * losing game; saying it in the first sentence is not.
     */
    expect(onb).toContain("Safari or Chrome");
  });

  test("it warns about the second sign-in", () => {
    /*
     * An installed iOS web app does not share Safari's cookies, so the first
     * tap on the new icon shows a login screen. Said here it is a sentence;
     * unsaid it is twenty founders thinking the app is broken on day one.
     */
    expect(onb).toContain("sign in once more");
  });

  test("no step can clip the only way out of the dialog", () => {
    /*
     * The install step is the last one, and the last step renders no Skip. A
     * native <dialog> ignores a backdrop click and a phone has no Escape key,
     * so if .onb clips its footer at max-height the founder is shut inside a
     * modal with the page inert behind it. A phone in landscape is about 390px
     * tall and gets there. It scrolls now; this is here so it keeps scrolling.
     */
    /* Comments stripped first: the rule carries a note explaining why it is no
       longer `overflow: hidden`, and a check that cannot tell a prohibition
       from its violation is not a check. */
    const css = readFileSync("src/pages/index.astro", "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
    const onbRule = css.slice(css.indexOf("\n  .onb {"), css.indexOf(".onb::backdrop"));
    expect(onbRule).toContain("max-height");
    expect(onbRule).toContain("overflow-y: auto");
    expect(onbRule).not.toMatch(/overflow:\s*hidden/);
  });

  test("the install step is not wildly longer than the ones around it", () => {
    /*
     * It was 372 characters against a previous longest of 199, which is what
     * made the clipping certain rather than possible. Scrolling fixed the
     * trap; this keeps the copy in family with the rest of the walkthrough.
     */
    const bodies = [...onb.matchAll(/body:\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!.length);
    expect(bodies.length).toBeGreaterThan(5);
    expect(Math.max(...bodies)).toBeLessThan(300);
  });

  test("it is added to the existing steps, not swapped in for one", () => {
    // Both roles keep everything they had; the install step is appended.
    expect(code).toContain('role === "founder" ? FOUNDER : ORGANIZER');
    expect(code).toContain("[...base, INSTALL]");
  });

  test("it is skipped where it cannot be acted on", () => {
    /*
     * A desktop browser has no share sheet, and an app already installed is
     * being told to install itself. Both read as the product not knowing
     * where it is.
     */
    expect(code).toContain('(pointer: coarse)');
    expect(code).toContain('(display-mode: standalone)');
    expect(code).toContain("standalone?: boolean");
  });

  test("the check runs on the device, not at module load", () => {
    // At module scope there is no window to ask, and the answer would be
    // baked into the bundle for every device that loads it.
    expect(code).toContain("useState(installable)");
  });
});
