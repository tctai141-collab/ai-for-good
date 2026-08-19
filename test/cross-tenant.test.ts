import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { get, post, startServer, twoFounders, type Harness, type Session } from "./helpers/harness";

/**
 * C-1 — the cornerstone.
 *
 * "A second founder's session cannot read, write, or delete the first
 * founder's rows."
 *
 * The audit found four endpoints where this was false. Every one of them
 * authenticated correctly and then acted on a record id supplied by the
 * client, with no check that the record belonged to the caller. One test of
 * this shape would have caught the entire family, which is why it is the first
 * test in the suite.
 */

let h: Harness;
let alice: Session;
let bob: Session;

/** Alice's private material, recreated before each attack. */
async function seedAlice() {
  await post(h, "/api/persistence", {
    action: "save-thread",
    userEmail: alice.email,
    thread: {
      id: ALICE_THREAD,
      title: "My cofounder crisis",
      theme: "cofounder",
      state: "panic",
      lastAt: "now",
      personality: "none",
      messages: [
        { role: "user", content: "SECRET: I am thinking of firing my cofounder" },
        { role: "assistant", content: "Slow it down." },
      ],
    },
  }, alice.cookie);

  await post(h, "/api/persistence", {
    action: "save-checkin",
    userEmail: alice.email,
    checkin: { id: ALICE_CHECKIN, theme: "checkin", prompt: "Alice private reflection", mood: 20 },
  }, alice.cookie);

  await post(h, "/api/persistence", {
    action: "save-decision",
    userEmail: alice.email,
    decision: { id: ALICE_DECISION, summary: "Alice decision", door: "one-way", theme: "cofounder", status: "open" },
  }, alice.cookie);
}

const ALICE_THREAD = "t-alice-1";
const ALICE_CHECKIN = "c-alice-1";
const ALICE_DECISION = "d-alice-1";

beforeAll(async () => {
  h = await startServer();
  const users = await twoFounders(h);
  alice = users.alice;
  bob = users.bob;
  await seedAlice();
});

afterAll(() => h?.stop());

describe("cross-tenant isolation", () => {
  test("bob cannot read alice's threads", async () => {
    const res = await get(h, `/api/persistence?resource=threads&user=${alice.email}`, bob.cookie);
    expect(res.status).toBe(403);
  });

  test("bob cannot read alice's check-ins", async () => {
    const res = await get(h, `/api/persistence?resource=checkins&user=${alice.email}`, bob.cookie);
    expect(res.status).toBe(403);
  });

  test("bob cannot overwrite alice's thread by reusing her thread id", async () => {
    const res = await post(h, "/api/persistence", {
      action: "save-thread",
      // Bob's own email — so requireSelf() passes. The attack is in the id.
      userEmail: bob.email,
      thread: {
        id: ALICE_THREAD,
        title: "PWNED",
        theme: "pwned",
        state: "thinking",
        lastAt: "x",
        personality: "none",
        messages: [{ role: "user", content: "attacker content" }],
      },
    }, bob.cookie);

    expect(res.status).toBe(403);

    // Alice's thread must be untouched, messages included.
    const mine = await get(h, `/api/persistence?resource=threads&user=${alice.email}`, alice.cookie);
    const { threads } = await mine.json();
    const thread = threads.find((t: { id: string }) => t.id === ALICE_THREAD);
    expect(thread.title).toBe("My cofounder crisis");
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[0].content).toContain("SECRET");
  });

  test("bob cannot rewrite alice's attention score", async () => {
    const res = await post(h, "/api/persistence", {
      action: "save-checkin",
      userEmail: bob.email,
      checkin: { id: ALICE_CHECKIN, theme: "x", prompt: "x", mood: 99 },
    }, bob.cookie);

    expect(res.status).toBe(403);

    const mine = await get(h, `/api/persistence?resource=checkins&user=${alice.email}`, alice.cookie);
    const { checkins } = await mine.json();
    const checkin = checkins.find((c: { id: string }) => c.id === ALICE_CHECKIN);
    expect(checkin.mood).toBe(20);
    expect(checkin.prompt).toBe("Alice private reflection");
  });

  test("bob cannot tamper with alice's decision", async () => {
    const res = await post(h, "/api/persistence", {
      action: "save-decision",
      userEmail: bob.email,
      decision: {
        id: ALICE_DECISION,
        summary: "ignored",
        door: "reversible",
        theme: "x",
        status: "closed",
        outcome: "ATTACKER SET THIS",
      },
    }, bob.cookie);

    expect(res.status).toBe(403);

    const mine = await get(h, `/api/persistence?resource=decisions&user=${alice.email}`, alice.cookie);
    const { decisions } = await mine.json();
    const decision = decisions.find((d: { id: string }) => d.id === ALICE_DECISION);
    expect(decision.status).toBe("open");
    expect(decision.outcome).toBeNull();
  });

  test("bob cannot delete alice's check-in", async () => {
    const res = await post(h, "/api/persistence", {
      action: "delete-checkin",
      userEmail: bob.email,
      checkinId: ALICE_CHECKIN,
    }, bob.cookie);

    expect(res.status).toBe(403);

    const mine = await get(h, `/api/persistence?resource=checkins&user=${alice.email}`, alice.cookie);
    const { checkins } = await mine.json();
    expect(checkins.some((c: { id: string }) => c.id === ALICE_CHECKIN)).toBe(true);
  });

  test("bob cannot share alice's thread with the coaches", async () => {
    await post(h, "/api/persistence", {
      action: "set-thread-shared",
      userEmail: bob.email,
      threadId: ALICE_THREAD,
      shared: true,
    }, bob.cookie);

    // Whatever the status, the flag must not have moved.
    const db = h.db();
    try {
      const row = db
        .query("SELECT shared_with_coach FROM threads WHERE id = $id")
        .get({ $id: ALICE_THREAD }) as { shared_with_coach: number };
      expect(row.shared_with_coach).toBe(0);
    } finally {
      db.close();
    }
  });

  test("bob cannot chat as alice", async () => {
    const res = await post(h, "/api/chat", {
      messages: [{ role: "user", content: "hello" }],
      userEmail: alice.email,
    }, bob.cookie);
    expect(res.status).toBe(403);
  });

  test("alice can still do all of these to her own records", async () => {
    const save = await post(h, "/api/persistence", {
      action: "save-thread",
      userEmail: alice.email,
      thread: {
        id: ALICE_THREAD,
        title: "Renamed by Alice",
        theme: "cofounder",
        state: "thinking",
        lastAt: "now",
        personality: "none",
        messages: [{ role: "user", content: "still mine" }],
      },
    }, alice.cookie);
    expect(save.status).toBe(200);

    const mine = await get(h, `/api/persistence?resource=threads&user=${alice.email}`, alice.cookie);
    const { threads } = await mine.json();
    const thread = threads.find((t: { id: string }) => t.id === ALICE_THREAD);
    expect(thread.title).toBe("Renamed by Alice");
  });
});
