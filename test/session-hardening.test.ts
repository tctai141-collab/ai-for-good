import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createFounder, createOrganizer, post, startServer, type Harness, type Session } from "./helpers/harness";

/**
 * The properties that make a hand-rolled session scheme safe.
 *
 * No library is checking any of this, so each one is asserted directly. The
 * threat assumed throughout is the realistic one for two dozen known users: an
 * attacker who already holds a low-privilege account, or a copy of the
 * database, and wants either somebody else's session or somebody else's
 * password.
 */

let h: Harness;
let organizer: Session;
let founder: Session;

const sha256 = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");
const tokenOf = (s: Session) => s.cookie.split("=")[1]!.split(";")[0]!;

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
  founder = await createFounder(h, organizer, "founder@example.test", "Aino", "founder-password-11");
});

afterAll(() => h?.stop());

describe("what the database holds", () => {
  test("a session row stores the hash, never the cookie value", () => {
    /*
     * The finding this closes. Backups are gzipped and unencrypted, thirty
     * days of them in object storage; when the row held the token itself, one
     * leaked snapshot was a working credential for every signed-in person.
     */
    const raw = tokenOf(founder);
    const db = h.db();
    try {
      const rows = db.query("SELECT token_hash FROM sessions").all() as { token_hash: string }[];
      expect(rows.length).toBeGreaterThan(0);
      // The hash is present...
      expect(rows.some((r) => r.token_hash === sha256(raw))).toBe(true);
      // ...and the value the browser holds is nowhere in the table.
      expect(rows.some((r) => r.token_hash === raw)).toBe(false);
      expect(JSON.stringify(rows)).not.toContain(raw);
    } finally {
      db.close();
    }
  });

  test("an invite row stores the hash, never the emailed token", () => {
    // A setup link claims an account outright, so a readable copy of this
    // column is worth more to an attacker than a session is.
    const db = h.db();
    try {
      const columns = db.query("PRAGMA table_info(invites)").all() as { name: string }[];
      expect(columns.map((c) => c.name)).toContain("token_hash");
      expect(columns.map((c) => c.name)).not.toContain("token");
    } finally {
      db.close();
    }
  });

  test("a stolen hash is not a usable cookie", async () => {
    // Presenting the stored value as the cookie must fail: the server hashes
    // whatever it is given, so the hash of a hash matches nothing.
    const stolen = sha256(tokenOf(founder));
    const res = await post(h, "/api/persistence", {
      action: "save-thread",
      userEmail: founder.email,
      thread: { id: "x", title: "x", theme: "t", state: "thinking", lastAt: "now", messages: [] },
    }, `sb_session=${stolen}`);
    expect(res.status).toBeGreaterThanOrEqual(401);
  });
});

describe("signing in again", () => {
  test("the previous session row is retired, not left live", async () => {
    const before = tokenOf(founder);
    const db = h.db();
    let liveBefore = 0;
    try {
      liveBefore = (db.query("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = $h")
        .get({ $h: sha256(before) }) as { n: number }).n;
    } finally { db.close(); }
    expect(liveBefore).toBe(1);

    // Sign in again carrying the old cookie, as a browser would.
    const res = await fetch(`${h.url}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: h.url, cookie: founder.cookie },
      body: JSON.stringify({ email: founder.email, password: "founder-password-11" }),
    });
    expect(res.status).toBe(200);

    const db2 = h.db();
    try {
      const stillThere = (db2.query("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = $h")
        .get({ $h: sha256(before) }) as { n: number }).n;
      expect(stillThere).toBe(0);
    } finally { db2.close(); }
  });
});

describe("brute force", () => {
  test("one address grinding many accounts is stopped", async () => {
    /*
     * The attack the per-email limit alone does not see: two dozen known
     * addresses, one common password, from one machine. Each account stays
     * well under its own limit while the machine racks up attempts.
     */
    const attacker = "203.0.113.9";
    const attempt = (email: string) =>
      fetch(`${h.url}/api/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: h.url,
          "x-forwarded-for": `${attacker}, 10.0.0.1`,
        },
        body: JSON.stringify({ email, password: "Password123" }),
      });

    let sawLimit = false;
    for (let i = 0; i < 40 && !sawLimit; i++) {
      // A different address each time, so no per-email counter ever fills.
      const res = await attempt(`victim${i}@example.test`);
      if (res.status === 429) sawLimit = true;
    }
    expect(sawLimit).toBe(true);
  });

  test("a different address is unaffected by that lockout", async () => {
    // The limit must bite the attacker, not the cohort behind another NAT.
    const res = await fetch(`${h.url}/api/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: h.url,
        "x-forwarded-for": "198.51.100.4",
      },
      body: JSON.stringify({ email: "someone-else@example.test", password: "wrong-password-1" }),
    });
    expect(res.status).toBe(401);
  });
});
