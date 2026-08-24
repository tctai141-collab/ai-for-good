import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The wordmark in the app's sidebar.
 *
 * It was "Sprint" over "Buddy" set in a solid red block. Tai called it ugly,
 * and it also put the loudest colour in the product on a label nobody clicks.
 */

const chat = readFileSync("src/components/SprintBuddy.tsx", "utf-8");
const css = readFileSync("src/pages/index.astro", "utf-8");
/*
 * Comment-stripped views. Both files explain, in prose, exactly why the
 * supplied component is not used, and that prose names the host and the
 * package the checks below forbid. A check that cannot tell a prohibition
 * from its violation is not a check; this is the fourth time in this codebase
 * that has caught someone out.
 */
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, "");
const chatCode = chat.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the mark", () => {
  test("the red block is gone", () => {
    expect(chat).not.toMatch(/background: C\.accent, padding: "2px 12px 5px"/);
    expect(chat).toContain('<span className="wordmark-liquid" aria-label="Sprint Buddy">');
  });

  test("both words are one element, so the fill crosses the whole mark", () => {
    /*
     * Two elements would clip a background to each line separately and the
     * highlight would restart halfway down, which is the same problem the
     * login headline had across its twelve letter spans.
     */
    const mark = chat.slice(chat.indexOf('className="wordmark-liquid"'), chat.indexOf("</span>", chat.indexOf('className="wordmark-liquid"')));
    expect(mark).toContain("Sprint<br />Buddy");
  });

  test("it is still readable as text", () => {
    // background-clip: text needs a transparent colour, which leaves nothing
    // for a screen reader to fall back on if the label goes.
    expect(chat).toContain('aria-label="Sprint Buddy"');
    expect(css).toMatch(/\.wordmark-liquid \{[^}]*color: transparent/s);
    expect(css).toMatch(/\.wordmark-liquid \{[^}]*background-clip: text/s);
  });
});

describe("why it is not the supplied component", () => {
  test("no shader dependency, and nothing loaded off the network", () => {
    /*
     * Both reasons were measured rather than assumed, on the first time this
     * component was proposed:
     *
     *   It masks a WebGL shader with an SVG <text> in a data URI, and a
     *   data-URI SVG cannot see a webfont. Asked for the real face it renders
     *   a generic serif 4.1% narrower with different letterforms, so the
     *   wordmark would quietly stop being set in the Sprint's type.
     *
     *   It loads an image from shaders.paper.design, which this app's CSP
     *   blocks outright.
     */
    const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("@paper-design/shaders-react");
    expect(cssCode.length).toBeGreaterThan(1000);
    expect(cssCode).not.toContain("shaders.paper.design");
    expect(chatCode).not.toContain("@paper-design");
  });
});

describe("the drift", () => {
  test("the properties are registered, and the keyframes are lengths", () => {
    /*
     * An unregistered custom property is a string to the animation engine and
     * snaps between keyframes instead of interpolating. And a percentage is an
     * invalid value for a <length> property, so those keyframes are dropped
     * silently and nothing moves — which shipped once already, on the login
     * headline.
     */
    for (const name of ["--mark-a", "--mark-b"]) {
      expect(css).toContain(`@property ${name} { syntax: "<length>"`);
    }
    const frames = css.slice(css.indexOf("@keyframes mark-a"), css.indexOf("@media (prefers-reduced-motion: reduce)", css.indexOf("@keyframes mark-a")));
    expect(frames).toMatch(/--mark-a: -?[\d.]+em/);
    expect(frames).not.toMatch(/--mark-[ab]:\s*-?[\d.]+%/);
  });

  test("the two blobs drift at different rates", () => {
    // Matched rates make the mark pulse in time rather than flow.
    const block = css.slice(css.indexOf("  .wordmark-liquid {"), css.indexOf("@keyframes mark-a"));
    const durations = [...block.matchAll(/mark-[ab] (\d+)s/g)].map((m) => Number(m[1]));
    expect(durations).toHaveLength(2);
    expect(durations[0]).not.toBe(durations[1]);
  });

  test("reduced motion holds a frame with both blobs on the mark", () => {
    /*
     * animation: none on its own leaves the properties at their 0px initial
     * value, which parks one blob off the end of the word.
     */
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)", css.indexOf(".wordmark-liquid {")));
    expect(reduced).toContain("--mark-a: 0.8em");
    expect(reduced).toContain("--mark-b: 2.6em");
  });
});
