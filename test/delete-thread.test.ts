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

  test("keeps the decisions the conversation produced", async () => {
    /*
     * The schema settled this deliberately: messages cascade, decisions do not.
     * A decision that outlives the conversation that prompted it is still
     * useful, so its thread_id is set to null rather than the row being
     * destroyed. Deleting a chat must not quietly bin the founder's decision
     * log with it.
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
      const row = db.query("SELECT thread_id FROM decisions WHERE id = 'alice-decision-1'").get() as { thread_id: string | null } | null;
      expect(row).not.toBeNull();
      expect(row!.thread_id).toBeNull();
    } finally {
      db.close();
    }
  });
});
