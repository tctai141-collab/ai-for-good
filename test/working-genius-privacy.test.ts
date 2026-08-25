import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createFounder,
  createOrganizer,
  get,
  post,
  startServer,
  type Harness,
  type Session,
} from "./helpers/harness";
import { WORKING_GENIUS_ITEMS } from "../src/lib/workingGenius";

/**
 * What is shared about a working-style profile, and what is not.
 *
 * This file used to be called "the profile is the founder's and nobody else's",
 * and it enforced exactly that. The product decision changed: the profile is
 * shared with the operating team, by consent taken on a card before any
 * question is answered, and the server refuses to save a submission that does
 * not carry that agreement.
 *
 * The line that did not move is the one that matters most here. What is
 * offered on that card is the ranking and the bands. The individual answers
 * and the free text are not, and there is no organizer route to them at all —
 * not a redacted one, not an aggregate. Several tests below check the response
 * *text* rather than a parsed field, because the property is that those things
 * are nowhere in it.
 *
 * The card in the app says so before they start and again on the result, and
 * this file is what makes the sentence true. It is here because the promise was
 * printed before it held: the `working-genius` read sat under
 * requireSelfOrOrganizer with no owner check, so any organizer could fetch any
 * founder's bands, full ranking and `result_json`, which carries all thirty
 * individual answers.
 *
 * That is a worse leak than it first sounds. A founder can choose to share a
 * conversation; nobody chooses to hand over a personality profile, and an
 * organizer reading one across the cohort is precisely the use the card
 * promises will not happen.
 *
 * Deliberately no redacted organizer shape is tested, because there is not one.
 * Threads and decisions have a reduced view for organizers since that is work a
 * founder may hand over. This is not work.
 */

let h: Harness;
let organizer: Session;
let alice: Session;
let bob: Session;

/** A complete, valid set of answers: always pick whichever option comes first. */
function completeAnswers(): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const item of WORKING_GENIUS_ITEMS) {
    const first = item.options[0];
    if (first) answers[item.id] = first.id;
  }
  return answers;
}

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test", "Olivia Organizer");
  alice = await createFounder(h, organizer, "alice@example.test", "Alice Andersson", "alice-password-11");
  bob = await createFounder(h, organizer, "bob@example.test", "Bob Berg", "bob-password-1122");

  const saved = await post(
    h,
    "/api/persistence",
    { action: "save-working-genius", userEmail: alice.email, workingGeniusResponses: completeAnswers(), workingGeniusShareConsent: true },
    alice.cookie,
  );
  if (!saved.ok) throw new Error(`seeding Alice's profile failed: ${await saved.text()}`);
});

afterAll(() => h?.stop());

const read = (who: Session | null, subject: string) =>
  get(h, `/api/persistence?resource=working-genius&user=${encodeURIComponent(subject)}`, who?.cookie);

describe("reading a working-style profile", () => {
  test("the founder can read their own", async () => {
    const res = await read(alice, alice.email);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { workingGenius: { user_email: string; result_json: string } | null };
    expect(data.workingGenius).not.toBeNull();
    expect(data.workingGenius!.user_email).toBe(alice.email);
  });

  test("an organizer reads the profile a founder agreed to share, and nothing under it", async () => {
    /*
     * This test used to require a 403. The rule changed deliberately: a
     * founder now agrees, before they answer anything, that the operating team
     * may see their profile — and the server refuses to save a submission that
     * does not carry that agreement.
     *
     * What did not change is the line underneath. The consent card offers the
     * ranking and the bands and says in as many words that the individual
     * answers and the free text are not shared. So the shape an organizer gets
     * has no result_json in it — the column that holds all thirty answers and
     * whatever the founder typed when they said "neither, or it depends",
     * which is where people write about a cofounder they have not spoken to.
     *
     * Checked against the response text, not a parsed field: the point is that
     * it is not anywhere in the body.
     */
    const res = await read(organizer, alice.email);
    expect(res.status).toBe(200);

    const body = await res.text();
    const parsed = JSON.parse(body) as {
      workingGenius: { primary_type?: string; counts_json?: string; result_json?: string } | null;
      takes: unknown[];
      shared: boolean;
    };

    expect(parsed.shared).toBe(true);
    expect(parsed.workingGenius?.primary_type).toBeTruthy();
    expect(parsed.workingGenius?.counts_json).toBeTruthy();

    expect(parsed.workingGenius).not.toHaveProperty("result_json");
    expect(body).not.toContain("result_json");
    // Fields that only ever appear inside the scored result.
    expect(body).not.toContain("abstentions");
    expect(body).not.toContain("overrides");
    // And no history: four profiles over a sprint is not a profile.
    expect(parsed.takes).toEqual([]);
  });

  test("an organizer gets nothing for a founder who has not taken it", async () => {
    const res = await read(organizer, bob.email);
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as { workingGenius: unknown; shared: boolean };
    expect(parsed.shared).toBe(false);
    expect(parsed.workingGenius).toBeNull();
  });

  test("another founder cannot read it either", async () => {
    const res = await read(bob, alice.email);
    expect(res.status).toBe(403);
  });

  test("a signed-out caller cannot read it", async () => {
    const res = await read(null, alice.email);
    expect(res.status).toBe(401);
  });
});

describe("writing a working-style profile", () => {
  test("an organizer cannot write one on a founder's behalf", async () => {
    const res = await post(
      h,
      "/api/persistence",
      { action: "save-working-genius", userEmail: alice.email, workingGeniusResponses: completeAnswers(), workingGeniusShareConsent: true },
      organizer.cookie,
    );
    expect(res.status).toBe(403);
  });

  test("a founder cannot write one into another founder's row", async () => {
    const res = await post(
      h,
      "/api/persistence",
      { action: "save-working-genius", userEmail: alice.email, workingGeniusResponses: completeAnswers(), workingGeniusShareConsent: true },
      bob.cookie,
    );
    expect(res.status).toBe(403);

    // And Alice's row is untouched by the attempt.
    const db = h.db();
    try {
      const rows = db
        .query("SELECT COUNT(*) AS n FROM working_genius WHERE user_email = $email")
        .get({ $email: alice.email }) as { n: number };
      expect(rows.n).toBe(1);
    } finally {
      db.close();
    }
  });

  test("the row is scored server-side, so the client cannot dictate a result", async () => {
    /*
     * The client posts raw answers and nothing else. An older shape accepted a
     * finished result, which let a stale tab write a profile scored by rules
     * that no longer existed.
     */
    const db = h.db();
    try {
      const row = db
        .query("SELECT result_json, instrument_version, consistency FROM working_genius WHERE user_email = $email")
        .get({ $email: alice.email }) as {
          result_json: string | null;
          instrument_version: string | null;
          consistency: number | null;
        };
      expect(row.result_json).not.toBeNull();
      expect(row.instrument_version).not.toBeNull();
      const parsed = JSON.parse(row.result_json!) as { ranking: string[]; bands: Record<string, string[]> };
      expect(parsed.ranking).toHaveLength(6);
      expect(parsed.bands.genius).toHaveLength(2);
    } finally {
      db.close();
    }
  });
});

describe("the printable report", () => {
  /*
   * /report is a new surface carrying the same private result, so it gets the
   * same scrutiny as the API read that this file exists because of.
   *
   * The structural defence is that the route takes no parameter naming a
   * founder: the row comes from the session. `take` names a date, and only a
   * date in the caller's own history. These tests hold that shape, because the
   * obvious "improvement" later is to add ?user= for an organizer view, and
   * that is exactly the leak this file was written after.
   */
  const report = (who: Session | null, query = "") =>
    get(h, `/report${query}`, who?.cookie);

  test("a signed-out visitor is sent away, not shown a document", async () => {
    const res = await report(null);
    // Astro's redirect, or the login page. Either way, not the report.
    expect([302, 303, 307, 200]).toContain(res.status);
    const body = res.status === 200 ? await res.text() : "";
    expect(body).not.toContain("Where your energy goes");
  });

  test("the founder gets their own report", async () => {
    const res = await report(alice);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Where your energy goes");
    expect(body).toContain("Alice Andersson");
  });

  test("an organizer cannot reach a founder's report by any parameter", async () => {
    /*
     * The whole point. Every shape somebody might reach for if they wanted an
     * organizer view, tried explicitly.
     */
    for (const query of [
      "?user=alice@example.test",
      "?userEmail=alice@example.test",
      "?email=alice@example.test",
      "?founder=alice@example.test",
      `?take=${encodeURIComponent("2026-09-10")}&user=alice@example.test`,
    ]) {
      const res = await report(organizer, query);
      const body = res.status === 200 ? await res.text() : "";
      expect([query, body.includes("Alice Andersson")]).toEqual([query, false]);
      expect([query, body.includes("alice@example.test")]).toEqual([query, false]);
    }
  });

  test("another founder cannot reach it either", async () => {
    const res = await report(bob, "?user=alice@example.test");
    const body = res.status === 200 ? await res.text() : "";
    expect(body).not.toContain("Alice Andersson");
    // Bob has taken nothing, so he gets the empty state rather than anyone's data.
    expect(body).toContain("Nothing to print yet");
  });

  test("a take date that is not the caller's own falls back to their own", async () => {
    // An edited URL is not worth a stack trace, and must not be worth anyone
    // else's result either.
    const res = await report(alice, "?take=1999-01-01");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Alice Andersson");
    expect(body).not.toContain("1999-01-01");
  });

  test("the founder's email is never in the document", async () => {
    // A name on a page somebody prints and leaves on a desk is one thing. An
    // address is another.
    const res = await report(alice);
    const body = await res.text();
    const inBody = body.slice(body.indexOf("<body"));
    expect(inBody).not.toContain("alice@example.test");
  });

  test("nothing about the report is written to disk", async () => {
    /*
     * The reason this is a print route rather than a server-side PDF. A stored
     * document would be a second copy of a private result living outside every
     * guarantee this file makes.
     */
    const before = h.db().query("SELECT COUNT(*) AS n FROM working_genius").get() as { n: number };
    await report(alice);
    await report(alice, "?take=2026-09-10");
    const after = h.db().query("SELECT COUNT(*) AS n FROM working_genius").get() as { n: number };
    expect(after.n).toBe(before.n);

    const tables = h.db()
      .query("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name).filter((n) => /report|pdf/i.test(n))).toEqual([]);
  });
});

describe("no other surface exposes it", () => {
  test("an organizer's view of a founder carries no working-genius data", async () => {
    /*
     * Guards the shape of the leak rather than one route: if a future endpoint
     * starts returning the profile inside a larger payload, the promise breaks
     * again without this case failing on the route itself.
     */
    for (const resource of ["threads", "checkins", "decisions", "visits"]) {
      const res = await get(
        h,
        `/api/persistence?resource=${resource}&user=${encodeURIComponent(alice.email)}`,
        organizer.cookie,
      );
      if (!res.ok) continue;
      const body = await res.text();
      expect(body).not.toContain("result_json");
      expect(body).not.toContain("instrument_version");
    }
  });

  test("deleting the founder takes the take history too", async () => {
    /*
     * The history table cascades from users, so this passed before it was
     * listed in deleteUser. Asserted anyway: erasure is the wrong place to
     * depend on a constraint staying the way it is, and a future rebuild of
     * that table would drop the cascade without anything failing.
     */
    const db = h.db();
    try {
      const before = db
        .query("SELECT COUNT(*) AS n FROM working_genius_takes WHERE user_email = $e")
        .get({ $e: alice.email }) as { n: number };
      expect(before.n).toBeGreaterThan(0);
    } finally {
      db.close();
    }

    const gone = await post(h, "/api/admin/users", { action: "remove", email: alice.email }, organizer.cookie);
    expect(gone.ok).toBe(true);

    const db2 = h.db();
    try {
      const after = db2
        .query("SELECT COUNT(*) AS n FROM working_genius_takes WHERE user_email = $e")
        .get({ $e: alice.email }) as { n: number };
      expect(after.n).toBe(0);
    } finally {
      db2.close();
    }
  });

  test("deleting the founder takes the profile with them", async () => {
    const gone = await post(
      h,
      "/api/admin/users",
      { action: "remove", email: bob.email },
      organizer.cookie,
    );
    expect(gone.ok).toBe(true);

    const db = h.db();
    try {
      const left = db
        .query("SELECT COUNT(*) AS n FROM working_genius WHERE user_email = $email")
        .get({ $email: bob.email }) as { n: number };
      expect(left.n).toBe(0);
    } finally {
      db.close();
    }
  });
});
