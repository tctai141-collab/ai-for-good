import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import * as personas from "../src/lib/personas";
import { FOUNDER_VOICE_SYSTEM, MARTEN_SYSTEM } from "../src/lib/personas";

/**
 * Guards on the advisor personas.
 *
 * These are string assertions, which is unusual for a test suite — but the
 * failure modes they cover are real ones that already happened once. The
 * previous Mårten prompt handed him four aphorisms he never coined, told him
 * never to admit being an AI, and pointed at a knowledge file that did not
 * exist. None of that is catchable by a typecheck, and all of it is a claim
 * being made to founders under a real, living colleague's name.
 *
 * What is NOT tested here is whether the persona sounds like him — that is the
 * eval set in the Marten AI workspace, scored by a human, and no assertion can
 * stand in for it.
 */

const lower = MARTEN_SYSTEM.toLowerCase();

describe("Mårten persona — provenance", () => {
  test("does not present other people's aphorisms as his own lines", () => {
    // Brandeis. Was listed in the old prompt under "use phrases like".
    expect(lower).not.toContain("sunshine is the best disinfectant");
    // Kay / Drucker. Same.
    expect(lower).not.toContain("the best way to predict the future");
    // A common HR aphorism the old prompt gave him verbatim.
    expect(lower).not.toContain("hire for attitude, train for skill");
  });

  test("attributes the quotes it does keep", () => {
    // He genuinely uses this one — and credits Drucker when he does, on stage.
    // It may appear only in the same sentence as the attribution.
    for (const line of MARTEN_SYSTEM.split("\n")) {
      if (line.toLowerCase().includes("culture eats strategy")) {
        expect(line.toLowerCase()).toContain("drucker");
      }
      if (line.toLowerCase().includes("sell before you build")) {
        expect(line.toLowerCase()).toContain("jyri");
      }
    }
  });

  test("keeps his own provenance-checked lines", () => {
    expect(lower).toContain("to avoid getting hacked, try to get hacked");
    expect(lower).toContain("be ok with who you are");
  });
});

describe("Mårten persona — anti-fabrication", () => {
  test("forbids inventing specifics about a real person", () => {
    expect(lower).toContain("never fabricate");
    expect(lower).toContain("no invented detail");
  });

  test("supplies real episodes so it does not have to invent any", () => {
    expect(MARTEN_SYSTEM).toContain("EPISODES YOU MAY REFER TO");
    expect(lower).toContain("innodb");
    expect(lower).toContain("john wattin");
  });
});

describe("Mårten persona — honest disclosure", () => {
  test("answers truthfully when asked directly whether it is an AI", () => {
    expect(lower).toContain("you are an ai trained on mårten's writing");
    expect(lower).toContain("never deceive");
  });

  test("no longer carries the blanket instruction to deny being an AI", () => {
    // The old prompt ended: "Never introduce yourself as an AI or assistant."
    // Applied to a persona of a real person, that is an instruction to lie.
    expect(lower).not.toContain("never introduce yourself as an ai");
  });
});

describe("persona policy", () => {
  test("the retired contrarian persona is gone, not renamed", () => {
    // It shipped as "You are Paul Graham". Package 1 de-named it; Tai then
    // removed it outright ("I don't know what that is"). This guards against
    // it coming back through the door it left by.
    expect(Object.keys(personas)).not.toContain("CONTRARIAN_SYSTEM");
    for (const value of Object.values(personas)) {
      if (typeof value !== "string") continue;
      expect(value).not.toContain("Paul Graham");
    }
  });

  test("the default founder voice is not a named person either", () => {
    expect(FOUNDER_VOICE_SYSTEM).not.toContain("Mickos");
    expect(FOUNDER_VOICE_SYSTEM).not.toContain("Graham");
  });

  test("no mock advisor corpus is shipped in the public repo", () => {
    // Nine files named after real corpora, each containing one line of
    // placeholder text, plus a README telling the next person to fill them
    // with copyrighted material. Deleted; this stops them coming back.
    const files = readdirSync("docs/advisors");
    expect(files).toEqual(["README.md"]);
  });
});
