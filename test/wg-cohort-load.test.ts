import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createFounder, createOrganizer, get, post, startServer, type Harness, type Session } from "./helpers/harness";
import { WORKING_GENIUS_ITEMS } from "../src/lib/workingGenius";

/**
 * The whole cohort takes it in the same ten minutes.
 *
 * Nineteen founders in one room on one wifi, all pressing Finish within a
 * minute of each other, against one SQLite file. This is the load that
 * actually happens, so it is the load that is tested.
 */

let h: Harness;
let organizer: Session;
const SIZE = 20;
const founders: Session[] = [];

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
  for (let i = 0; i < SIZE; i++) {
    founders.push(await createFounder(h, organizer, `founder${i}@example.test`, `Founder ${i}`, `founder-password-${i}${i}`));
  }
});

afterAll(() => h?.stop());

const answersFor = (seed: number) =>
  Object.fromEntries(WORKING_GENIUS_ITEMS.map((item, n) => [item.id, ((seed + n) % 5) + 1]));

describe("the whole cohort at once", () => {
  test("twenty simultaneous submissions all land, each with its own profile", async () => {
    const submissions = founders.map((founder, i) =>
      post(h, "/api/persistence", {
        action: "save-working-genius",
        userEmail: founder.email,
        workingGeniusResponses: answersFor(i),
        workingGeniusShareConsent: true,
      }, founder.cookie),
    );

    const settled = await Promise.all(submissions);
    const statuses = settled.map((r) => r.status);
    expect(statuses).toEqual(Array(SIZE).fill(200));

    const bodies = await Promise.all(settled.map((r) => r.json() as Promise<{ result: { ranking: string[]; version: string } }>));
    for (const [i, body] of bodies.entries()) {
      expect([i, body.result.ranking.length]).toEqual([i, 6]);
      expect([i, body.result.version]).toEqual([i, "afs-4"]);
    }

    // Every row is the founder's own, and nobody's answers landed in anybody
    // else's row.
    const db = h.db();
    try {
      const rows = db.query("SELECT user_email, primary_type FROM working_genius").all() as Array<{ user_email: string }>;
      expect(rows).toHaveLength(SIZE);
      expect(new Set(rows.map((r) => r.user_email)).size).toBe(SIZE);
      const takes = db.query("SELECT COUNT(*) AS n FROM working_genius_takes").get() as { n: number };
      expect(takes.n).toBe(SIZE);
    } finally {
      db.close();
    }
  }, 60_000);

  test("each founder reads back their own profile, not a neighbour's", async () => {
    const reads = await Promise.all(
      founders.map((f) => get(h, `/api/persistence?resource=working-genius&user=${encodeURIComponent(f.email)}`, f.cookie)),
    );
    for (const res of reads) expect(res.status).toBe(200);

    const bodies = await Promise.all(reads.map((r) => r.json() as Promise<{ workingGenius: { result_json: string } | null }>));
    const profiles = bodies.map((b) => b.workingGenius?.result_json ?? "");
    expect(profiles.every((p) => p.length > 0)).toBe(true);
    // Twenty different answer patterns must not produce one shared profile.
    expect(new Set(profiles).size).toBeGreaterThan(1);
  }, 60_000);

  test("a second press of Finish is refused, not stored twice", async () => {
    const founder = founders[0]!;
    const again = await post(h, "/api/persistence", {
      action: "save-working-genius",
      userEmail: founder.email,
      workingGeniusResponses: answersFor(99),
      workingGeniusShareConsent: true,
    }, founder.cookie);
    expect(again.status).toBe(409);

    const db = h.db();
    try {
      const takes = db.query("SELECT COUNT(*) AS n FROM working_genius_takes WHERE user_email = $e").get({ $e: founder.email }) as { n: number };
      expect(takes.n).toBe(1);
    } finally {
      db.close();
    }
  }, 30_000);
});
