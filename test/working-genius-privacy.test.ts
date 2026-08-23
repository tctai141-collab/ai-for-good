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
 * The working-style profile is the founder's and nobody else's.
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
    { action: "save-working-genius", userEmail: alice.email, workingGeniusResponses: completeAnswers() },
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

  test("an organizer cannot read a founder's, and gets no fragment of it", async () => {
    const res = await read(organizer, alice.email);
    expect(res.status).toBe(403);
    // Not merely absent from a parsed field: the answers must not be anywhere
    // in the response at all.
    const body = await res.text();
    expect(body).not.toContain("result_json");
    expect(body).not.toContain("genius");
    expect(body).not.toContain("invention");
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
      { action: "save-working-genius", userEmail: alice.email, workingGeniusResponses: completeAnswers() },
      organizer.cookie,
    );
    expect(res.status).toBe(403);
  });

  test("a founder cannot write one into another founder's row", async () => {
    const res = await post(
      h,
      "/api/persistence",
      { action: "save-working-genius", userEmail: alice.email, workingGeniusResponses: completeAnswers() },
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
