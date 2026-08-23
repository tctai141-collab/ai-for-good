import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createFounder, createOrganizer, get, startServer, type Harness, type Session } from "./helpers/harness";

/**
 * Sessions are stored as SHA-256 of the cookie value, so a test poking at the
 * row has to hash the same way production does. If this drifts, the tests
 * silently match nothing and pass for the wrong reason.
 */
function sessionKey(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

/**
 * Session lifetime: a rolling idle window and an absolute ceiling.
 *
 * It used to be a single fixed 30 days from login with no idle expiry, so a
 * founder who signed in on a shared university machine and walked away left a
 * working session behind for a month.
 *
 * These tests move the clock by editing the row rather than by waiting, which
 * is the only way to test a 24-hour window in a suite that has to finish in
 * seconds. The deadlines are read from the database on every request, so
 * rewriting them is a faithful simulation of time passing.
 */

let h: Harness;
let organizer: Session;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function inFuture(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function tokenOf(session: Session): string {
  return session.cookie.split("=")[1]!;
}

/** Rewrites a session's deadlines in place. */
function setDeadlines(session: Session, fields: { expiresAt?: string; createdAt?: string }): void {
  const db = h.db();
  try {
    if (fields.expiresAt) {
      db.run("UPDATE sessions SET expires_at = $v WHERE token_hash = $t", { $v: fields.expiresAt, $t: sessionKey(tokenOf(session)) });
    }
    if (fields.createdAt) {
      db.run("UPDATE sessions SET created_at = $v WHERE token_hash = $t", { $v: fields.createdAt, $t: sessionKey(tokenOf(session)) });
    }
  } finally {
    db.close();
  }
}

function readSession(session: Session): { expires_at: string; created_at: string } | null {
  const db = h.db();
  try {
    return db
      .query("SELECT expires_at, created_at FROM sessions WHERE token_hash = $t")
      .get({ $t: sessionKey(tokenOf(session)) }) as { expires_at: string; created_at: string } | null;
  } finally {
    db.close();
  }
}

async function signedIn(session: Session): Promise<boolean> {
  const body = (await (await get(h, "/api/session", session.cookie)).json()) as { user: unknown };
  return body.user !== null;
}

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
});

afterAll(() => h?.stop());

describe("idle timeout", () => {
  test("a fresh session is good for about a day, not a month", async () => {
    const founder = await createFounder(h, organizer, "fresh@example.test", "Fresh", "fresh-password-112");
    const row = readSession(founder)!;
    const window = new Date(row.expires_at).getTime() - Date.now();

    expect(window).toBeGreaterThan(23 * HOUR);
    expect(window).toBeLessThanOrEqual(25 * HOUR);
    // The regression this guards: a 30-day idle window.
    expect(window).toBeLessThan(2 * DAY);
  });

  test("a session left untouched past the window stops working", async () => {
    const founder = await createFounder(h, organizer, "idle@example.test", "Idle", "idle-password-1122");
    setDeadlines(founder, { expiresAt: ago(1 * HOUR) });

    expect(await signedIn(founder)).toBe(false);
  });

  test("an expired session is deleted, not just refused", async () => {
    const founder = await createFounder(h, organizer, "swept@example.test", "Swept", "swept-password-11");
    setDeadlines(founder, { expiresAt: ago(1 * HOUR) });

    await signedIn(founder);
    expect(readSession(founder)).toBeNull();
  });

  test("using the app slides the window forward", async () => {
    const founder = await createFounder(h, organizer, "active@example.test", "Active", "active-password-11");
    // Most of the window spent, which is when the extension is due.
    setDeadlines(founder, { expiresAt: inFuture(2 * HOUR) });

    expect(await signedIn(founder)).toBe(true);

    const after = new Date(readSession(founder)!.expires_at).getTime() - Date.now();
    expect(after).toBeGreaterThan(23 * HOUR);
  });

  test("does not write on every request", async () => {
    // A write per API call would be several per screen. The window is only
    // extended once it is more than half gone.
    const founder = await createFounder(h, organizer, "quiet@example.test", "Quiet", "quiet-password-112");
    const before = readSession(founder)!.expires_at;

    expect(await signedIn(founder)).toBe(true);

    expect(readSession(founder)!.expires_at).toBe(before);
  });
});

describe("absolute ceiling", () => {
  test("an old session expires however active it has been", async () => {
    const founder = await createFounder(h, organizer, "ancient@example.test", "Ancient", "ancient-password-1");
    // Idle deadline is healthy — this session has been used constantly — but it
    // was created a fortnight ago.
    setDeadlines(founder, { createdAt: ago(15 * DAY), expiresAt: inFuture(20 * HOUR) });

    expect(await signedIn(founder)).toBe(false);
    expect(readSession(founder)).toBeNull();
  });

  test("a session just inside the ceiling still works", async () => {
    const founder = await createFounder(h, organizer, "recent@example.test", "Recent", "recent-password-11");
    setDeadlines(founder, { createdAt: ago(13 * DAY), expiresAt: inFuture(20 * HOUR) });

    expect(await signedIn(founder)).toBe(true);
  });

  test("sliding the idle window cannot push past the ceiling", async () => {
    // The failure mode worth naming: if extension ignored created_at, a daily
    // user would hold one session forever and the ceiling would mean nothing.
    const founder = await createFounder(h, organizer, "forever@example.test", "Forever", "forever-password-1");
    setDeadlines(founder, { createdAt: ago(14 * DAY + HOUR), expiresAt: inFuture(1 * HOUR) });

    expect(await signedIn(founder)).toBe(false);
  });

  test("reads created_at as UTC, not as local time", async () => {
    /*
     * SQLite writes datetime('now') as "YYYY-MM-DD HH:MM:SS" with no zone
     * marker, and Date parses that as local time. In Helsinki that is two or
     * three hours off in summer — enough to expire a session early or late.
     * A session created "now" in SQLite's own format must be treated as young.
     */
    const founder = await createFounder(h, organizer, "utc@example.test", "Utc", "utc-password-11223");
    const db = h.db();
    try {
      db.run("UPDATE sessions SET created_at = datetime('now') WHERE token_hash = $t", { $t: sessionKey(tokenOf(founder)) });
    } finally {
      db.close();
    }

    expect(await signedIn(founder)).toBe(true);
  });
});
