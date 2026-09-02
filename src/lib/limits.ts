/**
 * Request limits.
 *
 * Two findings share this file. Neither needs infrastructure — the app is one
 * instance serving about two dozen known people — but both were unbounded,
 * and "small, trusted cohort" is not a limit.
 *
 * H-2: no request body cap anywhere. A 20 MB body was accepted in 112 ms onto
 * a 1 GB disk; roughly fifty of those fill it and take down the app and the
 * database together.
 *
 * H-3: no rate limit on the advisor endpoint, which costs real money per call,
 * and no cap on the conversation history forwarded upstream.
 */

/** 1 MB. Comfortably above a long conversation, far below a disk-filler. */
export const MAX_BODY_BYTES = 1_000_000;

/** Per-field caps, applied after parsing so oversized rows never reach SQLite. */
export const MAX_MESSAGE_CHARS = 20_000;
export const MAX_MESSAGES_PER_THREAD = 500;
export const MAX_TITLE_CHARS = 300;

/**
 * One free-text answer on the working-style assessment.
 *
 * Generous enough for the conditional someone actually wants to describe
 * ("usually X, but when the team is under time pressure, Y"), short enough that
 * thirty of them cannot fill a row. The box on screen is a single line that
 * grows, which does more to keep answers short than any limit.
 */
export const MAX_WG_TEXT_CHARS = 600;
export const MAX_SUMMARY_CHARS = 2_000;

/** What actually gets forwarded to the paid API on any one call. */
export const MAX_HISTORY_MESSAGES = 40;
export const MAX_HISTORY_CHARS = 60_000;

/** Advisor calls per user per window. Generous for a person, useless for a script. */
export const CHAT_RATE_LIMIT = 20;
export const CHAT_RATE_WINDOW_MS = 60_000;

/**
 * A fixed-window counter, bounded on purpose.
 *
 * The login throttle this is modelled on grew without limit: it recorded a
 * failure for every email tried, including addresses that do not exist, and
 * only ever evicted an entry when that same address came back. An attacker
 * choosing fresh addresses grew it forever. This one evicts expired entries
 * whenever it passes a size threshold, and hard-caps total size.
 */
const MAX_TRACKED_KEYS = 5_000;
/** Sweeps clear down to here, so the next few hundred calls need no sweep. */
const LOW_WATER_MARK = 4_000;

type Window = { count: number; resetAt: number };

export class RateLimiter {
  private hits = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records a hit. Returns how long to wait, or null when it is allowed. */
  check(key: string, now = Date.now()): { retryAfterSeconds: number } | null {
    this.evictExpired(now);

    const existing = this.hits.get(key);
    if (!existing || now >= existing.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return null;
    }

    if (existing.count >= this.limit) {
      return { retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
    }

    existing.count += 1;
    return null;
  }

  /** Clears a key — used when a login succeeds. */
  clear(key: string): void {
    this.hits.delete(key);
  }

  /**
   * Keeps the map bounded without scanning it on every call.
   *
   * The obvious version — sweep whenever we are at capacity — is O(n) per
   * request precisely when the map is full, which is exactly when an attack is
   * in progress. That turns a memory-exhaustion defence into a CPU-exhaustion
   * hole. Instead, a sweep clears down to a low-water mark, so the next few
   * hundred calls return immediately and the cost is amortised to O(1).
   */
  private evictExpired(now: number): void {
    if (this.hits.size < MAX_TRACKED_KEYS) return;

    for (const [key, window] of this.hits) {
      if (now >= window.resetAt) this.hits.delete(key);
    }

    // Still full of live windows: this is an attack, not traffic. Map iteration
    // is insertion-ordered, so the oldest entries go first.
    if (this.hits.size >= LOW_WATER_MARK) {
      let toDrop = this.hits.size - LOW_WATER_MARK;
      for (const key of this.hits.keys()) {
        if (toDrop-- <= 0) break;
        this.hits.delete(key);
      }
    }
  }

  /** Test/telemetry only. */
  get size(): number {
    return this.hits.size;
  }
}

export const chatLimiter = new RateLimiter(CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS);

/**
 * Writes by the operating team.
 *
 * Not because organizers are suspected — because an organizer session is the
 * most valuable thing an attacker can take here, and until now it was the one
 * that could act without limit. Two things were reachable in a loop with no
 * ceiling: creating accounts, which sends an invite email each time and can
 * burn a sending reputation and a quota from one stolen cookie, and writing
 * rows, which fills a 1 GB disk that the database also lives on.
 *
 * Sixty a minute is far above the pace of a person filling in a form and far
 * below the pace of a script. Broadcast is not covered by it and does not need
 * to be: it already refuses to send anything the sender has not first received
 * themselves.
 */
export const ADMIN_WRITE_LIMIT = 60;
export const ADMIN_WRITE_WINDOW_MS = 60_000;
export const adminWriteLimiter = new RateLimiter(ADMIN_WRITE_LIMIT, ADMIN_WRITE_WINDOW_MS);

/** The 429 every limiter hands back, so the wording cannot drift. */
export function tooMany(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({ error: "That is a lot of requests very quickly. Give it a moment." }),
    {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": String(retryAfterSeconds) },
    },
  );
}

/** Trims a string to a cap, preserving the front. */
export function cap(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * Trims a conversation to what is worth sending: the most recent turns, under
 * a total character budget. Keeps the tail, because that is the live part of
 * the conversation — the model is being asked about now, not the opening.
 */
export function capHistory<T extends { role: string; content: string }>(messages: T[]): T[] {
  const recent = messages.slice(-MAX_HISTORY_MESSAGES);

  let total = 0;
  const kept: T[] = [];
  for (let i = recent.length - 1; i >= 0; i--) {
    const message = recent[i]!;
    const content = typeof message.content === "string" ? message.content : "";
    const length = content.length;
    if (total + length > MAX_HISTORY_CHARS && kept.length > 0) break;
    kept.unshift(
      length > MAX_MESSAGE_CHARS ? ({ ...message, content: content.slice(0, MAX_MESSAGE_CHARS) } as T) : message,
    );
    total += Math.min(length, MAX_MESSAGE_CHARS);
  }
  return kept;
}

/**
 * How many failed sign-ins one address gets inside the lockout window.
 *
 * Here rather than beside the lockout itself in auth.ts, because the test that
 * asserts the boundary has to import it, and auth.ts opens the database on the
 * way in. In the test runner's own process that means a second connection to a
 * path no test has set, which CI turns into "unable to open database file" in
 * whichever unrelated suite happens to run next. This file imports nothing.
 *
 * Deliberately looser than the per-email limit. A shared office NAT can put
 * the whole cohort behind one address, and locking out a room of founders
 * because one of them fumbled a password is a worse failure than the attack.
 */
export const IP_FAILURE_LIMIT = 30;


/**
 * How long a per-address lockout lasts. Matches the per-email window in
 * auth.ts; they are the same policy seen from two angles.
 */
export const IP_LOCKOUT_MS = 15 * 60 * 1000;

/*
 * Per-address login throttle, alongside the per-email one in auth.ts.
 *
 * The per-email limit alone stops somebody grinding one account, and does
 * nothing about the attack that actually fits this app: twenty-four known
 * addresses, ten tries each, one common password. That is 240 guesses from a
 * single machine without ever tripping a limit. This caps the machine.
 *
 * It lives here rather than in auth.ts, and that is not tidiness. auth.ts
 * imports the database module, and db/index.ts resolves DB_PATH once, at
 * module load; so a test importing auth.ts freezes that path for the whole
 * runner process, and reminders.test.ts, which sets DB_PATH and then
 * dynamically imports, dies with "unable to open database file". This file
 * imports nothing, which is the property that keeps the throttle testable.
 */
const ipFailures = new Map<string, { count: number; firstAt: number }>();
const MAX_TRACKED_IPS = 5_000;
/** Sweeps clear down to here, so the next few hundred calls need no sweep. */
const IP_LOW_WATER = 4_000;

/**
 * Records one failure against a key, keeping the map ordered by recency.
 *
 * The reordering is what makes eviction safe. Map iteration is insertion
 * ordered and mutating a value does not change that, so without the delete an
 * address that started failing early sits at the front forever and is the first
 * thing dropped when room is needed. That is precisely backwards, because it
 * is the one still attacking. Re-inserting on every bump turns the order into
 * least-recently-active first, so what gets dropped is what has gone quiet.
 */
function bumpIpWindow(
  map: Map<string, { count: number; firstAt: number }>,
  key: string,
  now: number,
): void {
  const record = map.get(key);
  if (!record || now - record.firstAt > IP_LOCKOUT_MS) {
    map.delete(key);
    map.set(key, { count: 1, firstAt: now });
    return;
  }
  record.count += 1;
  map.delete(key);
  map.set(key, record);
}

export function isIpLockedOut(ip: string | null): boolean {
  if (!ip) return false;
  const record = ipFailures.get(ip);
  if (!record) return false;
  if (Date.now() - record.firstAt > IP_LOCKOUT_MS) {
    ipFailures.delete(ip);
    return false;
  }
  return record.count >= IP_FAILURE_LIMIT;
}

/*
 * A failure is always recorded. The map is kept bounded by making room, never
 * by declining to count.
 *
 * This used to return early once the map was full of live windows: "that is
 * the attack, so stop adding keys". It bounded the memory and cancelled the
 * throttle at the same time, because the key is the first entry of
 * `X-Forwarded-For` and therefore free to invent. Five thousand throwaway
 * values fill the map, and from then on nothing is counted at all: the address
 * actually guessing passwords never reaches the limit and is never locked out.
 * The memory bound became the way past the control it belongs to.
 *
 * Both siblings already had the right shape (the login throttle above and the
 * RateLimiter in limits.ts each clear down to a low-water mark rather than
 * refusing new entries), and this is now the same: drop expired windows, then
 * drop least-recently-active ones until there is room. Evicting a live window
 * loses one attacker's tally, which is a real cost, but a bounded one, and it
 * beats losing every tally including theirs. Clearing to a low-water mark
 * rather than to exactly the ceiling keeps the sweep amortised to O(1), so this
 * cannot be turned into CPU exhaustion the way a sweep-every-call version can.
 */
export function recordIpFailure(ip: string | null): void {
  if (!ip) return;
  const now = Date.now();

  if (ipFailures.size >= MAX_TRACKED_IPS) {
    for (const [key, record] of ipFailures) {
      if (now - record.firstAt > IP_LOCKOUT_MS) ipFailures.delete(key);
    }
    // Still full of live windows. Map iteration is recency ordered, thanks to
    // bumpIpWindow re-inserting, so the quietest addresses go first.
    if (ipFailures.size >= IP_LOW_WATER) {
      let toDrop = ipFailures.size - IP_LOW_WATER;
      for (const key of ipFailures.keys()) {
        if (toDrop-- <= 0) break;
        if (key === ip) continue; // never evict the caller we are about to count
        ipFailures.delete(key);
      }
    }
  }

  bumpIpWindow(ipFailures, ip, now);
}

export function clearIpFailures(ip: string | null): void {
  if (ip) ipFailures.delete(ip);
}

/** Test seam. */
export function resetIpFailures(): void {
  ipFailures.clear();
}

/**
 * Test/telemetry only, mirroring trackedFailureCount for the email map.
 *
 * Exported so the memory bound is asserted rather than assumed: this map is
 * keyed by a value the caller chooses, and the whole reason it is swept is that
 * it would otherwise grow for as long as someone kept inventing addresses.
 */
export function trackedIpCount(): number {
  return ipFailures.size;
}
/**
 * Reads a JSON body without trusting the size the caller claimed.
 *
 * The middleware rejects anything whose `Content-Length` is over the cap, and
 * for a long time that was the whole defence. It is not one: a request that
 * omits `Content-Length` and sends `Transfer-Encoding: chunked` arrives with a
 * declared size of zero and sails straight through. Verified against the
 * running server — a 5 MB body that is refused with 413 when it declares
 * itself is parsed in full when it does not.
 *
 * That matters here because of what the cap is for. The note above it records
 * a 20 MB write accepted in 112 ms onto a 1 GB disk, so roughly fifty of them
 * fill it and take the database down with the app. A header anyone can omit is
 * not what should stand between the cohort and that.
 *
 * So the bytes are counted as they arrive and the read is abandoned the moment
 * it goes over, rather than after the whole thing is in memory.
 */
/*
 * The failure carries a finished Response rather than a status and a message.
 *
 * Because one of them needs a header, and leaving that to eleven call sites is
 * how it gets forgotten. The oversize reply must close the connection: the
 * unread remainder of the body stays in the socket, and on a keep-alive
 * connection the *next* request is then parsed as leftover body bytes and
 * comes back 400. That is not theoretical — it is what this file did on its
 * first version, and the test that caught it was an ordinary GET failing a few
 * milliseconds after an oversized POST on the same connection.
 *
 * Draining instead, the way the middleware does, is not an option here: the
 * whole point of refusing at this size is not to read the rest of it.
 */
/**
 * How much of an over-sized body is read and thrown away before giving up.
 *
 * Generous enough to cover an accident — a founder pasting a very long
 * transcript — and far too small to be worth using as an attack.
 */
const DRAIN_LIMIT = 4 * 1024 * 1024;

/** Reads and discards up to `limit` more bytes. Never throws. */
async function drain(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  limit: number,
): Promise<void> {
  let seen = 0;
  try {
    while (seen < limit) {
      const { done, value } = await reader.read();
      if (done) return;
      seen += value?.byteLength ?? 0;
    }
  } catch {
    // The peer went away mid-drain, which is the outcome we wanted anyway.
  }
  await reader.cancel().catch(() => {});
}

export type BodyResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: Response };

function refuse(status: 400 | 413, error: string): { ok: false; response: Response } {
  return {
    ok: false,
    response: new Response(JSON.stringify({ error }), {
      status,
      headers: {
        "Content-Type": "application/json",
        ...(status === 413 ? { Connection: "close" } : {}),
      },
    }),
  };
}

export async function readJsonBody<T>(request: Request): Promise<BodyResult<T>> {
  const body = request.body;

  /* No stream to meter — Bun has already buffered it, and the middleware's
     Content-Length check is what bounded it. */
  if (!body) {
    try {
      return { ok: true, value: (await request.json()) as T };
    } catch {
      return refuse(400, "Malformed request.");
    }
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        /*
         * Drain what is left, but only so much of it.
         *
         * Cancelling outright and closing the connection is correct in
         * principle and still raced in practice: measured at roughly one
         * request in eighty, the next ordinary GET on that connection came
         * back 400, because the server reached the leftover bytes before the
         * close completed. An unbounded drain would hand back the denial of
         * service this cap exists to prevent, so it is bounded — a body a
         * little over the line is consumed to a clean boundary, and one that
         * is wildly over is abandoned, which is the case where dropping the
         * connection is the right answer anyway.
         */
        await drain(reader, DRAIN_LIMIT);
        return refuse(413, "That request is too large.");
      }
      chunks.push(value);
    }
  } catch {
    return refuse(400, "Malformed request.");
  }

  const joined = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }

  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(joined)) as T };
  } catch {
    return refuse(400, "Malformed request.");
  }
}
