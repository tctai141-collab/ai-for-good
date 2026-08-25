import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createFounder, createMentor, createOrganizer, get, post, startServer,
  type Harness, type Session,
} from "./helpers/harness";

/**
 * The mentor role.
 *
 * Before this there were two roles, and the only way to give somebody the
 * cohort dashboard was an organizer account — which also lets them delete a
 * founder and everything that founder has written. That is a lot of authority
 * to hand to a guest who wants to read a page once a week.
 *
 * A mentor reads and changes nothing. The reading half is easy to get right
 * and easy to test; the half that matters is the refusals, so most of this
 * file is a mentor being told no. Each one goes through the real HTTP path
 * rather than a unit check, because the guard is per-endpoint and a role added
 * to the type without a guard added to the route is exactly the mistake this
 * is here to catch.
 */

let h: Harness;
let organizer: Session;
let mentor: Session;
let founder: Session;

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
  mentor = await createMentor(h, "marten@example.test", "Mårten");
  founder = await createFounder(h, organizer, "founder@example.test", "Founder", "founder-password-1");
});

afterAll(() => h?.stop());

describe("what a mentor can read", () => {
  test("the cohort dashboard", async () => {
    const res = await get(h, "/api/cohort", mentor.cookie);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { teams: unknown[]; map: unknown[] };
    expect(Array.isArray(data.teams)).toBe(true);
    expect(Array.isArray(data.map)).toBe(true);
  });

  test("conversations founders handed over", async () => {
    const res = await get(h, "/api/admin/shared", mentor.cookie);
    expect(res.status).toBe(200);
  });

  test("who is behind on what", async () => {
    const res = await get(h, "/api/deadlines?view=status", mentor.cookie);
    expect(res.status).toBe(200);
  });

  test("the programme", async () => {
    const res = await get(h, "/api/programme", mentor.cookie);
    expect(res.status).toBe(200);
  });
});

describe("what a mentor cannot do", () => {
  test("cannot list the accounts", async () => {
    expect((await get(h, "/api/admin/users", mentor.cookie)).status).toBe(403);
  });

  test("cannot add anybody", async () => {
    const res = await post(h, "/api/admin/users", {
      action: "add", name: "Smuggled", email: "smuggled@example.test", role: "organizer",
    }, mentor.cookie);
    expect(res.status).toBe(403);
  });

  test("cannot remove anybody", async () => {
    const res = await post(h, "/api/admin/users", { action: "remove", email: founder.email }, mentor.cookie);
    expect(res.status).toBe(403);
    // And the founder is still there.
    const list = await get(h, "/api/admin/users", organizer.cookie);
    const data = (await list.json()) as { users: { email: string }[] };
    expect(data.users.some((u) => u.email === founder.email)).toBe(true);
  });

  test("cannot trigger a password reset on a founder", async () => {
    const res = await post(h, "/api/admin/users", { action: "reinvite", email: founder.email }, mentor.cookie);
    expect(res.status).toBe(403);
  });

  test("cannot set a deadline", async () => {
    const res = await post(h, "/api/deadlines", {
      action: "create", title: "Mentor's deadline", dueDate: "2026-10-01",
    }, mentor.cookie);
    expect(res.status).toBe(403);
  });

  test("cannot edit the programme", async () => {
    const res = await post(h, "/api/programme", {
      week: 2, phase: "Rewritten", title: "x", milestones: "", sessions: "",
    }, mentor.cookie);
    expect(res.status).toBe(403);
  });

  test("cannot change what Sprint Buddy knows", async () => {
    const res = await post(h, "/api/knowledge", { action: "save", topic: "x", body: "y" }, mentor.cookie);
    expect(res.status).toBe(403);
  });

  test("cannot mail the cohort", async () => {
    const res = await post(h, "/api/admin/broadcast", {
      action: "test", subject: "Hello", body: "Hi {{first_name}}",
    }, mentor.cookie);
    expect(res.status).toBe(403);
  });

  test("cannot read one founder's private data", async () => {
    /*
     * Deliberately not granted. A mentor gets the cohort view and the
     * conversations founders published; the per-founder persistence read is a
     * different door and stays shut.
     */
    for (const resource of ["threads", "checkins", "working-genius", "decisions"]) {
      const res = await get(
        h,
        `/api/persistence?resource=${resource}&user=${encodeURIComponent(founder.email)}`,
        mentor.cookie,
      );
      expect(res.status).toBe(403);
    }
  });
});

describe("the role is real, not cosmetic", () => {
  test("an organizer can create one", async () => {
    const res = await post(h, "/api/admin/users", {
      action: "add", name: "Second Mentor", email: "mentor2@example.test", role: "mentor",
    }, organizer.cookie);
    expect(res.status).toBe(200);

    const list = await get(h, "/api/admin/users", organizer.cookie);
    const data = (await list.json()) as { users: { email: string; role: string }[] };
    expect(data.users.find((u) => u.email === "mentor2@example.test")?.role).toBe("mentor");
  });

  test("the database accepts it", async () => {
    // The CHECK had to be rebuilt; SQLite cannot alter one in place.
    const db = h.db();
    try {
      const row = db.query("SELECT role FROM users WHERE email = $e").get({ $e: mentor.email }) as { role: string };
      expect(row.role).toBe("mentor");
    } finally {
      db.close();
    }
  });

  test("a founder is still refused everything a mentor is refused", async () => {
    // The new role must not have widened the old one.
    expect((await get(h, "/api/cohort", founder.cookie)).status).toBe(403);
    expect((await get(h, "/api/admin/shared", founder.cookie)).status).toBe(403);
    expect((await get(h, "/api/deadlines?view=status", founder.cookie)).status).toBe(403);
  });
});
