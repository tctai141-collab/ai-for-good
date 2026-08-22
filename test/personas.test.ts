import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import * as personas from "../src/lib/personas";
import { SPRINT_BUDDY_SYSTEM, STYLE_GUARDRAILS } from "../src/lib/personas";

/**
 * Guards on the system prompt.
 *
 * String assertions, which is unusual for a test suite, but every one of these
 * covers a failure that already happened. The prompt has at various points
 * handed a real person four aphorisms he never coined, told the model never to
 * admit being an AI, and given a fictional coach a biography — "multiple
 * companies, a near-death runway crisis, a cofounder breakup, one real exit" —
 * which is an instruction to invent the details on demand. None of that is
 * catchable by a typecheck, and all of it is a claim made to founders.
 *
 * What is NOT tested here is whether the voice is any good. That is the eval
 * set in `eval/`, and no assertion can stand in for it.
 */

const SHIPPED = [SPRINT_BUDDY_SYSTEM, STYLE_GUARDRAILS].join("\n\n");
const lower = SHIPPED.toLowerCase();

describe("Sprint Buddy — what it claims to be", () => {
  test("says plainly that it is software", () => {
    expect(lower).toContain("you are software");
  });

  test("claims no experience it does not have", () => {
    expect(lower).toContain("you have not founded a company");
    // The exact phrases from the retired composite founder voice. This is the
    // specific regression: a coach with a fabricated life story.
    expect(lower).not.toContain("you are a seasoned founder");
    expect(lower).not.toContain("near-death runway crisis");
    expect(lower).not.toContain("cofounder breakup, one real exit");
    expect(lower).not.toContain("calm, scarred, generous founder");
  });

  test("is not a named real person", () => {
    for (const value of Object.values(personas)) {
      if (typeof value !== "string") continue;
      expect(value).not.toContain("Mickos");
      expect(value).not.toContain("Paul Graham");
    }
  });

  test("does not carry the old instruction to hide being an AI", () => {
    // The original prompt ended "Never introduce yourself as an AI or
    // assistant." Applied to software, that is an instruction to lie.
    expect(lower).not.toContain("never introduce yourself as an ai");
    expect(lower).not.toContain("not a chatbot");
  });
});

describe("Sprint Buddy — attribution and fabrication", () => {
  test("is told to say whose idea it is quoting", () => {
    expect(lower).toContain("say whose it is");
  });

  test("is told what to do when the mentors have not covered something", () => {
    expect(lower).toContain("have not covered something");
  });

  test("forbids inventing a mentor, a quote or a specific", () => {
    expect(lower).toContain("never invent a mentor");
    // The classes of detail a coach reaches for under pressure.
    for (const kind of ["quote", "number", "date", "place", "company"]) {
      expect(lower).toContain(kind);
    }
  });
});

describe("persona policy", () => {
  test("every retired persona is gone, not renamed", () => {
    // Three have been removed in turn: a contrarian archetype that shipped as
    // "You are Paul Graham", the Mårten persona, and the composite founder
    // voice. This guards the door each of them left by.
    for (const name of [
      "CONTRARIAN_SYSTEM",
      "FOUNDER_VOICE_SYSTEM",
      "MARTEN_CORE_TOP",
      "MARTEN_CORE_BOTTOM",
      "MARTEN_DEFAULT_KNOWLEDGE",
    ]) {
      expect(Object.keys(personas)).not.toContain(name);
    }
  });

  test("there is exactly one voice to choose from", () => {
    const prompts = Object.entries(personas).filter(
      ([name, value]) => typeof value === "string" && name.endsWith("_SYSTEM"),
    );
    expect(prompts.map(([name]) => name)).toEqual(["SPRINT_BUDDY_SYSTEM"]);
  });

  test("posture prompts survive, because they describe the founder not the coach", () => {
    expect(Object.keys(personas.POSTURE_PROMPTS).sort()).toEqual(["panic", "thinking", "venting"]);
  });

  test("no mock advisor corpus is shipped in the public repo", () => {
    // Nine files named after real corpora, each containing one line of
    // placeholder text, plus a README telling the next person to fill them
    // with copyrighted material. Deleted; this stops them coming back.
    const files = readdirSync("docs/advisors");
    expect(files).toEqual(["README.md"]);
  });
});
