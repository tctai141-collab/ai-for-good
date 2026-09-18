import { describe, expect, test } from "bun:test";
import { DECISION_SUMMARY_CHARS, decisionSummary, detectDecision } from "../src/lib/decisions";

/**
 * The decision journal has to be readable on its own.
 *
 * It stored the first nine words, which is a title, not a decision. Saga, 18
 * September 2026: the entire message is not visible, so she had to open the
 * conversation to find out what an entry was about.
 */

describe("the summary", () => {
  test("keeps the whole decision when it is one sentence", () => {
    const said = "Should I move the launch to October or ship the half-finished onboarding next week?";
    expect(decisionSummary(said)).toBe(said.charAt(0).toUpperCase() + said.slice(1));
  });

  test("is no longer cut off after nine words", () => {
    const said = "I am torn about whether to hire a second engineer now or wait for the next funding round.";
    const summary = decisionSummary(said);
    expect(summary.split(" ").length).toBeGreaterThan(9);
    expect(summary).toContain("funding round");
  });

  test("takes the first sentence, not the whole message", () => {
    const said = "Should I fire the contractor? He has missed three deadlines and the last build broke staging twice.";
    expect(decisionSummary(said)).toBe("Should I fire the contractor?");
  });

  test("skips an opener too short to be the decision", () => {
    const said = "Hi. I cannot decide whether to keep the office or go remote for the rest of the sprint.";
    expect(decisionSummary(said)).toContain("go remote");
  });

  test("cuts long messages at a word, never mid-word", () => {
    const said = ("Should I " + "keep going ".repeat(80)).trim();
    const summary = decisionSummary(said);

    expect(summary.length).toBeLessThanOrEqual(DECISION_SUMMARY_CHARS + 1);
    expect(summary.endsWith("…")).toBe(true);

    /* What is kept is a prefix of what they wrote, and the character after it
       is a space — so the cut landed between words rather than inside one. */
    const kept = summary.slice(0, -1);
    expect(said.startsWith(kept)).toBe(true);
    expect(said[kept.length]).toBe(" ");
  });

  test("nothing in, nothing out", () => {
    expect(decisionSummary("")).toBe("");
    expect(decisionSummary("   ")).toBe("");
  });
});

describe("spotting one", () => {
  test("a decision is caught, and carries the fuller summary", () => {
    const found = detectDecision("Should I sign the lease this week or keep looking?", "runway");
    expect(found.present).toBe(true);
    if (!found.present) throw new Error("unreachable");
    expect(found.door).toBe("one-way");
    expect(found.summary).toContain("keep looking");
    expect(found.theme).toBe("runway");
  });

  test("ordinary talk is not a decision", () => {
    expect(detectDecision("The workshop went well today.", "team").present).toBe(false);
  });
});
