import { describe, expect, test } from "bun:test";
import {
  INSTRUMENT_PREAMBLE,
  readAnswer,
  INSTRUMENT_VERSION,
  WIDGET_ORDER,
  WORKING_GENIUS_ITEMS,
  WORKING_GENIUS_TYPES,
  bandOf,
  scoreWorkingGenius,
  type WorkingGeniusId,
  type WorkingGeniusResponses,
} from "../src/lib/workingGenius";

/**
 * The original six-item quiz had three defects that all produced confident,
 * wrong answers rather than visible failures:
 *
 *   1. Of the 15 possible type pairs only 5 were asked, and one of those twice.
 *      Enablement and tenacity were compared to each other and to nothing else,
 *      so their scores always summed to exactly 2 no matter who answered.
 *   2. Max score per type was 2, so ties at the top were the normal case.
 *   3. Ties fell through to object insertion order, which handed most of them
 *      to wonder.
 *
 * These tests pin the structural properties that stop each of those coming
 * back, so a later edit to the item bank fails here rather than in front of a
 * cohort.
 */

const pairKey = (a: WorkingGeniusId, b: WorkingGeniusId) => [a, b].sort().join("|");

/** Answers every item by a fixed personal preference order. */
function answerByPreference(order: WorkingGeniusId[]): WorkingGeniusResponses {
  const rank = new Map(order.map((t, i) => [t, i]));
  const out: WorkingGeniusResponses = {};
  for (const item of WORKING_GENIUS_ITEMS) {
    const [x, y] = item.options;
    out[item.id] = rank.get(x.id)! < rank.get(y.id)! ? x.id : y.id;
  }
  return out;
}

describe("item bank structure", () => {
  test("is 30 items with unique ids", () => {
    expect(WORKING_GENIUS_ITEMS.length).toBe(30);
    expect(new Set(WORKING_GENIUS_ITEMS.map((i) => i.id)).size).toBe(30);
  });

  test("covers all 15 type pairs exactly twice, the island bug", () => {
    const seen = new Map<string, number>();
    for (const item of WORKING_GENIUS_ITEMS) {
      const k = pairKey(item.options[0].id, item.options[1].id);
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    // 6 types choose 2 = 15 distinct pairs, no self-pairs, none missing.
    expect(seen.size).toBe(15);
    for (const [pair, n] of seen) expect([pair, n]).toEqual([pair, 2]);
  });

  test("every type is compared to every other type", () => {
    for (const a of WIDGET_ORDER) {
      const opponents = new Set<WorkingGeniusId>();
      for (const item of WORKING_GENIUS_ITEMS) {
        const ids = item.options.map((o) => o.id);
        if (ids.includes(a)) opponents.add(ids.find((x) => x !== a)!);
      }
      expect([a, opponents.size]).toEqual([a, 5]);
    }
  });

  test("every type appears in exactly 10 items, 5 per screen position", () => {
    for (const t of WIDGET_ORDER) {
      const first = WORKING_GENIUS_ITEMS.filter((i) => i.options[0].id === t).length;
      const second = WORKING_GENIUS_ITEMS.filter((i) => i.options[1].id === t).length;
      // Balanced position kills the "people pick the top one" bias.
      expect([t, first, second]).toEqual([t, 5, 5]);
    }
  });

  test("each pair's two askings are far apart and differently worded", () => {
    const positions = new Map<string, number[]>();
    WORKING_GENIUS_ITEMS.forEach((item, idx) => {
      const k = pairKey(item.options[0].id, item.options[1].id);
      positions.set(k, [...(positions.get(k) ?? []), idx]);
    });
    for (const [pair, at] of positions) {
      // Exactly twice, which is the structural claim the rotation exists to
      // make. Asserted here so the gap check below cannot pass vacuously on a
      // pair that was somehow only asked once.
      expect([pair, at.length]).toEqual([pair, 2]);
      const first = at[0] ?? -1;
      const second = at[1] ?? -1;
      expect([pair, second - first >= 10]).toEqual([pair, true]);
    }
    const prompts = WORKING_GENIUS_ITEMS.map((i) => i.prompt);
    expect(new Set(prompts).size).toBe(30);
    const labels = WORKING_GENIUS_ITEMS.flatMap((i) => i.options.map((o) => o.label));
    expect(new Set(labels).size).toBe(60);
  });

  test("no item pits a type against itself", () => {
    for (const item of WORKING_GENIUS_ITEMS) {
      expect([item.id, item.options[0].id === item.options[1].id]).toEqual([item.id, false]);
    }
  });

  test("every type has copy for all three bands", () => {
    expect(WORKING_GENIUS_TYPES.length).toBe(6);
    for (const t of WORKING_GENIUS_TYPES) {
      expect([t.id, t.asGenius.length > 40, t.asCompetency.length > 40, t.asFrustration.length > 40])
        .toEqual([t.id, true, true, true]);
    }
  });
});

describe("the escape hatch", () => {
  /*
   * Some people do neither, do both, or do something conditional. Forcing them
   * to click one of two wrong answers puts noise in the score and tells nobody
   * anything. The instrument stays a forced choice, because that is what keeps
   * the comparison graph complete, and "neither" abstains rather than guessing.
   */
  const all = (pick: (item: (typeof WORKING_GENIUS_ITEMS)[number]) => unknown) => {
    const r: Record<string, unknown> = {};
    for (const item of WORKING_GENIUS_ITEMS) r[item.id] = pick(item);
    return r as WorkingGeniusResponses;
  };

  test("a legacy bare type id still scores exactly as it did", () => {
    // afs-1 rows are on disk. They must keep their result forever.
    const legacy = all((item) => item.options[0]!.id);
    const modern = all((item) => ({ choice: item.options[0]!.id }));
    const a = scoreWorkingGenius(legacy, "2026-09-10");
    const b = scoreWorkingGenius(modern, "2026-09-10");
    expect(b.counts).toEqual(a.counts);
    expect(b.ranking).toEqual(a.ranking);
  });

  test("an abstention removes the item from both of its types, not one", () => {
    /*
     * The whole point of the rate. If only the unchosen side lost a contest,
     * abstaining would quietly reward whichever type happened to be listed
     * first.
     */
    const responses = all((item) => item.options[0]!.id) as Record<string, unknown>;
    const [first] = WORKING_GENIUS_ITEMS;
    responses[first!.id] = { choice: "neither", text: "Depends entirely who is in the room." };

    const result = scoreWorkingGenius(responses as WorkingGeniusResponses, "2026-09-10");
    expect(result.abstentions).toEqual([first!.id]);
    for (const opt of first!.options) expect(result.contests[opt.id]).toBe(9);
    for (const t of WIDGET_ORDER) {
      if (!first!.options.some((o) => o.id === t)) expect(result.contests[t]).toBe(10);
    }
  });

  test("ranking on the rate, so abstaining does not cost you the band", () => {
    /*
     * A type asked eight times and winning all eight is stronger than one asked
     * ten times and winning nine. Sorting on raw wins says the opposite, which
     * is the bug this exists to prevent.
     */
    const responses: Record<string, unknown> = {};
    for (const item of WORKING_GENIUS_ITEMS) {
      // Wonder wins everything it contests.
      const wonder = item.options.find((o) => o.id === "wonder");
      responses[item.id] = wonder ? "wonder" : item.options[0]!.id;
    }
    // Now abstain on two of wonder's ten, so it wins 8 of 8.
    const wonderItems = WORKING_GENIUS_ITEMS.filter((i) => i.options.some((o) => o.id === "wonder"));
    for (const item of wonderItems.slice(0, 2)) {
      responses[item.id] = { choice: "neither", text: "Neither, honestly." };
    }

    const result = scoreWorkingGenius(responses as WorkingGeniusResponses, "2026-09-10");
    expect(result.counts.wonder).toBe(8);
    expect(result.contests.wonder).toBe(8);
    expect(result.rates.wonder).toBe(1);
    expect(result.ranking[0]).toBe("wonder");
  });

  test("free text outranks the click when the two disagree", () => {
    /*
     * A click is a nearest fit against two options someone else wrote. The text
     * is unprompted and specific. The disagreement is kept rather than
     * smoothed over, because a founder who clicked one thing and described
     * another has said something worth naming.
     */
    const [item] = WORKING_GENIUS_ITEMS;
    const clicked = item!.options[0]!.id;
    const described = item!.options[1]!.id;
    const read = readAnswer({ choice: clicked, text: "In practice I do the other one.", resolved: described });
    expect(read.effective).toBe(described);
    expect(read.overrode).toBe(true);

    const responses = all((i) => i.options[0]!.id) as Record<string, unknown>;
    responses[item!.id] = { choice: clicked, text: "In practice I do the other one.", resolved: described };
    const result = scoreWorkingGenius(responses as WorkingGeniusResponses, "2026-09-10");
    expect(result.overrides).toEqual([{ itemId: item!.id, clicked, resolved: described }]);
  });

  test("text that was never classified does not silently abstain a real click", () => {
    // Someone adds optional context to an answer they did make. The click
    // stands until something reads the text.
    const read = readAnswer({ choice: "wonder", text: "Only when it is early in a project." });
    expect(read.effective).toBe("wonder");
    expect(read.overrode).toBe(false);
  });

  test("consistency ignores pairs where either asking abstained", () => {
    /*
     * Scoring an abstention as disagreement would punish a founder for using
     * the escape hatch honestly.
     *
     * Built from a fixed preference order, not from options[0]: round A and
     * round B deliberately flip which type is listed first, so answering by
     * position disagrees with itself every time and correctly scores
     * consistency 0. That is the instrument working, and it is why this test
     * needs a respondent with an actual preference.
     */
    const order: WorkingGeniusId[] = [
      "invention", "enablement", "tenacity", "wonder", "galvanizing", "discernment",
    ];
    const prefer = (a: WorkingGeniusId, b: WorkingGeniusId) =>
      order.indexOf(a) < order.indexOf(b) ? a : b;

    const responses: Record<string, unknown> = {};
    for (const item of WORKING_GENIUS_ITEMS) {
      responses[item.id] = prefer(item.options[0]!.id, item.options[1]!.id);
    }
    expect(scoreWorkingGenius(responses as WorkingGeniusResponses, "2026-09-10").consistency).toBe(1);

    const [first] = WORKING_GENIUS_ITEMS;
    responses[first!.id] = { choice: "neither", text: "Neither." };
    const result = scoreWorkingGenius(responses as WorkingGeniusResponses, "2026-09-10");
    // Fourteen pairs still had both askings answered, and all fourteen agreed.
    expect(result.consistency).toBe(1);
    expect(result.abstentions).toHaveLength(1);
  });

  test("junk in the stored shape abstains rather than throwing", () => {
    expect(readAnswer(undefined).effective).toBeNull();
    expect(readAnswer({ choice: "not-a-type" } as never).effective).toBeNull();
    expect(readAnswer("nonsense" as never).effective).toBeNull();
  });
});

describe("items ask what happens, not what you would like", () => {
  /*
   * A cohort tester stalled on the old wording: "I might rather be able to
   * rally them, but I'm not good at rallying people so in reality I do option
   * 2. Based on the wording it would mean I pick option 1 because I would
   * 'rather' rally, even if I can't."
   *
   * "You would rather" reads both as the thing you wish you did and as the
   * thing you do, and those give opposite answers from the same person. The
   * intent it was carrying is kept, the items still never ask which one you do
   * better, but the phrasing that reopens the ambiguity is banned outright.
   */
  const ASPIRATIONAL = ["would rather", "prefer", "ideally", "wish", "want to", "would choose"];

  test("no item uses an aspirational verb", () => {
    for (const item of WORKING_GENIUS_ITEMS) {
      const text = `${item.prompt} ${item.options.map((o) => o.label).join(" ")}`.toLowerCase();
      for (const banned of ASPIRATIONAL) {
        expect([item.id, banned, text.includes(banned)]).toEqual([item.id, banned, false]);
      }
    }
  });

  test("every prompt asks about actual behaviour", () => {
    /*
     * The sanctioned behavioural framings, as a whitelist rather than a
     * pattern. Thirty items reworded by hand is exactly where one slips back
     * into the aspirational voice, and a loose regex would wave it through.
     *
     * A new item either uses one of these or the list gets extended on
     * purpose, which is the point: extending it is a decision someone makes
     * with this comment in front of them.
     */
    const BEHAVIOURAL = [
      "actual", "end up", "find yourself", "in practice", "come to you",
      "what do you", "which do you", "what happens", "where does",
      "what were you", "what had you", "has to have happened",
      "first move", "were you doing", "what is it",
    ];
    for (const item of WORKING_GENIUS_ITEMS) {
      const prompt = item.prompt.toLowerCase();
      expect([item.id, BEHAVIOURAL.some((p) => prompt.includes(p))]).toEqual([item.id, true]);
    }
  });

  test("prompts are situations, not bare comparisons", () => {
    // "More energising..." and "More natural to you..." were three-word stubs
    // with no situation in them at all, which is where the reader supplies
    // their own framing and half of them supply the aspirational one.
    for (const item of WORKING_GENIUS_ITEMS) {
      expect([item.id, item.prompt.length]).toEqual([item.id, expect.any(Number)]);
      expect(item.prompt.length).toBeGreaterThan(28);
    }
  });

  test("the preamble says which reading is wanted", () => {
    expect(INSTRUMENT_PREAMBLE).toContain("how you actually behave");
    expect(INSTRUMENT_PREAMBLE).toContain("no better or worse answers");
  });

  test("the version is bumped, because the founder was asked something else", () => {
    /* The pairings and ids are untouched, so older rows still score the same
       and stay comparable. What changed is the wording, which is enough to
       make the banks different instruments — twice now: afs-2 moved off "you
       would rather", and afs-3 said the same things in plainer words and took
       out the "what do you actually do" tic that opened two thirds of them. */
    expect(INSTRUMENT_VERSION).toBe("afs-3");
  });

  test("no em dashes anywhere in the bank", () => {
    for (const item of WORKING_GENIUS_ITEMS) {
      const text = `${item.prompt} ${item.options.map((o) => o.label).join(" ")}`;
      expect([item.id, text.includes("\u2014")]).toEqual([item.id, false]);
    }
  });
});

describe("scoring", () => {
  test("a complete response set distributes exactly 30 wins", () => {
    const r = scoreWorkingGenius(answerByPreference([...WIDGET_ORDER]), "2026-08-23");
    const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(30);
    expect(r.version).toBe(INSTRUMENT_VERSION);
  });

  test("a consistent respondent gets their own preference order back", () => {
    // Tai's real Table Group result, used as the anchor: Invention and
    // Enablement genius, Tenacity and Wonder competency, Galvanizing and
    // Discernment frustration.
    const preference: WorkingGeniusId[] = [
      "invention", "enablement", "tenacity", "wonder", "galvanizing", "discernment",
    ];
    const r = scoreWorkingGenius(answerByPreference(preference), "2026-08-23");

    expect(r.ranking).toEqual(preference);
    expect(r.bands.genius).toEqual(["invention", "enablement"]);
    expect(r.bands.competency).toEqual(["tenacity", "wonder"]);
    expect(r.bands.frustration).toEqual(["galvanizing", "discernment"]);
    expect(r.primary).toBe("invention");
    // Rank i beats the 5-i types below it, twice each.
    expect(preference.map((t) => r.counts[t])).toEqual([10, 8, 6, 4, 2, 0]);
    expect(r.consistency).toBe(1);
    expect(r.contested).toEqual([]);
  });

  test("enablement and tenacity are no longer scored in isolation", () => {
    // The old quiz forced counts.enablement + counts.tenacity === 2 for every
    // respondent alive. Two people who differ only elsewhere must now be able
    // to differ here too.
    const finisher = scoreWorkingGenius(
      answerByPreference(["tenacity", "enablement", "discernment", "galvanizing", "invention", "wonder"]),
      "2026-08-23",
    );
    const dreamer = scoreWorkingGenius(
      answerByPreference(["wonder", "invention", "galvanizing", "discernment", "enablement", "tenacity"]),
      "2026-08-23",
    );
    expect(finisher.counts.tenacity).toBe(10);
    expect(dreamer.counts.tenacity).toBe(0);
    expect(finisher.counts.enablement + finisher.counts.tenacity).not.toBe(
      dreamer.counts.enablement + dreamer.counts.tenacity,
    );
  });

  test("a level total is broken by head-to-head, not by declaration order", () => {
    // Wonder is first in WIDGET order, so the old insertion-order tie-break
    // would hand it the win. Here invention takes both direct meetings while
    // the two stay level on totals, so invention must rank above it.
    const preference: WorkingGeniusId[] = [
      "wonder", "invention", "discernment", "galvanizing", "enablement", "tenacity",
    ];
    const responses = answerByPreference(preference);
    // Flip both wonder-vs-invention items to invention, and hand wonder two
    // wins back elsewhere so the totals stay equal.
    responses["wi-a"] = "invention";
    responses["wi-b"] = "invention";
    const r = scoreWorkingGenius(responses, "2026-08-23");

    expect(r.counts.wonder).toBe(8);
    expect(r.counts.invention).toBe(10);
    expect(r.ranking[0]).toBe("invention");
    expect(r.ranking[1]).toBe("wonder");
  });

  test("a genuine dead heat is reported rather than silently resolved", () => {
    const preference: WorkingGeniusId[] = [
      "wonder", "invention", "discernment", "galvanizing", "enablement", "tenacity",
    ];
    const responses = answerByPreference(preference);
    // Split the head-to-head 1-1, leaving both on 9 wins and nothing to
    // separate them.
    responses["wi-a"] = "invention";
    const r = scoreWorkingGenius(responses, "2026-08-23");

    expect(r.counts.wonder).toBe(9);
    expect(r.counts.invention).toBe(9);
    expect(r.contested).toEqual([["wonder", "invention"]]);
    // Both are in the genius band, so the unresolved order costs the reader
    // nothing here. The band boundary below them is still clean.
    expect(new Set(r.bands.genius)).toEqual(new Set(["wonder", "invention"]));
    expect(r.boundaryMargins.geniusCompetency).toBe(3);
  });

  test("a tie across a band boundary is surfaced as a zero margin", () => {
    const preference: WorkingGeniusId[] = [
      "wonder", "invention", "discernment", "galvanizing", "enablement", "tenacity",
    ];
    const responses = answerByPreference(preference);
    // Invention (rank 2) and discernment (rank 3) straddle the genius /
    // competency line, two wins apart. Handing discernment one of their two
    // direct meetings moves both to seven and splits the head-to-head 1-1, so
    // nothing in the answers separates them.
    responses["id-a"] = "discernment";
    const r = scoreWorkingGenius(responses, "2026-08-23");

    expect(r.counts.invention).toBe(7);
    expect(r.counts.discernment).toBe(7);
    expect(r.contested).toEqual([["invention", "discernment"]]);
    // Whichever way it fell, the reader is told the line was a coin toss.
    expect(r.boundaryMargins.geniusCompetency).toBe(0);
  });

  test("consistency reflects how often the two askings agreed", () => {
    const responses = answerByPreference([...WIDGET_ORDER]);
    expect(scoreWorkingGenius(responses, "x").consistency).toBe(1);

    // Contradict three of the fifteen pairs.
    responses["wi-a"] = "invention";
    responses["dg-a"] = "galvanizing";
    responses["et-a"] = "tenacity";
    const r = scoreWorkingGenius(responses, "x");
    expect(r.consistency).toBeCloseTo(12 / 15, 10);
  });

  test("a partial response set scores without throwing", () => {
    const full = answerByPreference([...WIDGET_ORDER]);
    const partial: WorkingGeniusResponses = {};
    for (const item of WORKING_GENIUS_ITEMS.slice(0, 8)) {
      const answer = full[item.id];
      if (answer) partial[item.id] = answer;
    }
    const r = scoreWorkingGenius(partial, "x");
    expect(Object.values(r.counts).reduce((a, b) => a + b, 0)).toBe(8);
    expect(r.ranking.length).toBe(6);
  });

  test("junk responses are ignored rather than scored", () => {
    const r = scoreWorkingGenius(
      { "wi-a": "tenacity" as WorkingGeniusId, "not-an-item": "wonder" as WorkingGeniusId },
      "x",
    );
    // Tenacity is not an option on wi-a, and the second key is not an item.
    expect(Object.values(r.counts).reduce((a, b) => a + b, 0)).toBe(0);
  });

  test("bandOf agrees with the bands it came from", () => {
    const r = scoreWorkingGenius(answerByPreference([...WIDGET_ORDER]), "x");
    expect(WIDGET_ORDER.map((t) => bandOf(r, t))).toEqual([
      "genius", "genius", "competency", "competency", "frustration", "frustration",
    ]);
  });
});
