import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createFounder, createOrganizer, get, post, startServer, type Harness, type Session } from "./helpers/harness";

/**
 * The programme, and what the advisor is told about it.
 *
 * This replaces a hardcoded file that caused a real incident: a founder asked
 * how to do market validation and was told about "the automation and robotics
 * space you are looking at" — the previous cohort's research theme, presented
 * as a fact about their company, in a week the sprint had not started.
 *
 * Each of those three faults gets a test, because the point of moving this into
 * the database was not convenience. It was that all three were possible.
 */

let h: Harness;
let organizer: Session;
let founder: Session;

/** The literal heading the injected block opens with. */
const PROGRAMME_HEADER = "PROGRAMME — the cohort's shared schedule";

async function systemPrompt() {
  const res = await post(h, "/api/chat", {
    messages: [{ role: "user", content: "How do I do market validation?" }],
    personality: "marten",
    posture: "thinking",
  }, founder.cookie);
  expect(res.status).toBe(200);
  return h.advisorCalls[h.advisorCalls.length - 1]!;
}

async function saveWeek(week: number, fields: Record<string, string>) {
  return post(h, "/api/programme", { week, ...fields }, organizer.cookie);
}

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
  founder = await createFounder(h, organizer, "founder@example.test", "Aino", "founder-password-11");
});

afterAll(() => h?.stop());

describe("editing the programme", () => {
  test("organizers can save and read back a week", async () => {
    const saved = await saveWeek(1, {
      phase: "Trend Research",
      title: "Orientation",
      milestones: "Define the research framework\nClarify roles",
      sessions: "Tue 9:30 — Team meeting",
    });
    expect(saved.status).toBe(200);

    const body = await (await get(h, "/api/programme", organizer.cookie)).json() as
      { weeks: { week: number; phase: string; milestones: string }[] };
    expect(body.weeks).toHaveLength(1);
    expect(body.weeks[0]!.phase).toBe("Trend Research");
  });

  test("founders cannot read or write it", async () => {
    expect((await get(h, "/api/programme", founder.cookie)).status).toBe(403);
    expect((await post(h, "/api/programme", { week: 2, title: "Nope" }, founder.cookie)).status).toBe(403);
  });

  test("anonymous callers get nothing", async () => {
    expect((await get(h, "/api/programme")).status).toBe(401);
  });

  test("a week outside the programme is refused", async () => {
    expect((await saveWeek(0, { title: "Zero" })).status).toBe(400);
    expect((await saveWeek(16, { title: "Sixteen" })).status).toBe(400);
  });

  test("clearing every field removes the week rather than storing a blank one", async () => {
    await saveWeek(9, { phase: "Temp", title: "Temp", milestones: "x", sessions: "y" });
    await saveWeek(9, { phase: "", title: "", milestones: "", sessions: "" });

    const body = await (await get(h, "/api/programme", organizer.cookie)).json() as { weeks: { week: number }[] };
    expect(body.weeks.some((w) => w.week === 9)).toBe(false);
  });
});

describe("what reaches the advisor once the sprint is running", () => {
  let running: Harness;
  let runningOrganizer: Session;
  let runningFounder: Session;

  beforeAll(async () => {
    // Far enough back that "now" lands inside week 2.
    const started = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    running = await startServer({ sprintStartDate: started });
    runningOrganizer = await createOrganizer(running, "org2@example.test");
    runningFounder = await createFounder(running, runningOrganizer, "f2@example.test", "Bo", "bo-password-11223");

    await post(running, "/api/programme", {
      week: 2,
      phase: "Trend Research",
      title: "Deep Dive",
      milestones: "Draft the interview guide\nSchedule five interviews",
      sessions: "Wed 13:00 — Workshop",
    }, runningOrganizer.cookie);
  });

  afterAll(() => running?.stop());

  async function runningPrompt() {
    const res = await post(running, "/api/chat", {
      messages: [{ role: "user", content: "What should I focus on?" }],
      personality: "marten",
      posture: "thinking",
    }, runningFounder.cookie);
    expect(res.status).toBe(200);
    return running.advisorCalls[running.advisorCalls.length - 1]!;
  }

  test("the current week's content is given, and only that week's", async () => {
    const call = await runningPrompt();
    expect(call.system).toContain(PROGRAMME_HEADER);
    expect(call.system).toContain("Week 2 of 15");
    expect(call.system).toContain("Draft the interview guide");
    // Week 1 was saved in the other harness, but even so: one week at a time.
    expect(call.system).not.toContain("Orientation");
  });

  test("it is framed as the cohort's, not the founder's", async () => {
    /*
     * The whole reason the old version caused an incident. Milestones arrived
     * with no framing and a cohort research theme was read as a fact about one
     * person's company.
     */
    const call = await runningPrompt();
    expect(call.system).toContain("It is not a");
    expect(call.system.toLowerCase()).toContain("never infer");
  });

  test("a week with nothing entered says nothing", async () => {
    // Week 2 has content; clear it and the block must disappear entirely
    // rather than render an empty heading.
    await post(running, "/api/programme", { week: 2, phase: "", title: "", milestones: "", sessions: "" }, runningOrganizer.cookie);
    const call = await runningPrompt();
    expect(call.system).not.toContain(PROGRAMME_HEADER);
  });
});

describe("what reaches the advisor", () => {
  test("nothing at all before the sprint starts", async () => {
    /*
     * The harness runs with SPRINT_START_DATE in the future, which is exactly
     * the situation that produced "You are now in Week 1 of 15" three weeks
     * early. Week 1 has content saved above; it must still say nothing.
     */
    const call = await systemPrompt();
    // The section header, not the bare word — the persona's own rule mentions
    // PROGRAMME, which is the point of it.
    expect(call.system).not.toContain(PROGRAMME_HEADER);
    expect(call.system).not.toContain("Trend Research");
    expect(call.system).not.toContain("Week 1 of");
  });

  test("the persona still tells it to admit it does not know", async () => {
    const call = await systemPrompt();
    expect(call.system.toLowerCase()).toContain("unless a programme section appears below");
  });

  test("the programme is never folded into the cached persona block", async () => {
    // It changes weekly. Cached, a stale week would be served until the entry
    // expired — the same class of bug as the hardcoded file, with a shorter fuse.
    const call = await systemPrompt();
    expect(call.systemBlocks[0]!.text).not.toContain(PROGRAMME_HEADER);
  });
});
