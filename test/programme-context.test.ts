import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createFounder, createOrganizer, post, startServer, type Harness, type Session } from "./helpers/harness";

/**
 * What the advisor is told about the cohort.
 *
 * A founder asked how to do market validation and was answered with "in the
 * automation and robotics space you are looking at". They are not building
 * robotics. The model had not invented it: every message carried an injected
 * block headed "## Sprint S26 Context" — the previous cohort's programme —
 * which asserted the current week's milestone was to "define max 3 sub-sectors
 * within automation & robotics". A cohort-wide research theme was handed over
 * as though it were a fact about that person's company, and it was the wrong
 * cohort's theme at that. It also announced "You are now in Week 1 of 15" three
 * weeks before the sprint began, because the week calculation clamps anything
 * earlier to week 1.
 *
 * The programme context is gone until it can be edited rather than hardcoded.
 * These tests assert it stays gone, and — the more important half — that the
 * advisor is told to ask rather than fill the gap by inference. Removing
 * context does not by itself stop a model inventing it.
 */

let h: Harness;
let organizer: Session;
let founder: Session;

async function chat(personality: string) {
  const res = await post(h, "/api/chat", {
    messages: [{ role: "user", content: "How do I do market validation?" }],
    personality,
    posture: "thinking",
  }, founder.cookie);
  expect(res.status).toBe(200);
  return h.advisorCalls[h.advisorCalls.length - 1]!.system;
}

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
  founder = await createFounder(h, organizer, "founder@example.test", "Aino", "founder-password-11");
});

afterAll(() => h?.stop());

describe("the advisor is not told a programme it cannot know", () => {
  for (const personality of ["none", "marten"]) {
    test(`${personality}: carries no sprint week, milestones or sessions`, async () => {
      const system = await chat(personality);

      expect(system).not.toContain("automation & robotics");
      expect(system).not.toContain("Sprint S26 Context");
      expect(system).not.toContain("You are now in Week");
      expect(system).not.toContain("Current milestones");
      expect(system).not.toContain("Today's sessions");
    });

    test(`${personality}: is told to ask rather than infer`, async () => {
      const system = (await chat(personality)).toLowerCase();

      // The vacuum has to be closed explicitly. Silence invites invention.
      expect(system).toContain("you do not know the cohort's schedule");
      expect(system).toContain("ask");
    });

    test(`${personality}: is told not to infer the founder's sector`, async () => {
      const system = await chat(personality);
      expect(system.toLowerCase()).toContain("sector");
    });
  }
});
