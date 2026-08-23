import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The composer's idle prompt.
 *
 * Read out of the source rather than rendered, because the component is
 * `client:only` and mounting React here to assert on a placeholder string
 * would cost more than it proves. What is worth pinning is the shape of the
 * list and, above all, that nothing in it greets a bad day with a defeat.
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
    // Scoped to the JSX rather than the whole file: the comment above the list
    // quotes the fixed line this replaced, and matching that is not a failure.
    const line = src.split("\n").find((l) => l.includes("placeholder=")) ?? "";
    expect(line).toContain("placeholder={idlePrompt}");
    expect(line).not.toContain("What are you turning over?");
  });

  test("nothing in the list greets a bad day with a defeat", () => {
    /*
     * This used to be guarded the other way round: the list could hold
     * "It's over." because a panic-mode placeholder would override it. Panic
     * mode turned out to be unreachable, so the override never ran and a
     * founder who had just lost a pilot could open the app to "We're cooked."
     *
     * The register stays. These particular lines do not. "They cooked." and
     * "You cooked." are compliments here and are deliberately not on this list.
     */
    const defeatist = [
      "We're cooked.",
      "Are we cooked?",
      "Chat, are we cooked?",
      "It's over.",
      "We're finished.",
      "Pack it up.",
      "Massive L.",
      "Mid.",
      "Negative aura.",
      "I'm crying.",
      "I'm dead.",
      "I fear…",
    ];
    for (const line of defeatist) {
      expect([line, prompts.includes(line)]).toEqual([line, false]);
    }
  });

  test("a new line is drawn on mount and again every hour", () => {
    expect(src).toContain("PROMPT_ROTATE_MS = 60 * 60 * 1000");
    // Drawn in the initialiser, so a reload is a fresh draw rather than a
    // value baked in at module load and shared by every mount.
    expect(src).toContain("useState(drawPrompt)");
  });
});
