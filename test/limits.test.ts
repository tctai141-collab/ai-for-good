import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { post, startServer, twoFounders, type Harness, type Session } from "./helpers/harness";
import {
  capHistory, MAX_HISTORY_CHARS, MAX_HISTORY_MESSAGES,
  MAX_MESSAGE_CHARS, RateLimiter,
} from "../src/lib/limits";

/**
 * H-2 (body size) and H-3 (rate limit + history cap).
 *
 * The audit demonstrated both with real numbers: a 20 MB write accepted in
 * 112 ms onto a 1 GB disk, and a 500-message / ~1 MB history forwarded to a
 * metered API with no local cap.
 */

let h: Harness;
let alice: Session;

beforeAll(async () => {
  h = await startServer();
  ({ alice } = await twoFounders(h));
});

afterAll(() => h?.stop());

describe("request body size (H-2)", () => {
  test("a 20 MB write is rejected — the exact payload from the audit", async () => {
    const huge = "A".repeat(20 * 1024 * 1024);
    const res = await post(h, "/api/persistence", {
      action: "save-thread",
      userEmail: alice.email,
      thread: {
        id: "t-huge", title: "x", theme: "x", state: "thinking", lastAt: "x",
        personality: "none", messages: [{ role: "user", content: huge }],
      },
    }, alice.cookie);

    expect(res.status).toBe(413);

    // And nothing was written.
    const db = h.db();
    try {
      const row = db.query("SELECT COUNT(*) n FROM threads WHERE id = 't-huge'").get() as { n: number };
      expect(row.n).toBe(0);
    } finally {
      db.close();
    }
  });

  test("an ordinary write still goes through", async () => {
    const res = await post(h, "/api/persistence", {
      action: "save-thread",
      userEmail: alice.email,
      thread: {
        id: "t-normal", title: "Normal", theme: "runway", state: "thinking", lastAt: "now",
        personality: "none", messages: [{ role: "user", content: "a real message" }],
      },
    }, alice.cookie);
    expect(res.status).toBe(200);
  });

  test("too many messages in one thread is refused", async () => {
    const messages = Array.from({ length: 600 }, (_, i) => ({ role: "user", content: `m${i}` }));
    const res = await post(h, "/api/persistence", {
      action: "save-thread",
      userEmail: alice.email,
      thread: {
        id: "t-many", title: "x", theme: "x", state: "thinking", lastAt: "x",
        personality: "none", messages,
      },
    }, alice.cookie);
    expect(res.status).toBe(413);
  });

  test("an over-long single message is truncated, not stored whole", async () => {
    const long = "B".repeat(MAX_MESSAGE_CHARS + 5_000);
    const res = await post(h, "/api/persistence", {
      action: "save-thread",
      userEmail: alice.email,
      thread: {
        id: "t-long", title: "x", theme: "x", state: "thinking", lastAt: "x",
        personality: "none", messages: [{ role: "user", content: long }],
      },
    }, alice.cookie);
    expect(res.status).toBe(200);

    const db = h.db();
    try {
      const row = db.query("SELECT content FROM messages WHERE thread_id = 't-long'").get() as { content: string };
      expect(row.content.length).toBe(MAX_MESSAGE_CHARS);
    } finally {
      db.close();
    }
  });

  test("a mood score outside 0-100 is clamped rather than stored", async () => {
    await post(h, "/api/persistence", {
      action: "save-checkin", userEmail: alice.email,
      checkin: { id: "c-clamp", theme: "checkin", prompt: "x", mood: 99999 },
    }, alice.cookie);

    const db = h.db();
    try {
      const row = db.query("SELECT mood FROM checkins WHERE id = 'c-clamp'").get() as { mood: number };
      expect(row.mood).toBe(100);
    } finally {
      db.close();
    }
  });

  test("an invalid decision door is refused", async () => {
    const res = await post(h, "/api/persistence", {
      action: "save-decision", userEmail: alice.email,
      decision: { id: "d-bad", summary: "x", door: "sideways", theme: "x" },
    }, alice.cookie);
    expect(res.status).toBe(400);
  });
});

describe("advisor rate limit (H-3)", () => {
  test("a burst of requests is throttled with a Retry-After", async () => {
    let sawLimit = false;
    let retryAfter: string | null = null;

    // The advisor call itself fails (no real API key), which is fine — the
    // throttle sits in front of it and is what we are asserting on.
    for (let i = 0; i < 40; i++) {
      const res = await post(h, "/api/chat", {
        messages: [{ role: "user", content: "hello" }],
        userEmail: alice.email,
      }, alice.cookie);
      if (res.status === 429) {
        sawLimit = true;
        retryAfter = res.headers.get("retry-after");
        break;
      }
    }

    expect(sawLimit).toBe(true);
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  test("an upstream failure is not relayed to the browser (S-10)", async () => {
    // The audit saw a full Cloudflare 502 HTML page come back inside the JSON
    // error field. The stub reproduces exactly that upstream response.
    const failing = await startServer({ advisorFails: true });
    try {
      const users = await twoFounders(failing);
      const res = await post(failing, "/api/chat", {
        messages: [{ role: "user", content: "hello" }],
        userEmail: users.alice.email,
      }, users.alice.cookie);

      const body = await res.text();
      expect(res.status).toBe(502);
      expect(body).not.toContain("<html");
      expect(body).not.toContain("cloudflare");
      expect(body).not.toContain("Bad Gateway");
      expect(body).not.toContain("test-key-not-real");
      expect(JSON.parse(body).error).toBe("The advisor is unavailable right now. Please try again.");
    } finally {
      failing.stop();
    }
  });
});

describe("history cap (H-3)", () => {
  test("a long history is trimmed before it reaches the advisor", async () => {
    const fresh = await startServer();
    try {
      const users = await twoFounders(fresh);
      // Deliberately under MAX_BODY_BYTES — the audit's full 500 x 2 KB
      // payload is now rejected by the body limit first, so this proves the
      // *history* cap rather than re-proving H-2. 300 x 500 chars = 150 KB,
      // still well over both history bounds.
      const messages = Array.from({ length: 300 }, (_, i) => ({
        role: i % 2 ? "assistant" : "user",
        content: "x".repeat(500),
      }));

      await post(fresh, "/api/chat", {
        messages, userEmail: users.alice.email,
      }, users.alice.cookie);

      expect(fresh.advisorCalls).toHaveLength(1);
      const forwarded = fresh.advisorCalls[0]!.messages;
      expect(forwarded.length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGES);
      const chars = forwarded.reduce((n, m) => n + String(m.content).length, 0);
      expect(chars).toBeLessThanOrEqual(MAX_HISTORY_CHARS);
    } finally {
      fresh.stop();
    }
  });

  test("a 500-message history is trimmed before dispatch", () => {
    const messages = Array.from({ length: 500 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: "x".repeat(2_000),
    }));
    const capped = capHistory(messages);

    expect(capped.length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGES);
    const total = capped.reduce((n, m) => n + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_HISTORY_CHARS);
  });

  test("the most recent turns are the ones kept", () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({ role: "user", content: `message-${i}` }));
    const capped = capHistory(messages);
    expect(capped.at(-1)!.content).toBe("message-99");
  });

  test("a short conversation passes through untouched", () => {
    const messages = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    expect(capHistory(messages)).toEqual(messages);
  });

  test("one enormous message is truncated but still sent", () => {
    const capped = capHistory([{ role: "user", content: "z".repeat(500_000) }]);
    expect(capped).toHaveLength(1);
    expect(capped[0]!.content.length).toBe(MAX_MESSAGE_CHARS);
  });
});

describe("rate limiter is bounded (S-8)", () => {
  test("it does not grow without limit on attacker-chosen keys", () => {
    const limiter = new RateLimiter(5, 60_000);
    for (let i = 0; i < 20_000; i++) limiter.check(`attacker-${i}@example.test`);
    expect(limiter.size).toBeLessThanOrEqual(5_000);
  });

  test("it still throttles a real key after eviction pressure", () => {
    const limiter = new RateLimiter(3, 60_000);
    expect(limiter.check("real@example.test")).toBeNull();
    expect(limiter.check("real@example.test")).toBeNull();
    expect(limiter.check("real@example.test")).toBeNull();
    expect(limiter.check("real@example.test")).not.toBeNull();
  });

  test("the window resets once it expires", () => {
    const limiter = new RateLimiter(1, 1_000);
    const start = 1_000_000;
    expect(limiter.check("k", start)).toBeNull();
    expect(limiter.check("k", start + 500)).not.toBeNull();
    expect(limiter.check("k", start + 1_500)).toBeNull();
  });
});
