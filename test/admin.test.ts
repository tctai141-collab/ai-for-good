import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  activate, createFounder, createOrganizer, get, post,
  startServer, type Harness, type Session,
} from "./helpers/harness";

/**
 * H-1 — the reset-link takeover — and H-4 — user deletion.
 *
 * H-1: "Reset password" used to return the setup link in the response body to
 * the organizer who clicked it. They could redeem it, choose a password, and be
 * issued a session as that founder, then read the private conversations the
 * whole privacy model rests on. Two clicks, no audit trail.
 *
 * The link now goes to the founder's own address only. That does not remove an
 * organizer's ability to *trigger* a reset — nothing can, short of removing
 * admin resets — but it removes their ability to complete one silently, and
 * every attempt is now recorded.
 */

let h: Harness;
let organizer: Session;
let founder: Session;

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
  founder = await createFounder(h, organizer, "founder@example.test", "Founder", "founder-password-1");

  await post(h, "/api/persistence", {
    action: "save-thread",
    userEmail: founder.email,
    thread: {
      id: "t-1", title: "Private", theme: "x", state: "thinking", lastAt: "now",
      personality: "none", messages: [{ role: "user", content: "PRIVATE CONTENT" }],
    },
  }, founder.cookie);
  await post(h, "/api/persistence", {
    action: "save-checkin", userEmail: founder.email,
    checkin: { id: "c-1", theme: "checkin", prompt: "private reflection", mood: 55 },
  }, founder.cookie);
  await post(h, "/api/persistence", {
    action: "save-decision", userEmail: founder.email,
    decision: { id: "d-1", summary: "private decision", door: "one-way", theme: "x", status: "open" },
  }, founder.cookie);
  await post(h, "/api/persistence", {
    action: "save-working-genius", userEmail: founder.email,
    workingGeniusShareConsent: true,
    workingGenius: { primary: "wonder", counts: { wonder: 3 }, completedAt: "2026-08-17" },
  }, founder.cookie);
  await post(h, "/api/persistence", { action: "increment-visits", userEmail: founder.email }, founder.cookie);
});

afterAll(() => h?.stop());

describe("setup links are never handed to the operator", () => {
  test("reinvite response carries no link or token", async () => {
    const res = await post(h, "/api/admin/users", { action: "reinvite", email: founder.email }, organizer.cookie);
    const body = await res.text();

    expect(res.status).toBe(200);
    // The whole point: the operator is told it was sent, and nothing more.
    expect(body).not.toContain("/setup?token=");
    expect(body.toLowerCase()).not.toContain('"link"');
    expect(JSON.parse(body)).toEqual({ ok: true, email: founder.email, emailed: true });
  });

  test("adding a person returns no link either", async () => {
    const res = await post(h, "/api/admin/users", {
      action: "add", email: "new@example.test", name: "New Person", role: "founder",
    }, organizer.cookie);
    const body = await res.text();
    expect(body).not.toContain("/setup?token=");
  });

  test("with email unconfigured, adding a person fails closed instead of leaking the link", async () => {
    // A separate instance with no Resend settings at all. The old behaviour —
    // hand the link back in the response — must not return as a "fallback".
    const bare = await startServer({ email: false });
    try {
      const admin = await createOrganizer(bare, "organizer@example.test");
      const res = await post(bare, "/api/admin/users", {
        action: "add", email: "closed@example.test", name: "Closed", role: "founder",
      }, admin.cookie);

      expect(res.status).toBe(503);
      const body = await res.text();
      expect(body).toMatch(/not configured/i);
      expect(body).not.toContain("/setup?token=");
    } finally {
      bare.stop();
    }
  });

  test("the founder is the only recipient of their setup link", async () => {
    const message = h.lastEmailTo("new@example.test");
    expect(message).toBeDefined();
    expect(message!.to).toBe("new@example.test");
    expect(message!.text).toContain("/setup?token=");
    // Nothing addressed to the organizer ever carries a token.
    for (const sent of h.sent.filter((m) => m.to === organizer.email)) {
      expect(sent.text).not.toContain("/setup?token=");
    }
  });

  test("a reset email warns the founder they did not ask for it", async () => {
    await post(h, "/api/admin/users", { action: "reinvite", email: founder.email }, organizer.cookie);
    const message = h.lastEmailTo(founder.email);
    expect(message!.subject).toMatch(/reset/i);
    expect(message!.text).toMatch(/did NOT request this/i);
  });

  test("a founder warned about a reset can actually reach someone", async () => {
    // The From address is a no-reply, so the warning above is only useful if
    // replying goes somewhere real and the body names where.
    await post(h, "/api/admin/users", { action: "reinvite", email: founder.email }, organizer.cookie);
    const message = h.lastEmailTo(founder.email);
    expect(message!.replyTo).toEqual(["sprint-team@example.test"]);
    expect(message!.text).toContain("sprint-team@example.test");
  });
});

describe("admin actions are attributable", () => {
  test("every mutation writes an audit row naming the actor", async () => {
    await post(h, "/api/admin/users", { action: "reinvite", email: founder.email }, organizer.cookie);

    const db = h.db();
    try {
      const rows = db.query("SELECT * FROM admin_audit ORDER BY rowid").all() as {
        actor_email: string; action: string; subject_email: string;
      }[];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.actor_email === organizer.email)).toBe(true);
      // The founder was created through the admin API in beforeAll.
      expect(rows.some((r) => r.action === "add-user" && r.subject_email === founder.email)).toBe(true);
      // And the failed-email reset attempts are recorded too, not swallowed.
      expect(rows.some((r) => r.action.includes("reinvite") || r.action.includes("reset"))).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe("role gates", () => {
  test("a founder cannot reach any admin action", async () => {
    expect((await get(h, "/api/admin/users", founder.cookie)).status).toBe(403);
    for (const action of ["add", "add-bulk", "reinvite", "update", "remove"]) {
      const res = await post(h, "/api/admin/users", { action, email: "x@example.test", name: "X" }, founder.cookie);
      expect(res.status).toBe(403);
    }
  });
});

describe("user deletion (H-4)", () => {
  test("removing a founder who has data succeeds and leaves nothing behind", async () => {
    const victim = await createOrganizer(h, "temp-organizer@example.test", "Temp", "temp-password-123");
    // Give the account rows in every child table.
    await post(h, "/api/persistence", {
      action: "save-thread", userEmail: victim.email,
      thread: { id: "t-del", title: "x", theme: "x", state: "thinking", lastAt: "n", personality: "none", messages: [{ role: "user", content: "hello" }] },
    }, victim.cookie);
    await post(h, "/api/persistence", {
      action: "save-decision", userEmail: victim.email,
      decision: { id: "d-del", summary: "x", door: "one-way", theme: "x", status: "open" },
    }, victim.cookie);
    await post(h, "/api/persistence", {
      action: "save-checkin", userEmail: victim.email,
      checkin: { id: "c-del", theme: "checkin", prompt: "x", mood: 10 },
    }, victim.cookie);
    await post(h, "/api/persistence", { action: "increment-visits", userEmail: victim.email }, victim.cookie);
    await post(h, "/api/persistence", {
      action: "save-working-genius", userEmail: victim.email,
    workingGeniusShareConsent: true,
      workingGenius: { primary: "tenacity", counts: { tenacity: 2 }, completedAt: "2026-08-17" },
    }, victim.cookie);

    const res = await post(h, "/api/admin/users", { action: "remove", email: victim.email }, organizer.cookie);

    // Before the fix this was a 500 with an empty body.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const db = h.db();
    try {
      const counts = {
        users: db.query("SELECT COUNT(*) n FROM users WHERE email = $e").get({ $e: victim.email }),
        threads: db.query("SELECT COUNT(*) n FROM threads WHERE user_email = $e").get({ $e: victim.email }),
        decisions: db.query("SELECT COUNT(*) n FROM decisions WHERE user_email = $e").get({ $e: victim.email }),
        checkins: db.query("SELECT COUNT(*) n FROM checkins WHERE user_email = $e").get({ $e: victim.email }),
        visits: db.query("SELECT COUNT(*) n FROM visits WHERE user_email = $e").get({ $e: victim.email }),
        genius: db.query("SELECT COUNT(*) n FROM working_genius WHERE user_email = $e").get({ $e: victim.email }),
        sessions: db.query("SELECT COUNT(*) n FROM sessions WHERE user_email = $e").get({ $e: victim.email }),
        invites: db.query("SELECT COUNT(*) n FROM invites WHERE user_email = $e").get({ $e: victim.email }),
      } as Record<string, { n: number }>;
      for (const [table, row] of Object.entries(counts)) {
        expect(`${table}=${row.n}`).toBe(`${table}=0`);
      }
      // Orphaned messages are the failure mode that would survive a naive fix.
      const orphans = db.query(
        "SELECT COUNT(*) n FROM messages WHERE thread_id NOT IN (SELECT id FROM threads)",
      ).get() as { n: number };
      expect(orphans.n).toBe(0);
    } finally {
      db.close();
    }
  });

  test("their session stops working immediately", async () => {
    const doomed = await createOrganizer(h, "doomed@example.test", "Doomed", "doomed-password-1");
    expect((await get(h, "/api/session", doomed.cookie)).status).toBe(200);
    expect((await (await get(h, "/api/session", doomed.cookie)).json()).user).not.toBeNull();

    await post(h, "/api/admin/users", { action: "remove", email: doomed.email }, organizer.cookie);

    const after = await get(h, "/api/session", doomed.cookie);
    expect((await after.json()).user).toBeNull();
  });

  test("errors always come back as JSON, never an empty body", async () => {
    const res = await post(h, "/api/admin/users", { action: "remove", email: "nobody@example.test" }, organizer.cookie);
    expect(res.status).toBe(404);
    const body = await res.json(); // would throw on an empty body
    expect(body.error).toBeTruthy();
  });

  test("the last organizer cannot be removed, and nobody can remove themselves", async () => {
    const self = await post(h, "/api/admin/users", { action: "remove", email: organizer.email }, organizer.cookie);
    expect(self.status).toBe(409);
    expect((await self.json()).error).toBeTruthy();
  });
});

describe("invite redemption", () => {
  test("a setup token works once", async () => {
    const db = h.db();
    let token: string;
    try {
      db.run("INSERT INTO users (email,name,role,created_at) VALUES ('once@example.test','Once','founder',datetime('now'))");
      token = crypto.randomUUID().replace(/-/g, "");
      db.run("INSERT INTO invites (token_hash,user_email,expires_at) VALUES ($t,'once@example.test',$e)", {
        $t: new Bun.CryptoHasher("sha256").update(token).digest("hex"), $e: new Date(Date.now() + 864e5).toISOString(),
      });
    } finally {
      db.close();
    }

    const first = await post(h, "/api/invite", { token, password: "first-password-1" });
    expect(first.status).toBe(200);

    const second = await post(h, "/api/invite", { token, password: "second-password-1" });
    expect(second.status).toBe(400);
  });

  test("redeeming revokes sessions opened with the old password", async () => {
    const user = await createOrganizer(h, "rotate@example.test", "Rotate", "rotate-password-1");
    expect((await (await get(h, "/api/session", user.cookie)).json()).user).not.toBeNull();

    const db = h.db();
    let token: string;
    try {
      token = crypto.randomUUID().replace(/-/g, "");
      db.run("INSERT INTO invites (token_hash,user_email,expires_at) VALUES ($t,$u,$e)", {
        $t: new Bun.CryptoHasher("sha256").update(token).digest("hex"), $u: user.email, $e: new Date(Date.now() + 864e5).toISOString(),
      });
    } finally {
      db.close();
    }

    await post(h, "/api/invite", { token, password: "rotated-password-1" });
    expect((await (await get(h, "/api/session", user.cookie)).json()).user).toBeNull();
  });
});
