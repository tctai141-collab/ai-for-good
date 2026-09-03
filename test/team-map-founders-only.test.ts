import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createFounder, createOrganizer, get, post, startServer,
  type Harness, type Session,
} from "./helpers/harness";
import { WORKING_GENIUS_ITEMS } from "../src/lib/workingGenius";

/**
 * The team map lists the cohort, and the cohort is founders.
 *
 * Reported as an account that would not delete: a name kept appearing in the
 * team map after the profile was removed. It was never the deleted account.
 * The join behind that table had no role in it, so anyone who took the
 * working-style assessment and agreed to share appeared there — and the
 * organizer looking at the screen was seeing their own row, in a table headed
 * "Founder" that says it shows "where each founder's energy goes".
 *
 * The count underneath was wrong in the same way, and worse for being
 * plausible: mapWithheld is founders.length - map.length, so one organizer in
 * the map cancelled out one founder who had shared nothing. Measured on a
 * cohort of one founder who had shared nothing and one organizer who had:
 * the map named the organizer and the page said nobody was missing.
 */

let h: Harness;
let organizer: Session;
let founder: Session;
let mentor: Session;

const answers = () => {
  const a: Record<string, string> = {};
  for (const item of WORKING_GENIUS_ITEMS) {
    const first = item.options[0];
    if (first) a[item.id] = first.id;
  }
  return a;
};

/** Take the assessment and agree to share it, as that person. */
async function shareProfile(who: Session) {
  const res = await post(
    h,
    "/api/persistence",
    { action: "save-working-genius", userEmail: who.email, workingGeniusResponses: answers(), workingGeniusShareConsent: true },
    who.cookie,
  );
  if (!res.ok) throw new Error(`sharing for ${who.email} failed: ${await res.text()}`);
}

type Cohort = {
  teams: { name: string }[];
  map: { name: string; email: string }[];
  mapWithheld: number;
  cohortSize: number;
};

const cohort = async () => (await (await get(h, "/api/cohort", organizer.cookie)).json()) as Cohort;

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "olivia@example.test", "Olivia Organizer");
  founder = await createFounder(h, organizer, "frida@example.test", "Frida Founder", "frida-password-11");
  /* No createMentor helper: a mentor is an organizer row with the other role. */
  mentor = await createOrganizer(h, "mikko@example.test", "Mikko Mentor", "mikko-password-11", "mentor");
});

afterAll(() => h?.stop());

describe("who appears on it", () => {
  test("an organizer who took the assessment is not in the cohort's map", async () => {
    /*
     * This is the reported bug in one assertion. The organizer is a real
     * person who did a real exercise and agreed to share it — nothing about
     * their consent is in question. They are simply not in the cohort, and
     * this table is the cohort's.
     */
    await shareProfile(organizer);
    const data = await cohort();
    expect(data.map.map((m) => m.email)).not.toContain(organizer.email);
  });

  test("nor is a mentor", async () => {
    await shareProfile(mentor);
    const data = await cohort();
    expect(data.map.map((m) => m.email)).not.toContain(mentor.email);
  });

  test("a founder who shared is still on it", async () => {
    // The filter has to exclude the right people and no more than that.
    await shareProfile(founder);
    const data = await cohort();
    expect(data.map.map((m) => m.email)).toContain(founder.email);
  });

  test("the map never names somebody the heatmap does not", async () => {
    /*
     * The two halves of this screen used to disagree: the heatmap came from
     * listFounders and the map came from a join with no role in it, so the
     * same page showed one population above and a different one below.
     */
    const data = await cohort();
    const inHeatmap = new Set(data.teams.map((t) => t.name));
    for (const row of data.map) expect(`${row.name} in heatmap`).toBe(`${row.name} in heatmap`.replace(/$/, inHeatmap.has(row.name) ? "" : " — MISSING"));
  });
});

describe("the count of who has not shared", () => {
  test("it counts founders against founders", async () => {
    /*
     * With one founder who has shared and two non-founders who also have, the
     * old arithmetic returned 1 - 3 = -2. The page renders this straight into
     * "N founders have not shared".
     */
    const data = await cohort();
    expect(data.mapWithheld).toBe(data.cohortSize - data.map.length);
    expect(data.mapWithheld).toBeGreaterThanOrEqual(0);
  });

  test("a founder who has not shared is counted as missing", async () => {
    const quiet = await createFounder(h, organizer, "quiet@example.test", "Quiet Founder", "quiet-password-11");
    const data = await cohort();
    expect(data.map.map((m) => m.email)).not.toContain(quiet.email);
    /* The bug made this the number that lied: an organizer in the map cancelled
       out a founder missing from it, and the page said everyone had shared. */
    expect(data.mapWithheld).toBeGreaterThan(0);
  });

  test("it can never print as a negative number", async () => {
    const data = await cohort();
    expect(data.mapWithheld).toBeGreaterThanOrEqual(0);
  });
});
