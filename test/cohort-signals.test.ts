import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createFounder, createOrganizer, get, post, startServer, type Harness, type Session } from "./helpers/harness";

/**
 * Strain and silence are different problems.
 *
 * `needAttention` used to count a founder whose weekly signal was >= 2 OR whose
 * signal was 0 — and 0 means no check-in at all. So somebody in real difficulty
 * and somebody who never opened the app landed in the same number, and the grid
 * painted both the same red.
 *
 * They call for opposite responses. Four founders showing strain is a coaching
 * problem. Six founders who have not checked in is an onboarding problem, and in
 * the first fortnight it is the more urgent one, because if adoption is broken
 * every other signal on the page is noise.
 *
 * The sprint starts in the future in the harness, so no week is settled and both
 * counts are zero — which is itself the right answer, and worth pinning: before
 * the programme begins nobody is behind on anything.
 */

let h: Harness;
let organizer: Session;

async function cohort() {
  const res = await get(h, "/api/cohort", organizer.cookie);
  expect(res.status).toBe(200);
  return await res.json() as {
    needAttention: number;
    quiet: number;
    cohortSize: number;
    teams: { name: string; temp: number[] }[];
  };
}

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
  await createFounder(h, organizer, "a@example.test", "Aino", "aino-password-1122");
  await createFounder(h, organizer, "b@example.test", "Bo", "bo-password-11223");
});

afterAll(() => h?.stop());

describe("the two counts are separate", () => {
  test("both are reported, not merged into one", async () => {
    const body = await cohort();
    expect(body).toHaveProperty("needAttention");
    expect(body).toHaveProperty("quiet");
    expect(typeof body.quiet).toBe("number");
  });

  test("nobody is behind before the programme has started", async () => {
    // Every founder was created today and the sprint starts in the future.
    const body = await cohort();
    expect(body.needAttention).toBe(0);
    expect(body.quiet).toBe(0);
    expect(body.cohortSize).toBe(2);
  });

  test("a founder who has not checked in is not counted as strained", async () => {
    /*
     * The regression this file exists for. Neither founder has ever checked in,
     * so if silence still counted as strain, needAttention would be 2.
     */
    const body = await cohort();
    expect(body.needAttention).toBe(0);
  });
});

describe("the privacy boundary still holds", () => {
  test("adding a count did not add content", async () => {
    const body = await cohort();
    const serialised = JSON.stringify(body);
    // Themes, scores and timing only — never anything anybody wrote.
    expect(serialised).not.toContain("message");
    expect(serialised).not.toContain("summary");
    expect(serialised).not.toContain("prompt");
  });
});

describe("with the sprint actually running", () => {
  let live: Harness;
  let boss: Session;

  /*
   * Started 15 days ago, so today is week 3 and week 2 — days 8 to 2 ago — is
   * the settled week the counts are judged on. A check-in five days old lands
   * in it. Founders are backdated to the start date too: an absence only counts
   * once somebody was actually enrolled for the week, which is deliberate and
   * would otherwise mask the very thing being tested.
   */
  beforeAll(async () => {
    const started = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    live = await startServer({ sprintStartDate: started });
    boss = await createOrganizer(live, "org@example.test");
    await createFounder(live, boss, "strained@example.test", "Strained", "strained-password-1");
    await createFounder(live, boss, "silent@example.test", "Silent", "silent-password-112");
    const fine = await createFounder(live, boss, "fine@example.test", "Fine", "fine-password-11223");

    const db = live.db();
    try {
      db.run("UPDATE users SET created_at = datetime('now', '-15 days') WHERE role = 'founder'");
    } finally {
      db.close();
    }

    await saveCheckin("strained@example.test", 88);
    await saveCheckin("fine@example.test", 12);
    // `silent` writes nothing at all. That is the point of them.
    void fine;
  });

  afterAll(() => live?.stop());

  async function saveCheckin(email: string, mood: number) {
    const db = live.db();
    try {
      // Written straight in: the point of the fixture is where the row lands in
      // the week grid, and going through the API would only stamp it as today.
      db.run(
        `INSERT INTO checkins (id, user_email, theme, prompt, mood, created_at)
         VALUES ($id, $email, 'runway', 'a summary', $mood, datetime('now', '-5 days'))`,
        { $id: `${email}-settled`, $email: email, $mood: mood },
      );
    } finally {
      db.close();
    }
  }

  async function liveCohort() {
    const res = await get(live, "/api/cohort", boss.cookie);
    expect(res.status).toBe(200);
    return await res.json() as { week: number; needAttention: number; quiet: number; teams: { name: string; temp: number[] }[] };
  }

  test("the fixture really is in the settled week", async () => {
    const body = await liveCohort();
    expect(body.week).toBe(3);
    const strained = body.teams.find((t) => t.name === "Strained")!;
    expect(strained.temp[1]).toBe(3);
  });

  test("strain is counted as strain", async () => {
    expect((await liveCohort()).needAttention).toBe(1);
  });

  test("silence is counted separately, and never as strain", async () => {
    /*
     * The regression. Before the split this founder was folded into
     * needAttention, so it read 2 and an onboarding problem looked like a
     * coaching problem.
     */
    const body = await liveCohort();
    expect(body.quiet).toBe(1);
    expect(body.needAttention).toBe(1);
    expect(body.teams.find((t) => t.name === "Silent")!.temp[1]).toBe(0);
  });

  test("a founder who checked in calmly is in neither count", async () => {
    const body = await liveCohort();
    expect(body.teams.find((t) => t.name === "Fine")!.temp[1]).toBe(1);
  });
});
