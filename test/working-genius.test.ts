import { describe, expect, test } from "bun:test";
import {
  INSTRUMENT_PREAMBLE,
  INSTRUMENT_VERSION,
  ITEMS_PER_TYPE,
  WIDGET_ORDER,
  WORKING_GENIUS_ITEMS,
  WORKING_GENIUS_SCALE,
  WORKING_GENIUS_TYPES,
  bandOf,
  readAnswer,
  scoreWorkingGenius,
  type WorkingGeniusId,
  type WorkingGeniusResponses,
} from "../src/lib/workingGenius";

/**
 * The forced-choice bank this replaced was reported by the cohort as "very
 * black and white", and it was: thirty either/or items with one click each,
 * scores that summed to thirty for everybody by construction, and no way to
 * say "both of these, often".
 *
 * What these tests pin is the pair of properties that make the rating scale
 * work where a naive one would not: every type is asked the same number of
 * times, and the ranking is built on each person's own centre rather than on
 * raw means. Without the second, everybody who answers generously ranks as
 * strong at all six, which is not a finding.
 */

const itemsOf = (type: WorkingGeniusId) => WORKING_GENIUS_ITEMS.filter((i) => i.type === type);

/** Rates `high` types one point above everything else. */
function answerFavouring(high: WorkingGeniusId[], base = 3, lift = 1): WorkingGeniusResponses {
  const out: WorkingGeniusResponses = {};
  for (const item of WORKING_GENIUS_ITEMS) {
    out[item.id] = high.includes(item.type) ? base + lift : base;
  }
  return out;
}

describe("item bank structure", () => {
  test("is 42 statements with unique ids", () => {
    expect(WORKING_GENIUS_ITEMS.length).toBe(42);
    expect(new Set(WORKING_GENIUS_ITEMS.map((i) => i.id)).size).toBe(42);
  });

  test("every type is asked exactly seven times", () => {
    for (const t of WIDGET_ORDER) {
      expect([t, itemsOf(t).length]).toEqual([t, ITEMS_PER_TYPE]);
    }
  });

  test("no two statements in a row measure the same type", () => {
    /* Somebody who notices three Wonder statements together starts answering
       the pattern instead of the question. */
    for (let i = 1; i < WORKING_GENIUS_ITEMS.length; i++) {
      const previous = WORKING_GENIUS_ITEMS[i - 1]!;
      const here = WORKING_GENIUS_ITEMS[i]!;
      expect([here.id, here.type === previous.type]).toEqual([here.id, false]);
    }
  });

  test("each block of six asks every type once", () => {
    for (let start = 0; start < WORKING_GENIUS_ITEMS.length; start += 6) {
      const block = WORKING_GENIUS_ITEMS.slice(start, start + 6);
      expect(new Set(block.map((i) => i.type)).size).toBe(6);
    }
  });

  test("no statement asks what they would like to be, or what they are good at", () => {
    /*
     * The ambiguity a cohort tester found in the first bank: "I might rather
     * be able to rally them, but I'm not good at rallying so in reality I do
     * the other one." Every banned phrase reopens it.
     */
    const banned = ["would rather", "prefer", "ideally", "wish", "want to", "would choose", "good at"];
    for (const item of WORKING_GENIUS_ITEMS) {
      const text = item.statement.toLowerCase();
      for (const phrase of banned) {
        expect([item.id, phrase, text.includes(phrase)]).toEqual([item.id, phrase, false]);
      }
    }
  });

  test("every statement is a sentence about what this person does", () => {
    for (const item of WORKING_GENIUS_ITEMS) {
      expect([item.id, item.statement.endsWith(".")]).toEqual([item.id, true]);
      expect([item.id, /\bI\b/.test(item.statement)]).toEqual([item.id, true]);
      expect(item.statement.length).toBeLessThan(140);
    }
  });

  test("the type a statement measures is never in the statement", () => {
    /* Printing the type would turn the instrument into a self-portrait. */
    for (const item of WORKING_GENIUS_ITEMS) {
      for (const type of WORKING_GENIUS_TYPES) {
        expect([item.id, item.statement.toLowerCase().includes(type.label.toLowerCase())])
          .toEqual([item.id, false]);
      }
    }
  });

  test("the scale is five points, named, never to constantly", () => {
    expect(WORKING_GENIUS_SCALE.map((p) => p.value)).toEqual([1, 2, 3, 4, 5]);
    expect(WORKING_GENIUS_SCALE[0]!.label).toBe("Never");
    expect(WORKING_GENIUS_SCALE[4]!.label).toBe("Constantly");
    expect(new Set(WORKING_GENIUS_SCALE.map((p) => p.label)).size).toBe(5);
  });

  test("the preamble asks for behaviour, not aspiration", () => {
    expect(INSTRUMENT_PREAMBLE.toLowerCase()).toContain("actually");
    expect(INSTRUMENT_PREAMBLE.toLowerCase()).not.toContain("good at");
  });

  test("the version says this is a different instrument", () => {
    expect(INSTRUMENT_VERSION).toBe("afs-4");
  });
});

describe("what an answer is", () => {
  test("the five points are answers and nothing else is", () => {
    for (const point of [1, 2, 3, 4, 5]) expect(readAnswer(point)).toBe(point);
    for (const junk of [0, 6, -1, 3.5, "4", null, undefined, {}, NaN]) {
      expect([junk, readAnswer(junk)]).toEqual([junk, null]);
    }
  });

  test("a forced-choice answer from the old bank is not an answer here", () => {
    /* afs-1 to afs-3 rows keep the profile they were scored into on the day.
       Nothing re-scores them, and this scorer cannot read them. */
    expect(readAnswer("wonder")).toBeNull();
    expect(readAnswer({ choice: "wonder" })).toBeNull();
  });
});

describe("scoring on the person's own centre", () => {
  test("generosity does not become a profile", () => {
    /*
     * The failure a rating scale has that a forced choice does not: somebody
     * who answers four to everything and five to invention is telling us about
     * invention. Raw means would call them strong at all six.
     */
    const result = scoreWorkingGenius(answerFavouring(["invention"], 4), "2026-10-08");
    expect(result.ranking[0]).toBe("invention");
    expect(result.bands.genius).toContain("invention");
    expect(result.relative.invention).toBeGreaterThan(0);
    for (const t of WIDGET_ORDER) {
      if (t !== "invention") expect(result.relative[t]).toBeLessThan(0);
    }
  });

  test("the same shape of answers scores the same whether given high or low", () => {
    const high = scoreWorkingGenius(answerFavouring(["tenacity", "enablement"], 4), "2026-10-08");
    const low = scoreWorkingGenius(answerFavouring(["tenacity", "enablement"], 1), "2026-10-08");
    expect(low.ranking).toEqual(high.ranking);
    expect(low.bands).toEqual(high.bands);
  });

  test("the raw level is kept and is not what the bands are built on", () => {
    const generous = scoreWorkingGenius(answerFavouring(["wonder"], 4), "2026-10-08");
    const sparing = scoreWorkingGenius(answerFavouring(["wonder"], 1), "2026-10-08");
    // Same ranking, different levels: "you do a lot of all of it" survives.
    expect(generous.rates.wonder).toBeGreaterThan(sparing.rates.wonder);
    expect(generous.ranking[0]).toBe("wonder");
    expect(sparing.ranking[0]).toBe("wonder");
  });

  test("six types, split two and two and two", () => {
    const result = scoreWorkingGenius(answerFavouring(["wonder", "invention"], 3), "2026-10-08");
    expect(result.ranking).toHaveLength(6);
    expect(new Set(result.ranking).size).toBe(6);
    expect(result.bands.genius).toHaveLength(2);
    expect(result.bands.competency).toHaveLength(2);
    expect(result.bands.frustration).toHaveLength(2);
    for (const t of WIDGET_ORDER) expect(["genius", "competency", "frustration"]).toContain(bandOf(result, t));
  });

  test("points per type are kept, seven statements' worth", () => {
    const result = scoreWorkingGenius(answerFavouring([], 4), "2026-10-08");
    for (const t of WIDGET_ORDER) {
      expect([t, result.counts[t]]).toEqual([t, 4 * ITEMS_PER_TYPE]);
      expect([t, result.contests[t]]).toEqual([t, ITEMS_PER_TYPE]);
    }
  });
});

describe("answers that do not say much", () => {
  test("straight-lining is reported as a tie rather than presented as a profile", () => {
    const result = scoreWorkingGenius(answerFavouring([], 3), "2026-10-08");
    // Everything centres to zero, so every neighbouring pair is level.
    expect(result.contested.length).toBe(5);
    expect(result.ranking).toHaveLength(6);
    expect(result.boundaryMargins.geniusCompetency).toBe(0);
  });

  test("scattered answers about one type cost consistency", () => {
    const steady = scoreWorkingGenius(answerFavouring([], 4), "2026-10-08");

    const scattered: WorkingGeniusResponses = {};
    for (const item of WORKING_GENIUS_ITEMS) {
      const index = itemsOf(item.type).findIndex((i) => i.id === item.id);
      scattered[item.id] = index % 2 === 0 ? 1 : 5;
    }
    const result = scoreWorkingGenius(scattered, "2026-10-08");

    expect(steady.consistency).toBe(1);
    expect(result.consistency).toBeLessThan(0.2);
  });

  test("an unanswered statement is recorded, not guessed", () => {
    const answers = answerFavouring(["wonder"], 3);
    const dropped = WORKING_GENIUS_ITEMS[0]!;
    delete answers[dropped.id];

    const result = scoreWorkingGenius(answers, "2026-10-08");
    expect(result.abstentions).toEqual([dropped.id]);
    expect(result.contests[dropped.type]).toBe(ITEMS_PER_TYPE - 1);
    expect(result.ranking).toHaveLength(6);
  });

  test("a type nobody answered sinks rather than throwing", () => {
    const answers = answerFavouring([], 3);
    for (const item of itemsOf("tenacity")) delete answers[item.id];

    const result = scoreWorkingGenius(answers, "2026-10-08");
    expect(result.ranking[5]).toBe("tenacity");
    expect(Number.isFinite(result.boundaryMargins.competencyFrustration)).toBe(true);
  });
});

describe("the result carries its own provenance", () => {
  test("the version, the answers and the date are all in it", () => {
    const answers = answerFavouring(["galvanizing"], 3);
    const result = scoreWorkingGenius(answers, "2026-10-08");
    expect(result.version).toBe(INSTRUMENT_VERSION);
    expect(result.responses).toEqual(answers);
    expect(result.completedAt).toBe("2026-10-08");
    expect(result.primary).toBe(result.ranking[0]!);
  });

  test("scoring the same answers twice gives the same profile", () => {
    const answers = answerFavouring(["discernment", "wonder"], 2);
    const first = scoreWorkingGenius(answers, "2026-10-08");
    const second = scoreWorkingGenius(answers, "2026-10-08");
    expect(second).toEqual(first);
  });
});
