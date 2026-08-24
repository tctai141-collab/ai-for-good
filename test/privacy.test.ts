import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { get, post, startServer, twoFounders, type Harness, type Session } from "./helpers/harness";

/**
 * The privacy boundary — the promise the whole product rests on.
 *
 *   Founders' raw conversations are private. The operating team sees themes,
 *   attention signals and decisions — never the transcript — unless the founder
 *   explicitly shares a specific conversation.
 *
 * The audit found this held for threads and check-ins but not for decisions,
 * where the stored "summary" is the founder's own first nine words, verbatim,
 * and was returned to any organizer with no opt-in.
 */

let h: Harness;
let organizer: Session;
let alice: Session;
let bob: Session;

/** A sentence no organizer should ever see without Alice choosing to share it. */
const PRIVATE_SENTENCE = "Should I fire my cofounder Mikko before the Kiilto demo";

beforeAll(async () => {
  h = await startServer();
  const users = await twoFounders(h);
  organizer = users.organizer;
  alice = users.alice;
  bob = users.bob;

  await post(h, "/api/persistence", {
    action: "save-thread",
    userEmail: alice.email,
    thread: {
      id: "t-private",
      title: "Private thread",
      theme: "cofounder",
      state: "panic",
      lastAt: "now",
      personality: "none",
      messages: [{ role: "user", content: PRIVATE_SENTENCE }],
    },
  }, alice.cookie);

  await post(h, "/api/persistence", {
    action: "save-thread",
    userEmail: alice.email,
    thread: {
      id: "t-shared",
      title: "Shared thread",
      theme: "runway",
      state: "thinking",
      lastAt: "now",
      personality: "none",
      messages: [{ role: "user", content: "This one I chose to share" }],
    },
  }, alice.cookie);

  await post(h, "/api/persistence", {
    action: "set-thread-shared",
    userEmail: alice.email,
    threadId: "t-shared",
    shared: true,
  }, alice.cookie);

  // detectDecision() in the client stores the founder's own first nine words.
  await post(h, "/api/persistence", {
    action: "save-decision",
    userEmail: alice.email,
    decision: {
      id: "d-private",
      summary: PRIVATE_SENTENCE,
      door: "one-way",
      theme: "cofounder",
      status: "open",
      outcome: "Decided to wait until after the demo",
    },
  }, alice.cookie);

  await post(h, "/api/persistence", {
    action: "save-checkin",
    userEmail: alice.email,
    checkin: { id: "c-private", theme: "checkin", prompt: PRIVATE_SENTENCE, mood: 80 },
  }, alice.cookie);
});

afterAll(() => h?.stop());

describe("privacy boundary — organizer", () => {
  test("gets only threads the founder chose to share", async () => {
    const res = await get(h, `/api/persistence?resource=threads&user=${alice.email}`, organizer.cookie);
    expect(res.status).toBe(200);
    const { threads, redacted } = await res.json();
    expect(redacted).toBe(true);
    expect(threads).toHaveLength(1);
    expect(threads[0].id).toBe("t-shared");
    expect(JSON.stringify(threads)).not.toContain(PRIVATE_SENTENCE);
  });

  test("gets check-in signals but not the founder's words", async () => {
    const res = await get(h, `/api/persistence?resource=checkins&user=${alice.email}`, organizer.cookie);
    const { checkins, redacted } = await res.json();
    expect(redacted).toBe(true);
    expect(checkins[0].mood).toBe(80);
    expect(checkins[0].theme).toBe("checkin");
    expect(checkins[0].prompt).toBeNull();
    expect(JSON.stringify(checkins)).not.toContain(PRIVATE_SENTENCE);
  });

  // C-2: this is the one that was broken.
  test("gets decision shape but no founder free text", async () => {
    const res = await get(h, `/api/persistence?resource=decisions&user=${alice.email}`, organizer.cookie);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(JSON.stringify(body)).not.toContain(PRIVATE_SENTENCE);
    expect(JSON.stringify(body)).not.toContain("Decided to wait");

    // The organizer still gets what the dashboard legitimately needs.
    const decision = body.decisions[0];
    expect(decision.door).toBe("one-way");
    expect(decision.status).toBe("open");
    expect(decision.theme).toBe("cofounder");
    expect(decision.summary).toBeNull();
    expect(decision.outcome).toBeNull();
    expect(body.redacted).toBe(true);
  });

  test("cannot see how often a founder opened the app", async () => {
    /*
     * The visit count was the one read with no owner check, so an organizer
     * could ask how engaged any founder was. No organizer surface shows that
     * and none is meant to: the cohort dashboard reports strain deliberately,
     * not attendance, and a number that reads as "who is slacking" is exactly
     * the use the privacy model exists to prevent.
     */
    const res = await get(h, `/api/persistence?resource=visits&user=${alice.email}`, organizer.cookie);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("visits\":");
  });

  test("cannot chat inside a founder's account", async () => {
    const res = await post(h, "/api/chat", {
      messages: [{ role: "user", content: "hi" }],
      userEmail: alice.email,
    }, organizer.cookie);
    expect(res.status).toBe(403);
  });
});

describe("privacy boundary — owner keeps full access", () => {
  test("alice still sees her own decisions in full", async () => {
    const res = await get(h, `/api/persistence?resource=decisions&user=${alice.email}`, alice.cookie);
    const body = await res.json();
    expect(body.decisions[0].summary).toBe(PRIVATE_SENTENCE);
    expect(body.decisions[0].outcome).toBe("Decided to wait until after the demo");
    expect(body.redacted).toBeFalsy();
  });

  test("alice still sees all her own threads", async () => {
    const res = await get(h, `/api/persistence?resource=threads&user=${alice.email}`, alice.cookie);
    const { threads, redacted } = await res.json();
    expect(threads).toHaveLength(2);
    expect(redacted).toBe(false);
  });
});

describe("privacy boundary — other founders", () => {
  test("bob gets nothing from alice, shared or not", async () => {
    for (const resource of ["threads", "checkins", "decisions", "working-genius", "visits"]) {
      const res = await get(h, `/api/persistence?resource=${resource}&user=${alice.email}`, bob.cookie);
      expect(res.status).toBe(403);
    }
  });

  test("bob cannot read the cohort dashboard", async () => {
    const res = await get(h, "/api/cohort", bob.cookie);
    expect(res.status).toBe(403);
  });

  test("an anonymous caller gets nothing", async () => {
    expect((await get(h, `/api/persistence?resource=threads&user=${alice.email}`)).status).toBe(401);
    expect((await get(h, "/api/cohort")).status).toBe(401);
    expect((await get(h, "/api/admin/users")).status).toBe(401);
  });
});

describe("cohort dashboard carries no free text", () => {
  test("organizer cohort payload contains no founder prose", async () => {
    const res = await get(h, "/api/cohort", organizer.cookie);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain(PRIVATE_SENTENCE);
    expect(body).not.toContain("Decided to wait");
  });
});
