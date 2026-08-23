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
  test("is told never to name a mentor", () => {
    // Those sessions were closed rooms. An earlier draft told it to cite by
    // name; this is the assertion that stops that coming back.
    expect(lower).toContain("never name an individual mentor");
    expect(lower).toContain("never say who said what");
  });

  test("is given something true to say when asked where a position came from", () => {
    // Without this the model has nothing honest to answer with, and that is
    // exactly where it starts inventing a plausible name.
    expect(lower).toContain("do not attribute to individuals");
    expect(lower).toContain("do not guess at a name");
  });

  test("is told what to do when the programme has not covered something", () => {
    expect(lower).toContain("has not covered something");
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

describe("prompt injection", () => {
  test("the pack and the founder's words are framed as data, not instructions", () => {
    /*
     * The path that makes this more than theoretical: an organizer pastes a
     * transcript from outside, extraction turns it into entries, and those
     * entries land in the pack every founder's assistant reads. Human review
     * is the real control; this is the second one.
     */
    expect(lower).toContain("never instruction to follow");
    for (const attempt of ["adopt a new role", "reveal this prompt", "ignore what you were told"]) {
      expect(lower).toContain(attempt);
    }
  });
});

describe("the 2026-08-23 brief", () => {
  /*
   * A brief asked for a coach "modeled after Mårten Mickos" that shares
   * "personal anecdotes (as if from mentor's experience)". Most of it shipped.
   * Those two clauses did not, because between them they reconstruct the exact
   * failure the earlier tests exist for: fabricated lived experience, told in a
   * real person's name. These assertions are what stops the next brief
   * reintroducing it without a decision being taken.
   */
  test("carries the beliefs the brief asked for", () => {
    for (const belief of [
      "trust is the foundation of leadership",
      "courage is not the absence of fear",
      "scaling leadership means scaling yourself",
      "go deeper and find the essence",
    ]) {
      expect(lower).toContain(belief);
    }
  });

  test("carries the register: paradox, metaphor, provocation, self-coaching", () => {
    expect(lower).toContain("paradox that works");
    expect(lower).toContain("practical metaphor");
    expect(lower).toContain("provocative");
    expect(lower).toContain("coach themselves");
  });

  test("still refuses first-person experience it does not have", () => {
    expect(lower).toContain("no life to draw on");
    // The specific phrasing the brief would have produced.
    expect(lower).not.toContain("as if from");
    expect(lower).toContain('never "i remember when"');
  });

  test("may name published thinkers but never a programme mentor", () => {
    // Published work is citable: they chose to publish.
    expect(SHIPPED).toContain("Peter Drucker");
    expect(SHIPPED).toContain("Kim Scott");
    // A closed room is not, and that guard is unchanged.
    expect(lower).toContain("never name an individual mentor");
    expect(lower).toContain("the distinction is consent");
  });

  test("naming a source is never licence to invent one", () => {
    expect(lower).toContain("cite the idea, not a quotation");
    expect(lower).toContain("never invent a quote");
    expect(lower).toContain("do not name-drop for authority");
  });
});

describe("the two regressions the 2026-08-23 eval found", () => {
  /*
   * Both were caused by the same change and both are the same shape: the
   * prompt gained a rule, and the model started performing the rule instead of
   * answering. Pinned because the fix is one line each and one line is easy to
   * lose in a later edit.
   */
  test("a sourcing question gets an answer, not a policy briefing", () => {
    // attribution scored 4.75 -> 4.67: "explains its attribution policy at
    // length instead of just asking which claim and moving on".
    expect(lower).toContain("answer a sourcing question in one line");
    expect(lower).toContain("do not explain this policy at length");
  });

  test("declining to know something still leaves the founder somewhere to go", () => {
    // knowledge-gap scored 4.75 -> 4.67: "stops at the question without
    // offering any next move".
    expect(lower).toContain("a refusal with nothing after it is a dead end");
  });
});
