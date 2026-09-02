import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createFounder, createOrganizer, post, startServer, type Harness, type Session } from "./helpers/harness";
/* From limits.ts, not auth.ts: auth.ts opens the database on import, and a
   second connection in the test runner's own process breaks whichever suite
   runs next. */
import { IP_FAILURE_LIMIT } from "../src/lib/limits";

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

describe("what this file may import", () => {
  test("limits.ts stays free of imports, so a test can read it safely", () => {
    /*
     * This is the whole reason IP_FAILURE_LIMIT lives there. auth.ts opens the
     * database at module load; importing it here opened a second connection in
     * the test runner's own process, against a path no test had set, and CI
     * failed with "unable to open database file" in an unrelated suite three
     * files later. The first import added to limits.ts brings that back.
     */
    const src = readFileSync("src/lib/limits.ts", "utf-8");
    expect(src).not.toMatch(/^\s*import[\s{]/m);
    expect(src).toContain("export const IP_FAILURE_LIMIT");
  });

  test("no other suite pulls the database module into the runner's own process", () => {
    /*
     * The guard the comment above only described, after this trap bit twice
     * more from two new directions: a test importing src/lib/auth for the
     * address throttle, and a test importing src/lib/reminders to compare it
     * against the tracker. Both are reasonable-looking, and both are the bug.
     *
     * db/index.ts resolves DB_PATH once, at module load, and `bun test` loads
     * every file into one process. So the first suite to pull that module in
     * fixes the path for all of them, and reminders.test.ts, which sets DB_PATH
     * and *then* imports precisely because of this, gets the cached module and
     * the default path. On a fresh checkout there is no ./data to open, and
     * sixteen unrelated tests fail with SQLITE_CANTOPEN. On any machine that
     * has ./data, everything passes, which is what makes it a CI-only failure
     * and worth pinning here rather than rediscovering.
     *
     * reminders.test.ts is the one file allowed to do it, and only after it
     * has set the environment.
     */
    /*
     * The reachable set is computed rather than listed, because a hand-kept
     * list is wrong the moment somebody adds an import. src/lib/backup and
     * src/lib/persistence both look like they should be on it and are not;
     * neither reaches db/index. db/schema does not either, since it is handed
     * a Database and resolves no path of its own.
     */
    const resolveSpec = (spec: string, fromFile: string): string | null => {
      if (!spec.startsWith(".")) return null;
      const base = join(fromFile, "..", spec).replace(/\\/g, "/");
      for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
        if (existsSync(candidate)) return candidate;
      }
      return null;
    };

    /** Every module a file pulls in at runtime, following relative imports. */
    const reachesDb = (entry: string): boolean => {
      const seen = new Set<string>();
      const queue = [entry];
      while (queue.length) {
        const file = queue.shift()!;
        if (seen.has(file)) continue;
        seen.add(file);
        if (file === "src/db/index.ts") return true;
        const src = readFileSync(file, "utf-8");
        // Value imports only. `import type` is erased and loads nothing.
        for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;'"]*from\s*["']([^"']+)["']/g)) {
          const next = resolveSpec(m[1]!, file);
          if (next) queue.push(next);
        }
        for (const m of src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
          const next = resolveSpec(m[1]!, file);
          if (next) queue.push(next);
        }
      }
      return false;
    };

    const offenders = readdirSync("test")
      .filter((f) => f.endsWith(".test.ts") && f !== "reminders.test.ts")
      .filter((f) => reachesDb(join("test", f)));

    expect(offenders).toEqual([]);
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

    /*
     * Exactly the boundary, rather than up to forty tries stopping at the
     * first 429. Every attempt costs a full Argon2id verify — the endpoint
     * spends one even for an address that does not exist, so a miss cannot be
     * told from a hit by timing — so the old loop's cost depended on a number
     * it never knew. It ran right on the 5s default timeout and failed under a
     * loaded machine while passing on its own.
     */
    for (let i = 0; i < IP_FAILURE_LIMIT; i++) {
      // A different address each time, so no per-email counter ever fills.
      const res = await attempt(`victim${i}@example.test`);
      expect(res.status).toBe(401);
    }
    expect((await attempt("victim-last@example.test")).status).toBe(429);
    /*
     * The timeout is explicit for the same reason: this test is inherently
     * IP_FAILURE_LIMIT + 1 sequential password verifies, and the work is the
     * point. Argon2id is meant to be slow.
     */
  }, 30_000);

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
