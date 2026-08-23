import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createFounder, createOrganizer, get, post, startServer, type Harness, type Session } from "./helpers/harness";

/**
 * Access and erasure.
 *
 * Both rights act on the signed-in account and nothing else — there is no id
 * to tamper with — so the tests worth writing are about what the export must
 * not contain, and about erasure actually reaching every table rather than
 * only the obvious ones.
 */

let h: Harness;
let organizer: Session;
let alice: Session;
let bob: Session;

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
  alice = await createFounder(h, organizer, "alice@example.test", "Alice", "alice-password-11");
  bob = await createFounder(h, organizer, "bob@example.test", "Bob", "bob-password-1122");
});

afterAll(() => h?.stop());

async function seed(session: Session, id: string) {
  await post(h, "/api/persistence", {
    action: "save-thread",
    userEmail: session.email,
    thread: {
      id, title: `${id} title`, theme: "team", state: "thinking", lastAt: "now",
      messages: [{ role: "user", content: `words from ${session.email}` }],
    },
  }, session.cookie);
}

describe("export", () => {
  test("returns the signed-in person's own data", async () => {
    await seed(alice, "alice-thread");
    const res = await get(h, "/api/account", alice.cookie);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("words from alice@example.test");
    expect(body).toContain("alice@example.test");
  });

  test("never contains anybody else's data", async () => {
    await seed(bob, "bob-thread");
    const body = await (await get(h, "/api/account", alice.cookie)).text();
    expect(body).not.toContain("words from bob@example.test");
    expect(body).not.toContain("bob@example.test");
  });

  test("never contains credentials", async () => {
    // An export lands in a downloads folder or an inbox. It must not be a
    // copy of the things that authenticate the person.
    const body = await (await get(h, "/api/account", alice.cookie)).text();
    for (const field of ["password_hash", "token_hash", "$argon2id$"]) {
      expect(body).not.toContain(field);
    }
  });

  test("anonymous callers get nothing", async () => {
    expect((await get(h, "/api/account")).status).toBe(401);
  });
});

describe("erasure", () => {
  test("confirmation is required", async () => {
    const res = await post(h, "/api/account", { action: "delete" }, bob.cookie);
    expect(res.status).toBe(400);
  });

  test("a mistyped confirmation does nothing", async () => {
    const res = await post(h, "/api/account", { action: "delete", confirm: "not-my-email" }, bob.cookie);
    expect(res.status).toBe(400);
  });

  test("deleting removes the person from every table that held them", async () => {
    const res = await post(h, "/api/account", { action: "delete", confirm: bob.email }, bob.cookie);
    expect(res.status).toBe(200);

    const db = h.db();
    try {
      for (const [table, column] of [
        ["users", "email"],
        ["threads", "user_email"],
        ["decisions", "user_email"],
        ["checkins", "user_email"],
        ["visits", "user_email"],
        ["working_genius", "user_email"],
        ["sessions", "user_email"],
        ["invites", "user_email"],
        ["deadline_completions", "user_email"],
        ["deadline_reminders", "user_email"],
      ] as const) {
        const row = db
          .query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = $e`)
          .get({ $e: bob.email }) as { n: number };
        expect({ table, n: row.n }).toEqual({ table, n: 0 });
      }
      // Messages hang off threads rather than off the user, so they are the
      // easiest thing to leave behind.
      const orphaned = db
        .query("SELECT COUNT(*) AS n FROM messages WHERE content LIKE '%words from bob@example.test%'")
        .get() as { n: number };
      expect(orphaned.n).toBe(0);
    } finally {
      db.close();
    }
  });

  test("their session stops working immediately", async () => {
    const res = await get(h, "/api/account", bob.cookie);
    expect(res.status).toBe(401);
  });

  test("nobody else was touched", async () => {
    const body = await (await get(h, "/api/account", alice.cookie)).text();
    expect(body).toContain("words from alice@example.test");
  });

  test("the last organizer cannot delete themselves", async () => {
    // Otherwise nobody can reach /admin to invite an organizer back, and the
    // only way out is editing the database by hand.
    const res = await post(h, "/api/account", { action: "delete", confirm: organizer.email }, organizer.cookie);
    expect(res.status).toBe(409);
  });
});
