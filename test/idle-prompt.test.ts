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

  test("the rotating value is what the founder sees, and never what it is called", () => {
    /*
     * The native placeholder attribute is gone: it cannot be animated, so the
     * line is drawn as an overlay that blurs in a letter at a time. Two things
     * have to stay true because of that. The overlay must be fed the rotating
     * value, and the textarea must carry a fixed name of its own.
     *
     * The first attempt passed `idlePrompt` to aria-label, on the reasoning
     * that the input would otherwise be unlabelled. It made things worse: the
     * field was renamed every few seconds, and renamed to lines like "Bffr.".
     * The overlay is aria-hidden decoration; the label says what the control
     * is.
     */
    expect(src).toContain("<AnimatedPlaceholder text={idlePrompt}");
    expect(src).toContain('aria-label="Message Sprint Buddy"');
    expect(src).not.toContain("aria-label={idlePrompt}");
  });

  test("the overlay yields the moment there is anything to yield to", () => {
    // Two of them on screen at once would be the obvious way for this to go
    // wrong: a ghost line sitting underneath what somebody is typing.
    expect(src).toContain("paused={composerFocused || input.length > 0}");
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

  test("a new line is drawn on mount, and again on one timer, not two", () => {
    expect(src).toContain("PROMPT_CYCLE_MS = 4200");
    // The hourly rotate this replaced could only ever change a line that was
    // hidden at the time, so it was one interval running for nothing.
    expect(src).not.toContain("PROMPT_ROTATE_MS");
    // Drawn in the initialiser, so a reload is a fresh draw rather than a
    // value baked in at module load and shared by every mount.
    expect(src).toContain("useState(drawPrompt)");
  });
});
