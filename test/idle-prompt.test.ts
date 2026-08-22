import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The composer's idle prompt.
 *
 * Read out of the source rather than rendered, because the component is
 * `client:only` and mounting React here to assert on a placeholder string
 * would cost more than it proves. What is worth pinning is the shape of the
 * list and, above all, that the two distress states kept their own wording.
 */

const src = readFileSync("src/components/SprintBuddy.tsx", "utf-8");
const block = src.slice(src.indexOf("const IDLE_PROMPTS"), src.indexOf("] as const;"));
const prompts = [...block.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);

describe("the composer's idle prompt", () => {
  test("the list is long enough that a repeat is not obvious", () => {
    expect(prompts.length).toBeGreaterThan(50);
  });

  test("no duplicates", () => {
    // Tai's list had "Let them cook." twice.
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  test("every entry is short enough to sit in the input", () => {
    for (const prompt of prompts) expect(prompt.length).toBeLessThan(40);
  });

  test("the placeholder uses the rotating value, not a fixed line", () => {
    const placeholder = src.slice(src.indexOf("placeholder={mode === \"panic\""));
    expect(placeholder.slice(0, 200)).toContain(": idlePrompt}");
    expect(placeholder.slice(0, 200)).not.toContain("What are you turning over?");
  });

  test("panic and venting keep their own wording", () => {
    /*
     * The one that matters. A founder who has just told the app they are
     * panicking must not be met with "We're cooked." or "It's over." — both of
     * which are in the list, and both of which are fine in the neutral state.
     */
    const placeholder = src.slice(src.indexOf("placeholder={mode === \"panic\""), src.indexOf("placeholder={mode === \"panic\"") + 200);
    expect(placeholder).toContain("Say it plainly. One thing at a time.");
    expect(placeholder).toContain("Let it out, nobody's grading this.");
  });

  test("a new line is drawn on mount and again every hour", () => {
    expect(src).toContain("PROMPT_ROTATE_MS = 60 * 60 * 1000");
    // Drawn in the initialiser, so a reload is a fresh draw rather than a
    // value baked in at module load and shared by every mount.
    expect(src).toContain("useState(drawPrompt)");
  });
});
