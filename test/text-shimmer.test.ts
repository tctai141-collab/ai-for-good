import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The wait shown while Sprint Buddy is answering.
 *
 * It used to be an unlabelled pulsing dot. A founder waiting on an answer
 * should be told what is happening rather than shown a light.
 */

const shimmer = readFileSync("src/components/TextShimmer.tsx", "utf-8");
const chat = readFileSync("src/components/SprintBuddy.tsx", "utf-8");
const css = readFileSync("src/pages/index.astro", "utf-8");

describe("the wait", () => {
  test("it says what it is doing", () => {
    expect(chat).toContain(">Generating answers</TextShimmer>");
  });

  test("it is announced, and only while busy", () => {
    const block = chat.slice(chat.indexOf("{busy && ("), chat.indexOf("{banner && ("));
    expect(block).toContain('role="status"');
    expect(block).toContain('aria-live="polite"');
    expect(block).toContain("TextShimmer");
  });
});

describe("the message header", () => {
  test("assistant messages carry no posture label or timestamp", () => {
    /*
     * Every answer used to be topped with "THINKING · 05:51 PM", including the
     * one still being written. It named a posture the app no longer has (the
     * three thread states collapsed to one years of commits ago) and stamped a
     * time nobody asked for. Tai: take it off completely.
     *
     * The wait below the thread says what is happening while it happens; a
     * finished answer needs no label at all.
     */
    expect(chat).not.toContain("postureLabel");
    expect(chat).not.toMatch(/\{ctx\.clock \? ` · \$\{ctx\.clock\}` : ""\}/);
  });

  test("nothing is left dangling from it", () => {
    // `accent` existed only to colour that header's dot.
    expect(chat).not.toContain("const accent = isCheckin");
  });
});

describe("the shimmer", () => {
  test("it brought no dependencies with it", () => {
    /*
     * The supplied component wraps the element in framer-motion to animate one
     * property, backgroundPosition, and writes its gradient as a stack of
     * Tailwind arbitrary-value classes. There is no framer-motion and no
     * Tailwind here, and a moving background position is a keyframe.
     */
    const imports = [...shimmer.matchAll(/^\s*import[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]!);
    expect(imports).toEqual([]);
  });

  test("the highlight scales with the length of the string", () => {
    // A fixed-width highlight crossing a long line reads as a dot sliding
    // along it rather than as a sweep.
    expect(shimmer).toContain("[...children].length * spread");
  });

  test("both background layers are named in the keyframes", () => {
    /*
     * The background is two layers: a flat base and the moving highlight. A
     * keyframe that gives one position for a two-layer background drops the
     * second layer for the whole animation, so the base colour disappears and
     * the text is invisible between sweeps.
     */
    /* Sliced to the block's closing brace, not to a fixed character count: the
       first version used 260 characters, and the comment inside pushed the
       `to` line past the end of the window. */
    const start = css.indexOf("@keyframes shimmer");
    expect(start).toBeGreaterThan(-1);
    const frames = css.slice(start, css.indexOf("\n  }", start));
    expect(frames).toContain("background-position: 100% center, 0 0");
    expect(frames).toContain("background-position: 0% center, 0 0");
  });

  test("reduced motion paints the text instead of leaving it transparent", () => {
    /*
     * The trick is `color: transparent` with the gradient clipped to the
     * glyphs. Switching the animation off without also restoring a colour
     * would leave the words invisible rather than still.
     */
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)", css.indexOf(".shimmer {")));
    expect(reduced).toContain("animation: none");
    expect(reduced).toContain("color: var(--shimmer-base)");
  });
});
