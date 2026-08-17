import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Integration-test harness.
 *
 * Runs the real production build against a throwaway SQLite database and talks
 * to it over HTTP, because that is the layer the audit findings live at. The
 * cross-tenant bugs were all invisible to anything that called the db module
 * directly — they only appear when a real session cookie meets a request body
 * carrying somebody else's record id.
 *
 * Requires `bun run build` to have been run first; CI does that before tests.
 */

const ENTRY = "dist/server/entry.mjs";

/** One message captured by the stand-in Resend endpoint. */
export type SentEmail = { to: string; subject: string; text: string };

export type Harness = {
  url: string;
  dbPath: string;
  /** A fresh read/write connection to the scratch database, for assertions. */
  db(): Database;
  /** Every email the app tried to send, oldest first. */
  sent: SentEmail[];
  /** The most recent message to an address. */
  lastEmailTo(address: string): SentEmail | undefined;
  stop(): void;
};

/** Accounts are addressed by cookie; every helper returns one. */
export type Session = { cookie: string; email: string };

function freePort(): number {
  // Bind to 0 to let the OS choose, then release it. A race is possible but
  // vanishingly unlikely across a handful of test files.
  const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = server.port;
  server.stop(true);
  return port;
}

export async function startServer(options: { email?: boolean } = {}): Promise<Harness> {
  const emailEnabled = options.email !== false;
  if (!(await Bun.file(ENTRY).exists())) {
    throw new Error(`${ENTRY} not found — run \`bun run build\` before \`bun test\`.`);
  }

  const dir = mkdtempSync(join(tmpdir(), "sprint-buddy-test-"));
  const dbPath = join(dir, "test.db");
  const port = freePort();
  const url = `http://127.0.0.1:${port}`;

  // A stand-in for the Resend API. Tests exercise the real delivery path —
  // including that the setup link leaves by email and not in a response body —
  // rather than a bypass that would let the real path rot untested.
  const sent: SentEmail[] = [];
  const mail = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as { to: string[]; subject: string; text: string };
      sent.push({ to: body.to[0]!, subject: body.subject, text: body.text });
      return Response.json({ id: crypto.randomUUID() });
    },
  });
  const mailUrl = `http://127.0.0.1:${mail.port}/emails`;

  const proc = Bun.spawn(["bun", ENTRY], {
    env: {
      ...process.env,
      DB_PATH: dbPath,
      HOST: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "production",
      PUBLIC_BASE_URL: url,
      // Never a real key: no test may reach the live API.
      ANTHROPIC_API_KEY: "test-key-not-real",
      SPRINT_START_DATE: "2026-09-09",
      // Omitted entirely when a test needs the unconfigured case.
      ...(emailEnabled
        ? {
            RESEND_API_KEY: "test-key-not-real",
            RESEND_FROM: "Sprint Buddy Test <test@example.test>",
            RESEND_BASE_URL: mailUrl,
          }
        : { RESEND_API_KEY: "", RESEND_FROM: "", RESEND_BASE_URL: "" }),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const deadline = Date.now() + 15_000;
  for (;;) {
    if (Date.now() > deadline) {
      proc.kill();
      throw new Error("server did not become ready within 15s");
    }
    try {
      // A bogus cookie forces the session lookup to open the database, which
      // is what creates the schema — it is initialised lazily on first use, so
      // an unauthenticated probe alone would leave the file empty.
      const res = await fetch(`${url}/api/session`, { headers: { cookie: "sb_session=not-a-real-token" } });
      if (res.ok) break;
    } catch {
      // not listening yet
    }
    await Bun.sleep(50);
  }

  return {
    url,
    dbPath,
    sent,
    db: () => new Database(dbPath),
    lastEmailTo: (address: string) => [...sent].reverse().find((m) => m.to === address),
    stop() {
      proc.kill();
      mail.stop(true);
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best effort; the OS temp dir is disposable
      }
    },
  };
}

/** Pulls the session cookie out of a Set-Cookie header. */
function sessionCookie(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  const match = raw.match(/sb_session=([^;]+)/);
  if (!match) throw new Error("no session cookie in response");
  return `sb_session=${match[1]}`;
}

export async function post(h: Harness, path: string, body: unknown, cookie?: string) {
  return fetch(`${h.url}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

export async function get(h: Harness, path: string, cookie?: string) {
  return fetch(`${h.url}${path}`, { headers: cookie ? { cookie } : {} });
}

/**
 * Reads the outstanding invite token straight from the database.
 *
 * Deliberately not scraped from the API response: after the reset-link fix the
 * token is emailed to the founder and never returned to any caller, so a helper
 * that parsed the response body would break the moment that landed.
 */
export function inviteToken(h: Harness, email: string): string {
  const db = h.db();
  try {
    const row = db
      .query("SELECT token FROM invites WHERE user_email = $email ORDER BY rowid DESC LIMIT 1")
      .get({ $email: email }) as { token: string } | null;
    if (!row) throw new Error(`no invite for ${email}`);
    return row.token;
  } finally {
    db.close();
  }
}

/** The token from the setup link as the founder actually received it. */
export function tokenFromEmail(h: Harness, address: string): string | null {
  const message = h.lastEmailTo(address);
  const match = message?.text.match(/\/setup\?token=([a-f0-9]+)/);
  return match ? match[1]! : null;
}

/** Redeems an invite and returns the resulting signed-in session. */
export async function activate(h: Harness, email: string, password: string): Promise<Session> {
  const token = tokenFromEmail(h, email) ?? inviteToken(h, email);
  const res = await post(h, "/api/invite", { token, password });
  if (!res.ok) throw new Error(`activation failed for ${email}: ${await res.text()}`);
  return { cookie: sessionCookie(res), email };
}

/**
 * Bootstraps the first organizer the way `scripts/create-organizer.ts` does —
 * by writing the row directly, because the admin API needs an organizer to
 * already exist.
 */
export async function createOrganizer(
  h: Harness,
  email: string,
  name = "Test Organizer",
  password = "organizer-password-1",
): Promise<Session> {
  const db = h.db();
  try {
    db.run(
      "INSERT INTO users (email, name, role, created_at) VALUES ($email, $name, 'organizer', datetime('now'))",
      { $email: email, $name: name },
    );
    const token = crypto.randomUUID().replace(/-/g, "");
    db.run(
      "INSERT INTO invites (token, user_email, expires_at) VALUES ($token, $email, $expires)",
      {
        $token: token,
        $email: email,
        $expires: new Date(Date.now() + 14 * 864e5).toISOString(),
      },
    );
  } finally {
    db.close();
  }
  return activate(h, email, password);
}

/** Creates a founder through the real admin API, then activates them. */
export async function createFounder(
  h: Harness,
  organizer: Session,
  email: string,
  name = "Test Founder",
  password = "founder-password-1",
): Promise<Session> {
  const res = await post(h, "/api/admin/users", { action: "add", email, name, role: "founder" }, organizer.cookie);
  if (!res.ok) throw new Error(`could not create ${email}: ${await res.text()}`);
  return activate(h, email, password);
}

/** Convenience: one organizer plus two founders, the shape most tests need. */
export async function twoFounders(h: Harness) {
  const organizer = await createOrganizer(h, "organizer@example.test");
  const alice = await createFounder(h, organizer, "alice@example.test", "Alice", "alice-password-11");
  const bob = await createFounder(h, organizer, "bob@example.test", "Bob", "bob-password-1122");
  return { organizer, alice, bob };
}
