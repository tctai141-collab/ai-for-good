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
export type SentEmail = { to: string; subject: string; text: string; replyTo?: string[] };

export type Harness = {
  url: string;
  dbPath: string;
  /** The stand-in Resend endpoint, for code driven inside the test process. */
  mailUrl: string;
  /** A fresh read/write connection to the scratch database, for assertions. */
  db(): Database;
  /** Every email the app tried to send, oldest first. */
  sent: SentEmail[];
  /** The most recent message to an address. */
  lastEmailTo(address: string): SentEmail | undefined;
  /** Everything the server has logged, for diagnosing a failing test. */
  serverOutput(): string;
  /** What was actually forwarded to the advisor API, system prompt included. */
  advisorCalls: {
    /** Every system block joined, i.e. what the model actually reads. */
    system: string;
    /** The blocks as sent, so caching breakpoints can be asserted. */
    systemBlocks: { type: string; text: string; cache_control?: { type: string } }[];
    messages: { role: string; content: string }[];
  }[];
  stop(): void;
};

/** Accounts are addressed by cookie; every helper returns one. */
export type Session = { cookie: string; email: string };

/**
 * Continuously drains a piped stream into a buffer.
 *
 * This has to keep reading for the life of the process, not just until the
 * startup line. A piped stream nobody reads fills its OS buffer, and the child
 * then blocks on its next write — which showed up as the server dying partway
 * through a test file with ConnectionRefused, once enough was being logged.
 * Keeping the output also means a failing test can show what the server said.
 */
function drain(stream: ReadableStream<Uint8Array>, sink: string[]): void {
  void (async () => {
    const decoder = new TextDecoder();
    try {
      for await (const chunk of stream) {
        sink.push(decoder.decode(chunk, { stream: true }));
        // Bound it: this is diagnostics, not a log store.
        if (sink.length > 500) sink.splice(0, sink.length - 500);
      }
    } catch {
      // Stream closed with the process.
    }
  })();
}

/**
 * Waits for the port the server actually bound.
 *
 * The harness picks the port rather than letting the OS assign it, which it
 * used to. That change is not cosmetic: setup links are now built only from a
 * configured PUBLIC_BASE_URL and never from a request header, because a header
 * is chosen by whoever sent the request and the link it lands in sets a
 * founder's password. With PORT=0 the harness could not know its own origin
 * before the child booted, so it cleared PUBLIC_BASE_URL and every test ran
 * down a fallback that production does not have.
 *
 * Picking the port has a race — another test file can take it between the
 * probe closing and the child binding — so `reservePort` retries rather than
 * pretending the race does not exist.
 */
async function waitForPort(output: string[], deadlineMs = 15_000): Promise<number> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const match = output.join("").match(/listening on https?:\/\/[^:]+:(\d+)/i);
    if (match) return Number(match[1]);
    if (Date.now() > deadline) {
      throw new Error(`server never reported a port. Output:\n${output.join("").slice(0, 2000)}`);
    }
    await Bun.sleep(25);
  }
}

/** A port nothing is listening on right now. Racy by nature; callers retry. */
async function reservePort(): Promise<number> {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
  const port = probe.port;
  await probe.stop(true);
  if (port == null) throw new Error("could not reserve a port");
  return port;
}

/** Thrown when the reserved port was taken before the child could bind it. */
class PortTaken extends Error {}

/**
 * Starts a server, retrying if the reserved port was stolen in between.
 *
 * Five attempts: the window is a few milliseconds wide and losing it five
 * times running would mean something other than chance.
 */
export async function startServer(
  options: { email?: boolean; advisorFails?: boolean; sprintStartDate?: string; checkinOpen?: boolean; workingGeniusOpen?: boolean } = {},
): Promise<Harness> {
  let last: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await startServerOnce(options);
    } catch (error) {
      if (!(error instanceof PortTaken)) throw error;
      last = error;
    }
  }
  throw last;
}

async function startServerOnce(
  options: { email?: boolean; advisorFails?: boolean; sprintStartDate?: string; checkinOpen?: boolean; workingGeniusOpen?: boolean } = {},
): Promise<Harness> {
  const port = await reservePort();
  const emailEnabled = options.email !== false;
  if (!(await Bun.file(ENTRY).exists())) {
    throw new Error(`${ENTRY} not found — run \`bun run build\` before \`bun test\`.`);
  }

  const dir = mkdtempSync(join(tmpdir(), "sprint-buddy-test-"));
  const dbPath = join(dir, "test.db");

  // A stand-in for the Resend API. Tests exercise the real delivery path —
  // including that the setup link leaves by email and not in a response body —
  // rather than a bypass that would let the real path rot untested.
  const sent: SentEmail[] = [];
  const mail = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as { to: string[]; subject: string; text: string; reply_to?: string[] };
      sent.push({ to: body.to[0]!, subject: body.subject, text: body.text, replyTo: body.reply_to });
      return Response.json({ id: crypto.randomUUID() });
    },
  });
  const mailUrl = `http://127.0.0.1:${mail.port}/emails`;

  // A stand-in for the Anthropic API, so the advisor path can be exercised
  // without reaching the real service. Returns a minimal non-streaming
  // Messages response; tests that care about the rate limit or the history cap
  // sit in front of this anyway.
  const advisorCalls: Harness["advisorCalls"] = [];
  const advisor = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as {
        system?: string | { type: string; text: string; cache_control?: { type: string } }[];
        messages: { role: string; content: string }[];
      };
      // The system prompt is captured too: what the advisor is told about the
      // cohort is exactly the thing that went wrong once. It is sent as blocks
      // so the persona can carry a cache breakpoint, so keep both the blocks
      // and the flattened text the model actually reads.
      const blocks = typeof body.system === "string"
        ? [{ type: "text", text: body.system }]
        : (body.system ?? []);
      advisorCalls.push({
        system: blocks.map((b) => b.text).join("\n\n"),
        systemBlocks: blocks,
        messages: body.messages ?? [],
      });
      if (options.advisorFails) {
        // The shape the audit caught being relayed to the browser verbatim.
        return new Response(
          "<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n" +
            "<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>cloudflare</center>\r\n</body>\r\n</html>",
          { status: 502, headers: { "Content-Type": "text/html" } },
        );
      }
      return Response.json({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "test",
        content: [{ type: "text", text: "A short reply." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    },
  });
  const advisorUrl = `http://127.0.0.1:${advisor.port}`;

  const proc = Bun.spawn(["bun", ENTRY], {
    env: {
      ...process.env,
      DB_PATH: dbPath,
      /*
       * Set, and set to this server's own origin.
       *
       * It used to be cleared, because with an OS-assigned port the harness
       * could not know its origin in advance. That left every test running
       * down a fallback production does not have: setup links are built only
       * from a configured origin now, and a run without one refuses to issue
       * one at all.
       */
      PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
      HOST: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "production",
      // Never a real key: no test may reach the live API.
      ANTHROPIC_API_KEY: "test-key-not-real",
      ANTHROPIC_BASE_URL: advisorUrl,
      // Future by default, which is the state the app is actually in and the
      // one that produced a bug. Tests that need a running sprint say so.
      SPRINT_START_DATE: options.sprintStartDate ?? "2026-09-09",
      /*
       * Stands the server on the far side of the check-in hold.
       *
       * Only the suites that drive a real check-in through /api/chat need it —
       * they assert that the check-in framing, which carries the current
       * server time, never lands in the cached prompt prefix, and the hold
       * otherwise refuses the request before the model is reached. Everything
       * else runs with the hold on, which is what production has.
       */
      ...(options.checkinOpen ? { CHECKIN_OPENS_AT_OVERRIDE: "0" } : {}),
      /*
       * Stands the server past the working-style hold.
       *
       * Several suites take the assessment end to end — privacy, retakes, the
       * team map — and every one needs the save to reach the database. On by
       * default here, because the hold is a launch-week decision and not the
       * behaviour those suites are about; the tests that care about the hold
       * itself leave it off and assert the 423.
       */
      ...(options.workingGeniusOpen === false ? {} : { WORKING_GENIUS_OPENS_AT_OVERRIDE: "0" }),
      // Omitted entirely when a test needs the unconfigured case.
      ...(emailEnabled
        ? {
            RESEND_API_KEY: "test-key-not-real",
            RESEND_FROM: "Sprint Buddy Test <no-reply@send.example.test>",
            RESEND_REPLY_TO: "sprint-team@example.test",
            RESEND_BASE_URL: mailUrl,
          }
        : { RESEND_API_KEY: "", RESEND_FROM: "", RESEND_REPLY_TO: "", RESEND_BASE_URL: "" }),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const output: string[] = [];
  drain(proc.stdout as ReadableStream<Uint8Array>, output);
  drain(proc.stderr as ReadableStream<Uint8Array>, output);

  /*
   * Two ways to lose the port, and both have to retry rather than fail.
   *
   * The child prints the port it bound, so a *different* number means
   * something took ours in between. But the commoner shape is that the child
   * cannot bind at all and prints nothing — and without this that became a
   * fifteen-second wait ending in a hard error, which is a flaky suite rather
   * than a slow one. A short deadline here is right because the port is known
   * in advance: the child either binds it in a moment or is not going to.
   */
  let bound: number;
  try {
    bound = await waitForPort(output, 4_000);
  } catch {
    proc.kill();
    throw new PortTaken();
  }
  if (bound !== port) {
    proc.kill();
    throw new PortTaken();
  }
  const url = `http://127.0.0.1:${port}`;

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
    mailUrl,
    sent,
    advisorCalls,
    serverOutput: () => output.join(""),
    db: () => {
      const connection = new Database(dbPath);
      // foreign_keys is per-connection, not a property of the file. Without
      // this, assertions about cascade behaviour silently pass on a connection
      // that is not enforcing the constraints the app runs under.
      connection.run("PRAGMA foreign_keys=ON");
      return connection;
    },
    lastEmailTo: (address: string) => [...sent].reverse().find((m) => m.to === address),
    stop() {
      proc.kill();
      mail.stop(true);
      advisor.stop(true);
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
      // A browser always sends Origin on an unsafe method, and the middleware
      // now rejects requests that do not. Omitting it here would have every
      // test exercising a path no real client takes. Tests that deliberately
      // probe the cross-site check build their own requests instead.
      origin: h.url,
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
/**
 * The seeded organizer's setup token.
 *
 * Reads from memory, not the database. Invites are stored as SHA-256, so the
 * emailed value cannot be recovered from a row any more — which is the whole
 * point of the change, and worth a test helper that cannot quietly regress it.
 */
const seededTokens = new Map<string, string>();

export function inviteToken(_h: Harness, email: string): string {
  const token = seededTokens.get(email);
  if (!token) throw new Error(`no seeded invite for ${email}`);
  return token;
}

/** The token from the setup link as the founder actually received it. */
export function tokenFromEmail(h: Harness, address: string): string | null {
  const message = h.lastEmailTo(address);
  const match = message?.text.match(/\/setup\?token=([a-f0-9]+)/);
  return match ? match[1]! : null;
}

/**
 * Redeems an invite, then signs in with the password it just set.
 *
 * Two calls, because that is now two steps for a real founder: redeeming a
 * setup link no longer opens a session. It used to, and this helper used to
 * read the cookie straight off the redemption response.
 */
export async function activate(h: Harness, email: string, password: string): Promise<Session> {
  const token = tokenFromEmail(h, email) ?? inviteToken(h, email);
  const redeemed = await post(h, "/api/invite", { token, password });
  if (!redeemed.ok) throw new Error(`activation failed for ${email}: ${await redeemed.text()}`);

  const signedIn = await post(h, "/api/session", { action: "login", email, password });
  if (!signedIn.ok) throw new Error(`sign-in after activation failed for ${email}: ${await signedIn.text()}`);
  return { cookie: sessionCookie(signedIn), email };
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
  role: "organizer" | "mentor" = "organizer",
): Promise<Session> {
  const db = h.db();
  try {
    db.run(
      `INSERT INTO users (email, name, role, created_at) VALUES ($email, $name, $role, datetime('now'))`,
      { $email: email, $name: name, $role: role },
    );
    // Invites are stored hashed, exactly as production stores them, so this
    // helper has to hash too. The raw token stays in memory here because that
    // is the only place it can live — it is unrecoverable from the row.
    const token = crypto.randomUUID().replace(/-/g, "");
    db.run(
      "INSERT INTO invites (token_hash, user_email, expires_at) VALUES ($hash, $email, $expires)",
      {
        $hash: new Bun.CryptoHasher("sha256").update(token).digest("hex"),
        $email: email,
        $expires: new Date(Date.now() + 14 * 864e5).toISOString(),
      },
    );
    seededTokens.set(email, token);
  } finally {
    db.close();
  }
  return activate(h, email, password);
}

/**
 * A mentor: reads the cohort, runs none of it.
 *
 * Seeded the same way an organizer is, because there is no API that creates
 * one without an organizer already existing, and half these tests are about
 * what a mentor may do to an organizer's cohort.
 */
export function createMentor(
  h: Harness,
  email: string,
  name = "Test Mentor",
  password = "mentor-password-11",
): Promise<Session> {
  return createOrganizer(h, email, name, password, "mentor");
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
