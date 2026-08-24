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

  test("carries the working-style profile and every take of it", async () => {
    /*
     * Assembling the export by hand stops a new column exporting itself, and
     * has the matching weakness: a whole new table stays invisible until
     * somebody remembers it. The working-style profile is the most personal
     * thing here after the conversations and was missing from the export
     * entirely, along with the take history added the day before.
     */
    const res = await get(h, "/api/account", alice.cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body).toHaveProperty("workingStyle");
    expect(body).toHaveProperty("deadlinesCompleted");
    expect(body).toHaveProperty("timesOpened");
    const style = body.workingStyle as { latest: unknown; everyTake: unknown[] };
    expect(Array.isArray(style.everyTake)).toBe(true);
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
      /*
       * Discovered from the schema rather than listed by hand.
       *
       * The hand-written list was missing working_genius_takes within a day of
       * that table existing, and would have gone on missing the next one. Any
       * table with a user_email column is in scope automatically now, so a new
       * one fails this test until somebody has decided about it.
       */
      const RETAINED_ON_PURPOSE = new Set([
        // Who did what, kept for accountability and disclosed in PRIVACY.md.
        "admin_audit",
        // What was sent to whom. Deliberately has no foreign key to users: a
        // delivery record that rewrites itself when somebody leaves is not a
        // record. Also disclosed.
        "broadcast_recipients",
      ]);

      const userTables = (db
        .query("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[])
        .map((t) => t.name)
        .filter((name) => !name.startsWith("sqlite_"))
        .filter((name) => !RETAINED_ON_PURPOSE.has(name))
        .filter((name) =>
          (db.query(`PRAGMA table_info(${name})`).all() as { name: string }[])
            .some((c) => c.name === "user_email"),
        );

      // The discovery itself has to be working, or this passes on an empty list.
      expect(userTables).toContain("working_genius_takes");
      expect(userTables.length).toBeGreaterThan(6);

      for (const table of [...userTables, "users"]) {
        const column = table === "users" ? "email" : "user_email";
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
