import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The flying login headline.
 *
 * The ring is a rigid 3D world that one rotation drives, so almost everything
 * about it is CSS geometry that a unit test cannot see. What is worth pinning
 * is the part that is easy to break by accident and silent when broken: the
 * page must keep a real heading, and the decoration must not become the
 * heading.
 */

const ring = readFileSync("src/components/WordRing.tsx", "utf-8");
const app = readFileSync("src/components/App.tsx", "utf-8");
const css = readFileSync("src/pages/index.astro", "utf-8");

describe("the heading survives the decoration", () => {
  test("the login page still has an h1 that says the product's name", () => {
    /*
     * The visible title was replaced by a ring of orbiting words. If that ring
     * were the only "Sprint Buddy" on the page, the login screen would have no
     * heading at all: the ring is aria-hidden, and its words are duplicated
     * and out of order as they come round.
     */
    expect(app).toContain('<h1 id="login-title" className="sr-only">Sprint Buddy</h1>');
    expect(app).toContain('aria-labelledby="login-title"');
  });

  test("the ring itself is hidden from assistive tech", () => {
    // Otherwise a screen reader announces "SPRINT BUDDY" as two separate
    // headings-worth of text, in whichever order the ring happens to be in.
    expect(ring).toContain('aria-hidden="true"');
  });
});

describe("the ring", () => {
  test("it brought no dependencies with it", () => {
    /*
     * The supplied component drew a procedural jellyfish, which is what three
     * and @react-three/fiber were for. This app already has a mascot at the
     * hub, so the ring is the only part worth taking, and the ring is CSS.
     *
     * Asserted on the import statements, not on the file text: the comment at
     * the top of the component names both packages to explain why they are
     * gone, and a check that cannot tell a prohibition from its violation is
     * not a check.
     */
    const imports = [...ring.matchAll(/^\s*import[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]!);
    expect(imports).toEqual([]);
    // And nothing pulled in through a bare side-effect import either.
    expect(ring).not.toMatch(/^\s*import\s+"/m);
  });

  test("each word is seated on the ring and turned to face inward", () => {
    // Facing inward is what puts the readable moment on the far side of the
    // ring, so the word passes behind the mascot and gets cropped by it
    // rather than sailing across in front of the reader.
    expect(ring).toContain("translateZ(var(--ring-r)) rotateY(180deg)");
  });

  test("the fade is phase-locked to the same loop as the rotation", () => {
    // A fade on its own clock drifts against the rotation, and within a minute
    // words are bright while facing away and dark while facing the reader.
    const orbit = css.match(/animation: ring-orbit (\d+)s/)![1];
    const fade = css.match(/animation: ring-fade (\d+)s/)![1];
    expect(fade).toBe(orbit);
    expect(ring).toContain("animationDelay");
  });

  test("it never takes a pointer event", () => {
    // The word box is far wider than the words: at the login screen's size it
    // spans the whole viewport, straight across the email field.
    expect(css).toMatch(/\.ring \{[^}]*pointer-events: none/s);
  });

  test("the login panel paints above it", () => {
    // Without this the giant type renders over the form.
    expect(css).toMatch(/\.login-panel \{[^}]*z-index: 10/s);
  });

  test("reduced motion holds one readable word rather than a blank frame", () => {
    /*
     * Freezing the orbit at rotateY(0) would leave the reader looking at the
     * back of the ring, where backface-visibility hides everything. Half a
     * turn puts the first seat facing the reader.
     */
    expect(css).toMatch(/prefers-reduced-motion[\s\S]{0,400}\.ring-stage \{ animation: none; transform: rotateY\(180deg\); \}/);
    expect(css).toMatch(/\.ring-word:first-child \{ opacity: 1; \}/);
  });
});
