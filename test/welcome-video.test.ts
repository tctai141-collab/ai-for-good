import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { get, startServer, type Harness } from "./helpers/harness";

/**
 * The film behind the welcome screen.
 *
 * Every way this breaks is silent. A video that is blocked by the policy, or
 * refused autoplay because a property did not make it onto the element, does
 * not throw and does not log — it simply never starts, and the founder sees a
 * poster or the rain and assumes that is the design. So the properties that
 * make it play at all are asserted here rather than trusted.
 *
 * The comment-stripped `code` is used for anything this file forbids: the
 * component's own docblock explains why the film is not loaded from a CDN, and
 * a check that cannot tell a prohibition from its violation is not a check.
 */

let h: Harness;

const splash = readFileSync("src/components/WelcomeSplash.tsx", "utf-8");
const code = splash.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const css = readFileSync("src/pages/index.astro", "utf-8");
const middleware = readFileSync("src/middleware.ts", "utf-8");

beforeAll(async () => {
  h = await startServer();
});

afterAll(() => h?.stop());

describe("the assets are ours", () => {
  test("the film and its poster are served from this origin", async () => {
    /*
     * Fetched off the built server rather than stat'd on disk: "in public/" and
     * "served" are different claims, and only the second one matters to a
     * browser.
     */
    const film = await get(h, "/video/iss-hero-720p.mp4");
    expect(film.status).toBe(200);
    expect(film.headers.get("content-type")).toContain("video/mp4");

    const poster = await get(h, "/video/iss-hero-poster.jpg");
    expect(poster.status).toBe(200);
    expect(poster.headers.get("content-type")).toContain("image/jpeg");
  });

  test("they load without a session", async () => {
    // The splash renders before the app has finished deciding who anybody is.
    // Neither request above carried a cookie; this states that on purpose.
    expect((await get(h, "/video/iss-hero-720p.mp4")).status).toBe(200);
  });

  test("nothing is fetched from a CDN", () => {
    /*
     * The supplied component points at jsDelivr. The policy would refuse it —
     * media-src is unset, so it falls back to default-src 'self' — and it would
     * hand every founder's IP to a third party on sign-in, which is the exact
     * thing the self-hosted fonts exist to prevent.
     */
    expect(code).not.toContain("jsdelivr");
    expect(code).not.toContain("http://");
    expect(code).not.toContain("https://");
    expect(code).toContain('"/video/iss-hero-720p.mp4"');
  });

  test("the policy was not widened to make it work", () => {
    /*
     * The other way to have shipped this, and the wrong one. If a later change
     * moves the film back to a CDN, this is what should stop it.
     */
    const csp = middleware.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).not.toContain("media-src");
    expect(csp).not.toContain("cdn.jsdelivr.net");
  });

  test("the film is the smaller cut", () => {
    // 720p is 1.19 MB against 3.73 MB for the 1080p. This plays for six
    // seconds behind a line of text on a phone; the extra 2.5 MB buys nothing
    // anybody can see and costs a first sign-in over mobile data.
    expect(code).toContain("720p");
    expect(code).not.toContain("1080p");
  });
});

describe("it can actually play", () => {
  test("muted is set on the property, not only the attribute", () => {
    /*
     * The one that would have shipped broken. React does not reliably reflect
     * the muted attribute onto the DOM property, and every mobile browser
     * refuses autoplay for a video it believes has sound. The failure is
     * silent: no error, no log, just a poster where the film should be.
     */
    expect(code).toContain("video.muted = true");
    expect(splash).toContain("muted");
  });

  test("playsInline, or iOS takes the whole screen", () => {
    // Without it Safari opens the film in its own fullscreen player, over the
    // app, mid-sign-in.
    expect(splash).toContain("playsInline");
  });

  test("a refused play() is caught rather than thrown", () => {
    // Low-power mode and data-saver settings refuse it outright. That is a
    // poster and some rain, not an unhandled rejection.
    expect(code).toContain("video.play().catch(");
  });

  test("it fades in only once it can paint", () => {
    /*
     * Cutting the poster in at full opacity flashes a still frame over the
     * rain. The opacity is driven by canplay, and readyState is checked too —
     * on a second sign-in the film is already buffered and canplay has been
     * and gone before the listener exists.
     */
    expect(code).toContain('addEventListener("canplay"');
    expect(code).toContain("video.readyState >= 3");
    expect(code).toContain("opacity: filmReady ? 1 : 0");
  });
});

describe("the rain underneath is a real fallback", () => {
  test("it still runs", () => {
    /*
     * Not decoration on decoration. The film is 1.2 MB and will not have
     * arrived on a first sign-in over mobile data; the canvas paints in a frame
     * with no network. If this is ever removed as redundant, a slow connection
     * gets a black rectangle for six seconds.
     */
    expect(code).toContain("runAsciiRain(canvas, paintSource");
    expect(splash).toContain('className="splash-canvas"');
  });

  test("the ground behind everything is still painted", () => {
    // The last backstop: if the canvas, the poster and the film all fail, this
    // is what is on screen.
    expect(css).toMatch(/\.splash \{[^}]*background: #05070a/s);
  });
});

describe("nobody is held there", () => {
  test("there is a skip, and it is visible", () => {
    /*
     * The supplied component's skip is opacity-0 until focused, which for a
     * pointer user is no skip at all. Six seconds on every interactive sign-in,
     * for seven weeks, is precisely the thing somebody needs to leave.
     */
    expect(splash).toContain('className="splash-skip"');
    const rule = css.slice(css.indexOf("\n  .splash-skip {"), css.indexOf(".splash-skip:hover"));
    expect(rule).not.toMatch(/opacity:\s*0/);
  });

  test("Escape ends it too", () => {
    expect(code).toContain('event.key === "Escape"');
  });

  test("skipping cannot land anyone on a half-built screen", () => {
    /*
     * onDone only lifts this component's hold. App still waits on the user
     * data — `splashing && held && user` — so the six seconds stay a floor and
     * not a cut, which is the property the existing suite pins.
     */
    const app = readFileSync("src/components/App.tsx", "utf-8");
    expect(app).toContain("if (splashing && held && user) setSplashing(false)");
  });
});

describe("reduced motion", () => {
  test("gets a held frame, not a slower film", () => {
    expect(code).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
    // play() is not called at all, so it is the poster rather than a video
    // paused on its first frame.
    expect(code).toContain("if (!reduced) void video.play()");
  });

  test("and the CSS stops the push and fills the bar at once", () => {
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {\n    .splash {"));
    expect(block).toContain(".splash-video { animation: none");
    expect(block).toContain(".splash-progress-fill { animation: none; transform: scaleX(1); }");
  });
});

describe("how long it lasts", () => {
  test("the hold and the animations are the same number", () => {
    /*
     * The progress bar and the slow push both take their duration inline from
     * SPLASH_MS. Hard-coding either in the stylesheet would let the bar finish
     * early — or worse, late, so it is still filling when the app appears.
     */
    expect(code).toContain("animationDuration: still ? \"0s\" : `${SPLASH_MS}ms`");
    expect(css).toContain("animation-name: splash-fill");
    expect(css).toContain("animation-name: splash-push");
  });

  test("seven seconds, chosen by watching it", () => {
    /*
     * Six was the guess; seven is what it came to after sitting through it on
     * a real screen. Pinned as a range rather than a value because the exact
     * number is a judgement someone may revisit — but not silently, and not
     * upward without meeting the cost: this plays on every interactive
     * sign-in, and the film itself is only ten seconds long.
     */
    const match = code.match(/SPLASH_MS = (\d+)/);
    expect(match).not.toBeNull();
    const ms = Number(match![1]);
    expect(ms).toBeGreaterThanOrEqual(5000);
    expect(ms).toBeLessThanOrEqual(7000);
  });
});
