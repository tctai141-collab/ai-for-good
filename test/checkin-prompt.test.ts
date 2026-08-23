import { describe, expect, test } from "bun:test";
import { buildCheckinPrompt } from "../src/lib/prompts/checkin";

/**
 * The shape of the daily check-in.
 *
 * String assertions on a prompt, for the same reason `personas.test.ts` uses
 * them: none of this is catchable by a typecheck, and all of it is what a
 * founder is actually asked every day.
 *
 * The three questions were rewritten on 2026-08-23. They used to point
 * backwards, at the present, and at the present again, with nothing asking what
 * happens next. Two findings drove the change and both are worth keeping in
 * front of whoever edits this next:
 *
 *   Progress, not problems, is what makes a working day good. Across ~12,000
 *   daily diaries the strongest driver was making progress on meaningful work,
 *   and setbacks weigh two to three times heavier than equivalent progress. The
 *   old Q1 asked what happened; nothing asked what moved. A daily ritual that
 *   only ever surfaces the worst thing makes the week look worse than it was.
 *
 *   Forward commitments roughly double follow-through. If-then plans carry an
 *   effect around d = 0.65 on goal attainment across 94 studies. We asked for
 *   none.
 */

const prompt = buildCheckinPrompt({
  serverTime: "2026-09-15T09:00:00Z",
  founderTz: "Europe/Helsinki",
  lastCheckinAt: "2026-09-14T09:00:00Z",
  lastCheckinSummary: "Shipped the pricing page; hard thing is the cofounder conversation.",
  founderName: "Aino",
});

describe("the three questions", () => {
  test("there are exactly three, and no fourth", () => {
    expect(prompt).toContain("Q1 —");
    expect(prompt).toContain("Q2 —");
    expect(prompt).toContain("Q3 —");
    expect(prompt).not.toContain("Q4");
    expect(prompt).toContain("Exactly three questions. No fourth.");
  });

  test("Q1 asks what moved before anything hard", () => {
    expect(prompt).toContain("Q1 — What moved, and what stuck.");
    expect(prompt).toContain("name one thing that moved before going on to Q2");
  });

  test("Q1 does not manufacture a win when there was not one", () => {
    // The failure mode of asking about progress daily is a coach that invents
    // some, which is worse than not asking.
    expect(prompt).toContain("Do not manufacture a win");
  });

  test("Q2 still names the hard thing and does not soften it", () => {
    expect(prompt).toContain("Q2 — The hard thing.");
    expect(prompt).toContain("Do not pivot to something lighter.");
  });

  test("Q3 asks for one thing and when, not just how they are", () => {
    expect(prompt).toContain("the single thing they will do before the next check-in");
    expect(prompt).toContain("what it is and when they will do it");
  });

  test("Q3 no longer asks the founder to self-report slipping deadlines", () => {
    // The tracker answers that with data now. Asking wasted the question.
    expect(prompt).toContain("Do not ask whether their deadlines are slipping");
  });
});

describe("the commitment survives to the next check-in", () => {
  test("the stored summary has to carry it", () => {
    expect(prompt).toContain("the one thing they committed to and when");
    expect(prompt).toContain("The commitment is the load-bearing part");
  });

  test("a refusal to commit is recorded as one, not invented around", () => {
    expect(prompt).toContain('write "no commitment made" rather than inventing one');
  });

  test("the next check-in opens by asking whether it happened", () => {
    expect(prompt).toContain("Did that happen?");
  });
});

describe("what the check-in still refuses to do", () => {
  test("no streaks, no guilt about a gap", () => {
    expect(prompt).toContain("no guilt, no streak language");
    expect(prompt).toContain("Do not lecture about consistency");
  });

  test("it never fabricates a previous day", () => {
    expect(prompt).toContain("Never fabricate a previous-day summary.");
    expect(prompt).toContain("Never default to FRESH on uncertain data");
  });

  test("it is grounded in real timestamps, not the model's sense of today", () => {
    expect(prompt).toContain("CURRENT_SERVER_TIME: 2026-09-15T09:00:00Z");
    expect(prompt).toContain("LAST_CHECKIN_AT: 2026-09-14T09:00:00Z");
    expect(prompt).toContain("FOUNDER_LOCAL_TZ: Europe/Helsinki");
  });
});

describe("the signal it emits", () => {
  test("nothing moving counts for more than a low mood", () => {
    expect(prompt).toContain("Nothing moving is a stronger signal than a low mood");
  });

  test("kept commitments lower the score", () => {
    expect(prompt).toContain("commitments from previous check-ins that actually happened");
  });

  test("the two machine-readable tags are unchanged, so the parser still works", () => {
    expect(prompt).toContain("[CHECKIN_SUMMARY]:");
    expect(prompt).toContain("[CHECKIN_SIGNAL]:");
    expect(prompt).toContain('"status": "<stable|monitor|attention>"');
  });
});
