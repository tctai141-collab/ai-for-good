import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createFounder, createOrganizer, post, startServer, type Harness, type Session } from "./helpers/harness";

/**
 * Deleting a conversation.
 *
 * Net-new destructive surface, so it is tested against the bug class the audit
 * found rather than trusting it was understood: a delete that trusted the id it
 * was handed and never asked whose record it was.
 */

let h: Harness;
let organizer: Session;
let alice: Session;
let bob: Session;

async function makeThread(session: Session, id: string, title: string) {
  const res = await post(h, "/api/persistence", {
    action: "save-thread",
    userEmail: session.email,
    thread: {
      id, title, theme: "runway", state: "thinking", lastAt: "now", personality: "none",
      messages: [
        { role: "user", content: `first message in ${title}` },
        { role: "assistant", content: `reply in ${title}` },
      ],
    },
  }, session.cookie);
  expect(res.status).toBe(200);
}

function threadCount(email: string): number {
  const db = h.db();
  try {
    const row = db.query("SELECT COUNT(*) AS n FROM threads WHERE user_email = $e").get({ $e: email }) as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

function messageCount(threadId: string): number {
  const db = h.db();
  try {
    const row = db.query("SELECT COUNT(*) AS n FROM messages WHERE thread_id = $t").get({ $t: threadId }) as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
  alice = await createFounder(h, organizer, "alice@example.test", "Alice", "alice-password-11");
  bob = await createFounder(h, organizer, "bob@example.test", "Bob", "bob-password-1122");
});

afterAll(() => h?.stop());

describe("deleting a conversation", () => {
  test("removes your own thread", async () => {
    await makeThread(alice, "alice-own-1", "Alice thread one");
    expect(threadCount(alice.email)).toBe(1);

    const res = await post(h, "/api/persistence", {
      action: "delete-thread", userEmail: alice.email, threadId: "alice-own-1",
    }, alice.cookie);

    expect(res.status).toBe(200);
    expect(threadCount(alice.email)).toBe(0);
  });

  test("takes the messages with it", async () => {
    await makeThread(alice, "alice-own-2", "Alice thread two");
    expect(messageCount("alice-own-2")).toBe(2);

    await post(h, "/api/persistence", {
      action: "delete-thread", userEmail: alice.email, threadId: "alice-own-2",
    }, alice.cookie);

    // Orphaned messages would keep the conversation readable in the database
    // after the founder was told it was gone.
    expect(messageCount("alice-own-2")).toBe(0);
  });

  test("cannot delete somebody else's conversation", async () => {
    await makeThread(bob, "bob-own-1", "Bob thread one");

    const res = await post(h, "/api/persistence", {
      action: "delete-thread", userEmail: bob.email, threadId: "bob-own-1",
    }, alice.cookie);

    // Alice claiming to be Bob is rejected on identity before ownership is
    // even reached.
    expect(res.status).toBe(403);
    expect(threadCount(bob.email)).toBe(1);
  });

  test("cannot delete another founder's thread by passing your own email", async () => {
    // The subtler attempt: honest about who you are, lying about what is yours.
    const res = await post(h, "/api/persistence", {
      action: "delete-thread", userEmail: alice.email, threadId: "bob-own-1",
    }, alice.cookie);

    expect(res.status).not.toBe(200);
    expect(threadCount(bob.email)).toBe(1);
    expect(messageCount("bob-own-1")).toBe(2);
  });

  test("a thread that does not exist is a 404, not a silent success", async () => {
    const res = await post(h, "/api/persistence", {
      action: "delete-thread", userEmail: alice.email, threadId: "no-such-thread",
    }, alice.cookie);

    expect(res.status).toBe(404);
  });

  test("anonymous callers cannot delete anything", async () => {
    const res = await post(h, "/api/persistence", {
      action: "delete-thread", userEmail: bob.email, threadId: "bob-own-1",
    });

    expect(res.status).toBe(401);
    expect(threadCount(bob.email)).toBe(1);
  });

  test("takes the decisions the conversation produced with it", async () => {
    /*
     * This test previously asserted the opposite, and the comment explaining
     * why is worth keeping in view: the schema set decisions to ON DELETE SET
     * NULL on the reasoning that "a decision that outlives the conversation
     * that prompted it is still useful".
     *
     * True as far as it goes, and wrong about what deletion is for. The
     * decision's summary is written from the conversation, so a founder who
     * deleted a chat about something painful still had a sentence about it in
     * the database. Tai's call, when asked whether delete really means gone:
     * everything the conversation produced goes with it. A founder who wants
     * to keep the decision keeps the conversation.
     */
    await makeThread(alice, "alice-own-3", "Alice thread three");
    const saved = await post(h, "/api/persistence", {
      action: "save-decision",
      userEmail: alice.email,
      decision: {
        id: "alice-decision-1", threadId: "alice-own-3",
        summary: "Cut the second market", door: "one-way", status: "open", theme: "focus", at: "now",
      },
    }, alice.cookie);
    expect(saved.status).toBe(200);

    await post(h, "/api/persistence", {
      action: "delete-thread", userEmail: alice.email, threadId: "alice-own-3",
    }, alice.cookie);

    const db = h.db();
    try {
      const row = db.query("SELECT thread_id FROM decisions WHERE id = 'alice-decision-1'").get();
      expect(row).toBeNull();
    } finally {
      db.close();
    }
  });
});

/**
 * What a deletion actually reaches.
 *
 * Tai asked whether a deleted conversation is really gone. It was not: the
 * thread and its messages went, but a decision captured from it stayed behind
 * with its summary intact and merely unlinked — so a founder who deleted a
 * conversation about a cofounder problem still had a sentence about that
 * cofounder problem in the database.
 *
 * These pin the boundary on both sides. Everything the conversation produced
 * goes. Nothing else does.
 */
describe("what a deleted conversation takes with it", () => {
  async function saveDecision(session: Session, id: string, summary: string, threadId?: string) {
    const res = await post(h, "/api/persistence", {
      action: "save-decision",
      userEmail: session.email,
      decision: { id, summary, door: "one-way", status: "open", theme: "team", at: "today", threadId },
    }, session.cookie);
    expect(res.status).toBe(200);
  }

  function decisionSummaries(email: string): string[] {
    const db = h.db();
    try {
      return (db.query("SELECT summary FROM decisions WHERE user_email = $e ORDER BY summary")
        .all({ $e: email }) as { summary: string }[]).map((r) => r.summary);
    } finally {
      db.close();
    }
  }

  test("a decision captured from the conversation goes with it", async () => {
    await makeThread(alice, "sensitive-1", "Cofounder trouble");
    await saveDecision(alice, "dec-linked", "Confront cofounder about the numbers", "sensitive-1");

    expect(decisionSummaries(alice.email)).toContain("Confront cofounder about the numbers");

    const res = await post(h, "/api/persistence", {
      action: "delete-thread", userEmail: alice.email, threadId: "sensitive-1",
    }, alice.cookie);
    expect(res.status).toBe(200);

    expect(messageCount("sensitive-1")).toBe(0);
    // The point of the change: not merely unlinked, gone.
    expect(decisionSummaries(alice.email)).not.toContain("Confront cofounder about the numbers");
  });

  test("decisions from other conversations are untouched", async () => {
    await makeThread(alice, "keep-me", "Unrelated");
    await makeThread(alice, "bin-me", "To delete");
    await saveDecision(alice, "dec-keep", "A decision worth keeping", "keep-me");
    await saveDecision(alice, "dec-bin", "A decision to lose", "bin-me");

    await post(h, "/api/persistence", {
      action: "delete-thread", userEmail: alice.email, threadId: "bin-me",
    }, alice.cookie);

    const left = decisionSummaries(alice.email);
    expect(left).toContain("A decision worth keeping");
    expect(left).not.toContain("A decision to lose");
  });

  test("a standalone decision with no conversation survives", async () => {
    await saveDecision(alice, "dec-standalone", "Never came from a chat");
    await makeThread(alice, "unrelated-thread", "Something else");

    await post(h, "/api/persistence", {
      action: "delete-thread", userEmail: alice.email, threadId: "unrelated-thread",
    }, alice.cookie);

    expect(decisionSummaries(alice.email)).toContain("Never came from a chat");
  });

  test("deleting cannot reach another founder's decision, even on a shared thread id", async () => {
    await makeThread(bob, "bob-thread", "Bob's conversation");
    await saveDecision(bob, "bob-dec", "Bob's private decision", "bob-thread");

    // Alice aims at Bob's thread id. Ownership is checked before anything runs.
    const res = await post(h, "/api/persistence", {
      action: "delete-thread", userEmail: alice.email, threadId: "bob-thread",
    }, alice.cookie);
    expect(res.status).toBeGreaterThanOrEqual(400);

    expect(decisionSummaries(bob.email)).toContain("Bob's private decision");
    expect(threadCount(bob.email)).toBeGreaterThan(0);
  });
});
