import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createFounder, createOrganizer, get, post, startServer,
  type Harness, type Session,
} from "./helpers/harness";
import { dueInstant } from "../src/lib/deadlines";
import {
  SURVEY_WEEK2_CLOSES_AT, SURVEY_WEEK2_ID, SURVEY_WEEK2_OPENS_AT,
} from "../src/db/schema";

/**
 * Roman's research survey, inside Sprint Buddy.
 *
 * It was a Webropol form. It moved here so founders take it where they already
 * are and organizers read it without a second system. What matters most is that
 * it stays research data: every statement answered, once, never edited, readable
 * by organizers and nobody else, and questions frozen once anybody has answered.
 */

let h: Harness;
let organizer: Session;
let mentor: Session;
let founder: Session;
let other: Session;

/* A window around now, in Helsinki wall-clock terms, the way the editor sends it. */
function helsinki(ms: number) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]),
  );
  return { on: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const GROUPS = [
  { heading: "How true is this?", lowLabel: "not at all", highLabel: "completely", items: ["First.", "Second."] },
  { heading: "How confident?", lowLabel: "none", highLabel: "complete", items: ["Third."] },
];

async function makeRound(title: string, opensInMin: number, closesInMin: number, groups = GROUPS) {
  const o = helsinki(Date.now() + opensInMin * 60_000);
  const c = helsinki(Date.now() + closesInMin * 60_000);
  const res = await post(h, "/api/survey", {
    action: "save-round", title, intro: "Intro.",
    opensOn: o.on, opensTime: o.time, closesOn: c.on, closesTime: c.time, groups,
  }, organizer.cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: string }).id;
}

type AdminRound = {
  id: string; title: string; intro: string; opensAt: string | null; closesAt: string | null;
  responses: number; locked: boolean;
  groups: { id: string; heading: string; lowLabel: string; highLabel: string; items: { id: string; statement: string }[] }[];
  results: { email: string; name: string; submittedAt: string | null; answers: Record<string, number> }[];
};
const adminRounds = async () =>
  ((await (await get(h, "/api/survey", organizer.cookie)).json()) as { rounds: AdminRound[] }).rounds;
const roundById = async (id: string) => (await adminRounds()).find((r) => r.id === id)!;
const fullAnswers = (round: AdminRound, value = 4) =>
  Object.fromEntries(round.groups.flatMap((g) => g.items.map((i) => [i.id, value])));

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "olivia@example.test", "Olivia Organizer");
  mentor = await createOrganizer(h, "mikko@example.test", "Mikko Mentor", "mikko-password-11", "mentor");
  founder = await createFounder(h, organizer, "frida@example.test", "Frida Founder", "frida-password-11");
  other = await createFounder(h, organizer, "gus@example.test", "Gus Founder", "gus-password-1234");
});

afterAll(() => h?.stop());

describe("Week 2, as Roman wrote it", () => {
  test("every statement is carried over word for word", async () => {
    /* Written out here from the Webropol form rather than imported from the
       seed, so a typo in the seed cannot agree with itself. */
    const week2 = await roundById(SURVEY_WEEK2_ID);
    expect(week2.title).toBe("Founder Sprint Survey: Week 2");
    expect(week2.groups.map((g) => [g.heading, g.lowLabel, g.highLabel])).toEqual([
      ["Please indicate to what extent each statement applies to you:", "does not apply at all", "applies completely"],
      ["How confident are you in successfully performing each of the following activities?", "no confidence", "complete confidence"],
    ]);
    expect(week2.groups.map((g) => g.items.map((i) => i.statement))).toEqual([
      [
        "I actively attack problems.",
        "Whenever something goes wrong, I search for a solution immediately.",
        "Whenever there is a chance to get actively involved, I take it.",
        "I take initiative immediately even when others don’t.",
        "I use opportunities quickly in order to attain my goals.",
        "Usually I do more than I am asked to do.",
        "I am particularly good at realizing ideas.",
      ],
      [
        "Identifying new business opportunities",
        "Creating new products",
        "Thinking creatively",
        "Commercializing an idea or new development",
      ],
    ]);
  });

  test("there is no name question, and the intro does not claim there is", async () => {
    const week2 = await roundById(SURVEY_WEEK2_ID);
    const all = week2.groups.flatMap((g) => [g.heading, ...g.items.map((i) => i.statement)]).join(" ");
    expect(all.toLowerCase()).not.toContain("name");
    expect(week2.intro).not.toContain("Your name is collected");
    expect(week2.intro).toContain("organizers can see them");
    expect(week2.intro).toContain("roman.mamzer@aalto.fi");
  });

  test("the window is 10:00–11:45 on the wall clock in Espoo, not UTC", () => {
    expect(Date.parse(SURVEY_WEEK2_OPENS_AT)).toBe(dueInstant("2026-09-15", "10:00"));
    expect(Date.parse(SURVEY_WEEK2_CLOSES_AT)).toBe(dueInstant("2026-09-15", "11:45"));
  });

  test("the seed runs once, so a deleted round does not come back", async () => {
    /*
     * A draft round nobody answered can be deleted. If the seed keyed on the
     * round being absent, the next boot would put it back. Simulated by
     * re-running schema init on the same database.
     */
    const id = await makeRound("Throwaway", -5, 30);
    const del = await post(h, "/api/survey", { action: "delete-round", id }, organizer.cookie);
    expect(del.status).toBe(200);

    const db = h.db();
    try {
      db.run("DELETE FROM survey_items WHERE group_id IN (SELECT id FROM survey_groups WHERE round_id = $id)", { $id: SURVEY_WEEK2_ID });
      db.run("DELETE FROM survey_groups WHERE round_id = $id", { $id: SURVEY_WEEK2_ID });
      db.run("DELETE FROM survey_rounds WHERE id = $id", { $id: SURVEY_WEEK2_ID });
      const { initSchema } = await import("../src/db/schema");
      initSchema(db);
      expect(db.query("SELECT 1 FROM survey_rounds WHERE id = $id").get({ $id: SURVEY_WEEK2_ID })).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe("taking a round", () => {
  test("a founder sees the open round, and nobody's answers", async () => {
    const id = await makeRound("Open now", -2, 60);
    const res = await get(h, "/api/survey", founder.cookie);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { round: { id: string; results?: unknown }; submitted: boolean };
    expect(data.round.id).toBe(id);
    expect(data.submitted).toBe(false);
    expect(JSON.stringify(data)).not.toContain("answers\":{");
    expect(data.round.results).toBeUndefined();
  });

  test("every statement must be answered, 1 to 5", async () => {
    const id = await makeRound("Validation", -2, 60);
    const round = await roundById(id);
    const answers = fullAnswers(round);
    const firstId = Object.keys(answers)[0]!;

    const missing = { ...answers };
    delete missing[firstId];
    expect((await post(h, "/api/survey", { action: "submit", roundId: id, answers: missing }, founder.cookie)).status).toBe(400);

    for (const bad of [0, 6, 2.5, "4"]) {
      const res = await post(h, "/api/survey", { action: "submit", roundId: id, answers: { ...answers, [firstId]: bad } }, founder.cookie);
      expect([String(bad), res.status]).toEqual([String(bad), 400]);
    }

    const extra = await post(h, "/api/survey", { action: "submit", roundId: id, answers: { ...answers, "not-a-question": 3 } }, founder.cookie);
    expect(extra.status).toBe(400);
  });

  test("it is taken once, and cannot be changed afterwards", async () => {
    const id = await makeRound("Once", -2, 60);
    const round = await roundById(id);
    expect((await post(h, "/api/survey", { action: "submit", roundId: id, answers: fullAnswers(round, 2) }, founder.cookie)).status).toBe(200);
    expect((await post(h, "/api/survey", { action: "submit", roundId: id, answers: fullAnswers(round, 5) }, founder.cookie)).status).toBe(409);

    const stored = (await roundById(id)).results.find((r) => r.email === founder.email)!;
    expect(Object.values(stored.answers).every((v) => v === 2)).toBe(true);
  });

  test("outside the window it is refused with the reason, before the answers are read", async () => {
    const later = await makeRound("Later", 120, 180);
    const early = await post(h, "/api/survey", { action: "submit", roundId: later, answers: {} }, founder.cookie);
    expect(early.status).toBe(423);
    expect(((await early.json()) as { error: string }).error).toContain("not opened");

    const past = await makeRound("Past", -180, -120);
    const closed = await post(h, "/api/survey", { action: "submit", roundId: past, answers: {} }, founder.cookie);
    expect(closed.status).toBe(423);
    expect(((await closed.json()) as { error: string }).error).toContain("closed");
  });

  test("staff do not take it", async () => {
    const id = await makeRound("Staff", -2, 60);
    for (const who of [organizer, mentor]) {
      const res = await post(h, "/api/survey", { action: "submit", roundId: id, answers: {} }, who.cookie);
      expect(res.status).toBe(403);
    }
  });
});

describe("reading the answers", () => {
  test("organizers see every founder, answered or not", async () => {
    const id = await makeRound("Table", -2, 60);
    const round = await roundById(id);
    await post(h, "/api/survey", { action: "submit", roundId: id, answers: fullAnswers(round, 3) }, other.cookie);

    const table = await roundById(id);
    expect(table.responses).toBe(1);
    const gus = table.results.find((r) => r.email === other.email)!;
    const frida = table.results.find((r) => r.email === founder.email)!;
    expect(gus.submittedAt).not.toBeNull();
    expect(Object.keys(gus.answers).length).toBe(3);
    expect(frida.submittedAt).toBeNull();
    // Staff are not in the table. It is the cohort's answers.
    expect(table.results.some((r) => r.email === organizer.email || r.email === mentor.email)).toBe(false);
  });

  test("mentors and founders cannot read them", async () => {
    expect((await get(h, "/api/survey", mentor.cookie)).status).toBe(403);
    const founderView = await (await get(h, "/api/survey", founder.cookie)).json();
    expect(founderView).not.toHaveProperty("rounds");
    expect((await get(h, "/api/survey")).status).toBe(401);
  });

  test("editing is organizers only", async () => {
    for (const who of [mentor, founder]) {
      const res = await post(h, "/api/survey", { action: "clone-round" }, who.cookie);
      expect(res.status).toBe(403);
    }
  });
});

describe("staff preview", () => {
  /*
   * An organizer opened a round and went to check it, and the Survey page told
   * them nothing was open. The organizer response carried only the admin data,
   * with no `round`, so the founder screen fell through to "No survey open
   * right now" for every staff account, whatever the window said.
   */
  test("an organizer loading the survey sees the open round, marked as staff", async () => {
    await makeRound("Preview", -1, 60);
    const data = (await (await get(h, "/api/survey", organizer.cookie)).json()) as {
      staff: boolean; openRoundId: string | null;
      round: { id: string; groups: unknown[]; results?: unknown } | null;
      rounds: unknown[];
    };
    expect(data.staff).toBe(true);
    expect(data.openRoundId).not.toBeNull();
    expect(data.round?.id).toBe(data.openRoundId!);
    expect(data.round!.groups.length).toBeGreaterThan(0);
    /* The preview is the founder shape: questions, never anybody's answers. */
    expect(data.round).not.toHaveProperty("results");
    /* And the admin data is still there for the admin tab. */
    expect(data.rounds.length).toBeGreaterThan(0);
  });

  test("a founder is not told they are staff", async () => {
    const data = await (await get(h, "/api/survey", founder.cookie)).json();
    expect(data).not.toHaveProperty("staff");
  });

  test("the preview has no Send, and the send path refuses staff too", () => {
    const src = readFileSync("src/components/Survey.tsx", "utf-8");
    expect(src).toContain("{!state.staff && (");
    expect(src).toContain("state.staff ||");
  });
});

describe("editing rounds", () => {
  test("questions lock once anybody has answered; the title and window do not", async () => {
    const id = await makeRound("Lockable", -2, 60);
    const round = await roundById(id);
    await post(h, "/api/survey", { action: "submit", roundId: id, answers: fullAnswers(round) }, founder.cookie);

    const o = helsinki(Date.now() - 2 * 60_000);
    const c = helsinki(Date.now() + 90 * 60_000);
    const base = { action: "save-round", id, intro: "Intro.", opensOn: o.on, opensTime: o.time, closesOn: c.on, closesTime: c.time };

    const reworded = GROUPS.map((g, i) => (i === 0 ? { ...g, items: ["First, reworded.", "Second."] } : g));
    const locked = await post(h, "/api/survey", { ...base, title: "Lockable", groups: reworded }, organizer.cookie);
    expect(locked.status).toBe(409);

    const renamed = await post(h, "/api/survey", { ...base, title: "Lockable, renamed", groups: GROUPS }, organizer.cookie);
    expect(renamed.status).toBe(200);
    const after = await roundById(id);
    expect(after.title).toBe("Lockable, renamed");
    /* The answers still point at the same questions. */
    expect(after.results.find((r) => r.email === founder.email)!.answers[after.groups[0]!.items[0]!.id]).toBe(4);
  });

  test("a round with answers cannot be deleted", async () => {
    const id = await makeRound("Keep", -2, 60);
    const round = await roundById(id);
    await post(h, "/api/survey", { action: "submit", roundId: id, answers: fullAnswers(round) }, founder.cookie);
    expect((await post(h, "/api/survey", { action: "delete-round", id }, organizer.cookie)).status).toBe(409);
  });

  test("a new round copies the last one's questions as a draft nobody can take yet", async () => {
    const source = await makeRound("Source", -2, 60);
    const res = await post(h, "/api/survey", { action: "clone-round" }, organizer.cookie);
    expect(res.status).toBe(200);
    const copy = await roundById(((await res.json()) as { id: string }).id);
    expect(copy.opensAt).toBeNull();
    expect(copy.closesAt).toBeNull();
    const original = await roundById(source);
    expect(copy.groups.map((g) => g.items.map((i) => i.statement))).toEqual(original.groups.map((g) => g.items.map((i) => i.statement)));
  });

  test("a window must close after it opens, and be all four fields or none", async () => {
    const half = await post(h, "/api/survey", {
      action: "save-round", title: "Half", opensOn: "2026-10-01", opensTime: "10:00", groups: GROUPS,
    }, organizer.cookie);
    expect(half.status).toBe(400);
    const backwards = await post(h, "/api/survey", {
      action: "save-round", title: "Backwards",
      opensOn: "2026-10-01", opensTime: "11:00", closesOn: "2026-10-01", closesTime: "10:00", groups: GROUPS,
    }, organizer.cookie);
    expect(backwards.status).toBe(400);
  });
});

describe("erasure", () => {
  test("removing an account removes its answers, and leaves the round", async () => {
    const id = await makeRound("Erasure", -2, 60);
    const leaver = await createFounder(h, organizer, "leaver@example.test", "Leaver", "leaver-password-1");
    const round = await roundById(id);
    await post(h, "/api/survey", { action: "submit", roundId: id, answers: fullAnswers(round) }, leaver.cookie);

    await post(h, "/api/admin/users", { action: "remove", email: leaver.email }, organizer.cookie);

    const db = h.db();
    try {
      expect(db.query("SELECT COUNT(*) AS n FROM survey_answers WHERE user_email = $e").get({ $e: leaver.email })).toEqual({ n: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM survey_submissions WHERE user_email = $e").get({ $e: leaver.email })).toEqual({ n: 0 });
    } finally {
      db.close();
    }
    expect(await roundById(id)).toBeDefined();
  });
});
