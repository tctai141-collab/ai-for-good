import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { TOTAL_WEEKS } from "../src/lib/sprint-calendar";
import {
  RETAKE_WINDOWS,
  WORKING_GENIUS_ITEMS,
  daysUntil,
  nextRetakeDate,
  retakeOpen,
} from "../src/lib/workingGenius";
import {
  createFounder,
  createOrganizer,
  get,
  post,
  startServer,
  type Harness,
  type Session,
} from "./helpers/harness";

/**
 * Retakes are pinned to three dates the cohort shares.
 *
 * The instrument measures where energy goes, which does not move week to week.
 * A founder who could retake it the morning after a bad session would be
 * measuring the session, and the profile would degrade into a mood ring. Three
 * fixed points across the sprint is enough to see movement and few enough that
 * each is worth sitting down for.
 *
 * The other half of the change is that takes are kept. Overwriting on retake
 * would delete the only thing the extra takes are for.
 */

describe("the schedule", () => {
  test("three windows, in order, inside the sprint", () => {
    expect([...RETAKE_WINDOWS]).toEqual(["2026-10-08", "2026-11-08", "2026-12-01"]);
    expect([...RETAKE_WINDOWS]).toEqual([...RETAKE_WINDOWS].sort());
  });

  test("the first take is open to anyone who has not taken it", () => {
    expect(retakeOpen(null, "2026-09-09")).toBe(true);
    expect(nextRetakeDate(null)).toBeNull();
  });

  test("a take in September points at October and locks until then", () => {
    expect(nextRetakeDate("2026-09-15")).toBe("2026-10-08");
    expect(retakeOpen("2026-09-15", "2026-10-07")).toBe(false);
    expect(retakeOpen("2026-09-15", "2026-10-08")).toBe(true);
    expect(retakeOpen("2026-09-15", "2026-11-20")).toBe(true);
  });

  test("each window points at the next", () => {
    expect(nextRetakeDate("2026-10-08")).toBe("2026-11-08");
    expect(nextRetakeDate("2026-11-08")).toBe("2026-12-01");
  });

  test("after the December take there are no more", () => {
    expect(nextRetakeDate("2026-12-01")).toBeNull();
    expect(retakeOpen("2026-12-01", "2026-12-20")).toBe(false);
  });

  test("a late joiner skips the windows that opened before they arrived", () => {
    /*
     * Somebody whose first take is on 20 October has already passed the
     * October window. Keying off the last take rather than off a count is what
     * makes this come out right without a special case.
     */
    expect(nextRetakeDate("2026-10-20")).toBe("2026-11-08");
    expect(retakeOpen("2026-10-20", "2026-10-21")).toBe(false);
  });

  test("a row from the six-item quiz does not lock anybody out", () => {
    /*
     * The quiz this replaced wrote completed_at with toLocaleDateString, so
     * those rows hold "Aug 23, 2026". The windows are compared as strings,
     * which is exact for ISO and nonsense for that, and "2026-10-08" is not
     * greater than "Aug 23, 2026". Every window therefore looked past and the
     * founder was locked out of the real instrument permanently, while the card
     * cheerfully invited them to "Retake it properly".
     */
    expect(retakeOpen("Aug 23, 2026", "2026-08-24")).toBe(true);
    expect(retakeOpen("23/08/2026", "2026-08-24")).toBe(true);
    expect(retakeOpen("", "2026-08-24")).toBe(true);
    expect(nextRetakeDate("Aug 23, 2026")).toBeNull();
  });

  test("the windows belong to the sprint this build is configured for", () => {
    /*
     * These dates are F26's. A cohort that inherits the code without changing
     * them gets one take each and then "Last one taken" for the rest of the
     * sprint, silently, because every window sits in the past. Failing here is
     * the cheapest place to find that out.
     */
    const start = process.env.SPRINT_START_DATE;
    if (!start) return;
    const startMs = Date.parse(start);
    const endMs = startMs + TOTAL_WEEKS * 7 * 24 * 60 * 60 * 1000;
    for (const window of RETAKE_WINDOWS) {
      const at = Date.parse(`${window}T00:00:00Z`);
      expect([window, at > startMs && at < endMs]).toEqual([window, true]);
    }
  });

  test("the countdown counts days and never goes negative", () => {
    expect(daysUntil("2026-10-08", "2026-10-01")).toBe(7);
    expect(daysUntil("2026-10-08", "2026-10-08")).toBe(0);
    expect(daysUntil("2026-10-08", "2026-10-20")).toBe(0);
  });
});

describe("the lock is enforced on the server", () => {
  let h: Harness;
  let organizer: Session;
  let founder: Session;

  const answers = () => {
    const a: Record<string, string> = {};
    for (const item of WORKING_GENIUS_ITEMS) {
      const first = item.options[0];
      if (first) a[item.id] = first.id;
    }
    return a;
  };

  const take = () =>
    post(
      h,
      "/api/persistence",
      { action: "save-working-genius", userEmail: founder.email, workingGeniusResponses: answers() },
      founder.cookie,
    );

  beforeAll(async () => {
    h = await startServer();
    organizer = await createOrganizer(h, "organizer@example.test");
    founder = await createFounder(h, organizer, "aino@example.test", "Aino", "aino-password-11");
  });

  afterAll(() => h?.stop());

  test("the first take is accepted", async () => {
    expect((await take()).status).toBe(200);
  });

  test("an immediate retake is refused, and says when it opens", async () => {
    /*
     * A disabled button is a suggestion. This is the rule, and it also covers
     * the tab left open from before a window closed.
     */
    const res = await take();
    expect(res.status).toBe(409);
    const data = (await res.json()) as { error: string };
    expect(data.error).toMatch(/opens again on \d{4}-\d{2}-\d{2}|last time for this sprint/);
  });

  test("the refused retake did not overwrite anything", async () => {
    const db = h.db();
    try {
      const rows = db
        .query("SELECT COUNT(*) AS n FROM working_genius_takes WHERE user_email = $e")
        .get({ $e: founder.email }) as { n: number };
      expect(rows.n).toBe(1);
    } finally {
      db.close();
    }
  });

  test("the take is kept as history, not only as a snapshot", async () => {
    const res = await get(
      h,
      `/api/persistence?resource=working-genius&user=${encodeURIComponent(founder.email)}`,
      founder.cookie,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      workingGenius: { result_json: string } | null;
      takes: Array<{ taken_on: string; result_json: string }>;
    };

    expect(data.workingGenius).not.toBeNull();
    expect(data.takes).toHaveLength(1);
    expect(JSON.parse(data.takes[0]!.result_json).ranking).toHaveLength(6);
  });

  test("history is founder-only, like everything else about this", async () => {
    const res = await get(
      h,
      `/api/persistence?resource=working-genius&user=${encodeURIComponent(founder.email)}`,
      organizer.cookie,
    );
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("taken_on");
  });
});
