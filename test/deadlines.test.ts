import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createFounder, createOrganizer, get, post,
  startServer, twoFounders, type Harness, type Session,
} from "./helpers/harness";
import { groupFor, progressFor, dueInstant } from "../src/lib/deadlines";

/**
 * Work Package 3 — deadlines and task tracking.
 *
 * This is net-new attack surface added on top of a codebase that had just been
 * hardened, so it is tested against the exact bug classes the audit found
 * rather than trusting that they were understood.
 */

let h: Harness;
let organizer: Session;
let alice: Session;
let bob: Session;

async function createDeadline(as: Session, fields: Record<string, unknown>) {
  const res = await post(h, "/api/deadlines", { action: "create", ...fields }, as.cookie);
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  h = await startServer();
  const users = await twoFounders(h);
  organizer = users.organizer;
  alice = users.alice;
  bob = users.bob;
});

afterAll(() => h?.stop());

describe("role gates", () => {
  test("a founder cannot create a deadline", async () => {
    const res = await post(h, "/api/deadlines", {
      action: "create", title: "Founder made this", dueDate: "2026-09-30",
    }, alice.cookie);
    expect(res.status).toBe(403);
  });

  test("a founder cannot update or archive one", async () => {
    const { body } = await createDeadline(organizer, { title: "Real one", dueDate: "2026-09-30" });
    for (const fields of [{ title: "hijacked" }, { status: "archived" }]) {
      const res = await post(h, "/api/deadlines", { action: "update", id: body.id, ...fields }, alice.cookie);
      expect(res.status).toBe(403);
    }
  });

  test("a founder cannot read the organizer status view", async () => {
    const res = await get(h, "/api/deadlines?view=status", alice.cookie);
    expect(res.status).toBe(403);
  });

  test("anonymous callers get nothing", async () => {
    expect((await get(h, "/api/deadlines")).status).toBe(401);
    expect((await get(h, "/api/deadlines?view=status")).status).toBe(401);
    expect((await post(h, "/api/deadlines", { action: "create", title: "x", dueDate: "2026-09-30" })).status).toBe(401);
  });
});

describe("completions are always the caller's own", () => {
  test("toggling ignores any user identity in the body", async () => {
    const { body } = await createDeadline(organizer, { title: "Shared milestone", dueDate: "2026-09-30" });

    // Bob ticks it off, and tries every shape of "do this as Alice" the old
    // endpoints would have accepted.
    const res = await post(h, "/api/deadlines", {
      action: "toggle",
      id: body.id,
      done: true,
      userEmail: alice.email,
      user_email: alice.email,
      user: alice.email,
    }, bob.cookie);
    expect(res.status).toBe(200);

    // Only Bob's row exists.
    const db = h.db();
    try {
      const rows = db
        .query("SELECT user_email FROM deadline_completions WHERE deadline_id = $id")
        .all({ $id: body.id }) as { user_email: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]!.user_email).toBe(bob.email);
    } finally {
      db.close();
    }

    // And Alice still sees it as not done.
    const mine = await (await get(h, "/api/deadlines", alice.cookie)).json();
    const item = mine.deadlines.find((d: { id: string }) => d.id === body.id);
    expect(item.done).toBe(false);
  });

  test("un-ticking only removes the caller's own row", async () => {
    const { body } = await createDeadline(organizer, { title: "Both do this", dueDate: "2026-09-30" });
    await post(h, "/api/deadlines", { action: "toggle", id: body.id, done: true }, alice.cookie);
    await post(h, "/api/deadlines", { action: "toggle", id: body.id, done: true }, bob.cookie);

    await post(h, "/api/deadlines", {
      action: "toggle", id: body.id, done: false, userEmail: alice.email,
    }, bob.cookie);

    const db = h.db();
    try {
      const rows = db
        .query("SELECT user_email FROM deadline_completions WHERE deadline_id = $id")
        .all({ $id: body.id }) as { user_email: string }[];
      expect(rows.map((r) => r.user_email)).toEqual([alice.email]);
    } finally {
      db.close();
    }
  });
});

describe("ids are server-generated", () => {
  test("a client-supplied id is not honoured", async () => {
    const { body } = await createDeadline(organizer, {
      title: "Attempted id", dueDate: "2026-09-30", id: "attacker-chosen-id",
    });
    expect(body.id).not.toBe("attacker-chosen-id");
    // A UUID, not a timestamp like the old "t"+Date.now() ids.
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe("the status view carries no founder prose", () => {
  test("it returns task state only", async () => {
    const secret = "Should I fire my cofounder before the Kiilto demo";
    await post(h, "/api/persistence", {
      action: "save-thread", userEmail: alice.email,
      thread: {
        id: "t-secret", title: secret, theme: "cofounder", state: "panic",
        lastAt: "now", personality: "none", messages: [{ role: "user", content: secret }],
      },
    }, alice.cookie);
    await post(h, "/api/persistence", {
      action: "save-decision", userEmail: alice.email,
      decision: { id: "d-secret", summary: secret, door: "one-way", theme: "cofounder", status: "open" },
    }, alice.cookie);
    await post(h, "/api/persistence", {
      action: "save-checkin", userEmail: alice.email,
      checkin: { id: "c-secret", theme: "checkin", prompt: secret, mood: 90 },
    }, alice.cookie);

    const res = await get(h, "/api/deadlines?view=status", organizer.cookie);
    const raw = await res.text();

    expect(res.status).toBe(200);
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain("cofounder");
    expect(raw).not.toContain("mood");
    expect(raw).not.toContain("summary");

    const body = JSON.parse(raw);
    expect(body.deadlines[0]).toHaveProperty("doneCount");
    expect(body.deadlines[0]).toHaveProperty("behind");
  });
});

describe("cascade behaviour", () => {
  test("deleting a deadline removes its completions", async () => {
    const { body } = await createDeadline(organizer, { title: "To delete", dueDate: "2026-09-30" });
    await post(h, "/api/deadlines", { action: "toggle", id: body.id, done: true }, alice.cookie);

    const db = h.db();
    try {
      expect((db.query("SELECT COUNT(*) n FROM deadline_completions WHERE deadline_id = $id").get({ $id: body.id }) as { n: number }).n).toBe(1);
      db.run("DELETE FROM deadlines WHERE id = $id", { $id: body.id });
      expect((db.query("SELECT COUNT(*) n FROM deadline_completions WHERE deadline_id = $id").get({ $id: body.id }) as { n: number }).n).toBe(0);
    } finally {
      db.close();
    }
  });

  test("removing a founder removes their completions", async () => {
    const doomed = await createFounder(h, organizer, "doomed-tasks@example.test", "Doomed", "doomed-password-12");
    const { body } = await createDeadline(organizer, { title: "Cascade check", dueDate: "2026-09-30" });
    await post(h, "/api/deadlines", { action: "toggle", id: body.id, done: true }, doomed.cookie);

    const before = h.db();
    try {
      expect((before.query("SELECT COUNT(*) n FROM deadline_completions WHERE user_email = $e").get({ $e: doomed.email }) as { n: number }).n).toBe(1);
    } finally {
      before.close();
    }

    const removed = await post(h, "/api/admin/users", { action: "remove", email: doomed.email }, organizer.cookie);
    expect(removed.status).toBe(200);

    const after = h.db();
    try {
      expect((after.query("SELECT COUNT(*) n FROM deadline_completions WHERE user_email = $e").get({ $e: doomed.email }) as { n: number }).n).toBe(0);
      expect((after.query("SELECT COUNT(*) n FROM deadline_completions WHERE user_email NOT IN (SELECT email FROM users)").get() as { n: number }).n).toBe(0);
    } finally {
      after.close();
    }
  });
});

describe("deleting a deadline", () => {
  /*
   * Archiving already existed and is right for something that happened and is
   * over: it keeps the completion history and hides the row from founders.
   * This is for the other case, a deadline set up wrong, where leaving the
   * record is leaving a mistake on the cohort's list.
   */
  const listFor = async (who: Session) => {
    const res = await get(h, "/api/deadlines", who.cookie);
    const body = await res.json();
    return (body.deadlines ?? body.items ?? []) as { id: string; title: string }[];
  };

  test("an organizer can delete one, and it leaves the founders' list", async () => {
    const made = await createDeadline(organizer, { title: "Set up wrong", dueDate: "2026-10-01" });
    const id = made.body.id as string;
    expect((await listFor(alice)).some((d) => d.id === id)).toBe(true);

    const res = await post(h, "/api/deadlines", { action: "delete", id }, organizer.cookie);
    expect(res.status).toBe(200);

    expect((await listFor(alice)).some((d) => d.id === id)).toBe(false);
    expect((await listFor(organizer)).some((d) => d.id === id)).toBe(false);
  });

  test("a founder cannot delete one", async () => {
    // The same gate every other organizer action has. A founder deleting a
    // cohort deadline would take it off everyone's list.
    const made = await createDeadline(organizer, { title: "Not yours", dueDate: "2026-10-02" });
    const id = made.body.id as string;

    const res = await post(h, "/api/deadlines", { action: "delete", id }, alice.cookie);
    expect(res.status).toBe(403);
    expect((await listFor(alice)).some((d) => d.id === id)).toBe(true);
  });

  test("completions go with it rather than being left pointing at nothing", async () => {
    /*
     * deadline_completions and deadline_reminders both reference deadlines(id)
     * ON DELETE CASCADE, and this database runs with foreign_keys ON. Worth a
     * test rather than a comment: if either constraint were ever rebuilt
     * without the cascade, the rows would survive and the only symptom would
     * be a slowly growing table nobody reads.
     */
    const made = await createDeadline(organizer, { title: "Ticked then deleted", dueDate: "2026-10-03" });
    const id = made.body.id as string;
    await post(h, "/api/deadlines", { action: "toggle", id, done: true }, alice.cookie);

    /* Named bindings, as everywhere else in this codebase: bun:sqlite's types
       do not accept a bare positional argument. */
    const db = h.db();
    const completions = () =>
      (db
        .query("SELECT COUNT(*) AS n FROM deadline_completions WHERE deadline_id = $id")
        .get({ $id: id }) as { n: number }).n;

    expect(completions()).toBe(1);
    await post(h, "/api/deadlines", { action: "delete", id }, organizer.cookie);
    expect(completions()).toBe(0);
  });

  test("deleting something that is not there says so", async () => {
    const res = await post(h, "/api/deadlines", { action: "delete", id: "no-such-id" }, organizer.cookie);
    expect(res.status).toBe(404);
  });

  test("the audit records what was deleted, not just its id", async () => {
    // Once the row is gone the id says nothing about what was removed.
    const made = await createDeadline(organizer, { title: "Audited removal", dueDate: "2026-10-04" });
    const id = made.body.id as string;
    await post(h, "/api/deadlines", { action: "delete", id }, organizer.cookie);

    const row = h.db()
      .query("SELECT detail FROM admin_audit WHERE action = 'deadline:delete' ORDER BY rowid DESC LIMIT 1")
      .get() as { detail: string } | null;
    expect(row?.detail).toContain("Audited removal");
  });
});

describe("input validation", () => {
  test("a missing or invalid due date is refused", async () => {
    for (const dueDate of [undefined, "", "not-a-date", "2026-13-01", "2026-02-31", "30-09-2026"]) {
      const { status } = await createDeadline(organizer, { title: "Bad date", dueDate });
      expect(`${String(dueDate)} -> ${status}`).toBe(`${String(dueDate)} -> 400`);
    }
  });

  test("a sprint week outside 1-15 is refused", async () => {
    for (const sprintWeek of [0, 16, -1, 2.5, "abc"]) {
      const { status } = await createDeadline(organizer, {
        title: "Bad week", dueDate: "2026-09-30", sprintWeek,
      });
      expect(`${String(sprintWeek)} -> ${status}`).toBe(`${String(sprintWeek)} -> 400`);
    }
  });

  test("an empty title is refused", async () => {
    const { status } = await createDeadline(organizer, { title: "   ", dueDate: "2026-09-30" });
    expect(status).toBe(400);
  });

  test("an oversized payload is rejected by the body limit", async () => {
    const res = await post(h, "/api/deadlines", {
      action: "create", title: "x", dueDate: "2026-09-30",
      description: "A".repeat(2_000_000),
    }, organizer.cookie);
    expect(res.status).toBe(413);
  });

  test("a long description is truncated rather than stored whole", async () => {
    const { body } = await createDeadline(organizer, {
      title: "Long description", dueDate: "2026-09-30", description: "B".repeat(5_000),
    });
    const db = h.db();
    try {
      const row = db.query("SELECT description FROM deadlines WHERE id = $id").get({ $id: body.id }) as { description: string };
      expect(row.description.length).toBe(2_000);
    } finally {
      db.close();
    }
  });
});

describe("grouping and progress", () => {
  // Friday 11 September 2026, midday UTC — inside the sprint, summer time.
  const now = Date.parse("2026-09-11T12:00:00Z");

  test("items land in the right group", () => {
    expect(groupFor("2026-09-09", false, now)).toBe("overdue");
    expect(groupFor("2026-09-11", false, now)).toBe("thisWeek");
    expect(groupFor("2026-09-15", false, now)).toBe("thisWeek");
    expect(groupFor("2026-10-01", false, now)).toBe("upcoming");
    expect(groupFor("2026-09-09", true, now)).toBe("done");
  });

  test("a deadline stays green until midnight Helsinki, not midnight UTC", () => {
    // 2026-09-11 expires at 20:59:59.999Z, which is 23:59:59.999 in Helsinki.
    const expires = dueInstant("2026-09-11");
    expect(new Date(expires).toISOString()).toBe("2026-09-11T20:59:59.999Z");

    // Still fine at 22:00 Helsinki (19:00 UTC).
    expect(groupFor("2026-09-11", false, Date.parse("2026-09-11T19:00:00Z"))).toBe("thisWeek");
    // Overdue just after local midnight.
    expect(groupFor("2026-09-11", false, Date.parse("2026-09-11T21:30:00Z"))).toBe("overdue");
  });

  test("progress counts only what is due, not the whole sprint", () => {
    const items = [
      { dueDate: "2026-09-09", done: true },
      { dueDate: "2026-09-11", done: false },
      { dueDate: "2026-12-01", done: false },
      { dueDate: "2026-12-15", done: false },
    ];
    // Two are due; one is done. Not "1 of 4".
    expect(progressFor(items, now)).toEqual({ completed: 1, total: 2 });
  });

  test("finishing early raises the ratio instead of lowering it", () => {
    const items = [
      { dueDate: "2026-09-11", done: true },
      { dueDate: "2026-12-01", done: true },
    ];
    expect(progressFor(items, now)).toEqual({ completed: 2, total: 2 });
  });

  test("before anything is due, progress is 0 of 0 rather than 0 of 15", () => {
    const preSprint = Date.parse("2026-08-18T12:00:00Z");
    const items = Array.from({ length: 15 }, (_, i) => ({
      dueDate: `2026-${String(9 + Math.floor(i / 5)).padStart(2, "0")}-${String((i % 5) + 1).padStart(2, "0")}`,
      done: false,
    }));
    expect(progressFor(items, preSprint)).toEqual({ completed: 0, total: 0 });
  });
});

describe("founder view", () => {
  test("archived deadlines disappear from the founder list but stay in status", async () => {
    const { body } = await createDeadline(organizer, { title: "Will archive", dueDate: "2026-09-30" });

    const before = await (await get(h, "/api/deadlines", alice.cookie)).json();
    expect(before.deadlines.some((d: { id: string }) => d.id === body.id)).toBe(true);

    await post(h, "/api/deadlines", { action: "update", id: body.id, status: "archived" }, organizer.cookie);

    const after = await (await get(h, "/api/deadlines", alice.cookie)).json();
    expect(after.deadlines.some((d: { id: string }) => d.id === body.id)).toBe(false);

    const status = await (await get(h, "/api/deadlines?view=status", organizer.cookie)).json();
    expect(status.deadlines.some((d: { id: string }) => d.id === body.id)).toBe(true);
  });
});
