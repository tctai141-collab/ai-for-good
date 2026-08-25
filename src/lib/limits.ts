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
export type BodyResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 413; error: string };

export async function readJsonBody<T>(request: Request): Promise<BodyResult<T>> {
  const body = request.body;

  /* No stream to meter — Bun has already buffered it, and the middleware's
     Content-Length check is what bounded it. */
  if (!body) {
    try {
      return { ok: true, value: (await request.json()) as T };
    } catch {
      return { ok: false, status: 400, error: "Malformed request." };
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
        /* Stop reading rather than draining: unlike the middleware's path
           this reply closes the connection, so there is no keep-alive stream
           left to desynchronise. */
        await reader.cancel().catch(() => {});
        return { ok: false, status: 413, error: "That request is too large." };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: "Malformed request." };
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
    return { ok: false, status: 400, error: "Malformed request." };
  }
}
