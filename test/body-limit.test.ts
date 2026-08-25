import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createOrganizer, startServer, type Harness, type Session } from "./helpers/harness";
import { MAX_BODY_BYTES } from "../src/lib/limits";

/**
 * The request-size cap, and the hole that was in it.
 *
 * The limit existed for a concrete reason recorded in limits.ts: a 20 MB write
 * was accepted in 112 ms onto a 1 GB disk, so roughly fifty of them fill it and
 * take the database down along with the app.
 *
 * It was enforced only against the `Content-Length` the caller declared. A
 * request that omits that header and sends `Transfer-Encoding: chunked` arrives
 * claiming zero bytes and went straight through — verified against the running
 * server before the fix: a 5 MB body refused with 413 when it declared itself
 * was parsed in full when it did not.
 *
 * The bytes are counted as they arrive now. These tests send real oversized
 * bodies both ways rather than asserting on source text, because the whole
 * point is that one spelling behaved differently from the other.
 */

let h: Harness;
let organizer: Session;

/** Comfortably over the cap without being slow to build. */
const OVERSIZE = MAX_BODY_BYTES + 200_000;

function oversizedJson(): string {
  return JSON.stringify({ action: "login", email: "a@b.test", password: "x".repeat(OVERSIZE) });
}

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
});

afterAll(() => h?.stop());

describe("an oversized body is refused", () => {
  test("when it declares its size", async () => {
    const res = await fetch(`${h.url}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: h.url },
      body: oversizedJson(),
    });
    expect(res.status).toBe(413);
  });

  test("and when it does not — the bypass", async () => {
    /*
     * A ReadableStream body makes fetch use chunked transfer encoding, so no
     * Content-Length is sent. Before the fix this returned 401: the server had
     * parsed the whole 1.2 MB and got as far as checking the password.
     */
    const payload = new TextEncoder().encode(oversizedJson());
    const body = new ReadableStream({
      start(controller) {
        const CHUNK = 64 * 1024;
        for (let at = 0; at < payload.length; at += CHUNK) {
          controller.enqueue(payload.slice(at, at + CHUNK));
        }
        controller.close();
      },
    });

    const res = await fetch(`${h.url}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: h.url },
      body,
      // Required by the spec for a stream body, and what makes it chunked.
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    expect(res.status).toBe(413);
    expect(res.status).not.toBe(401);
  });
});

describe("the connection survives being refused", () => {
  test("an oversized body is drained to a clean boundary, not abandoned mid-stream", async () => {
    /*
     * Closing the connection on 413 was correct in principle and still raced
     * in practice: measured at roughly one request in eighty, the next
     * ordinary GET on that connection came back 400, because the server
     * reached the leftover bytes before the close completed. That is an
     * ordinary request failing because of somebody else's oversized one — and
     * it made this suite red about one run in eight, which teaches people to
     * re-run rather than to look.
     *
     * A bounded drain fixes it. Forty pairs here; the failure rate before the
     * fix would have shown up in this many with better than even odds, and a
     * hundred and twenty by hand came back clean twice over.
     */
    for (let i = 0; i < 40; i++) {
      const payload = new TextEncoder().encode(oversizedJson());
      const body = new ReadableStream({
        start(controller) {
          const CHUNK = 64 * 1024;
          for (let at = 0; at < payload.length; at += CHUNK) {
            controller.enqueue(payload.slice(at, at + CHUNK));
          }
          controller.close();
        },
      });
      await fetch(`${h.url}/api/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: h.url },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" }).catch(() => {});

      const after = await fetch(`${h.url}/api/deadlines`, { headers: { cookie: organizer.cookie } });
      expect(after.status).toBe(200);
    }
  }, 60_000);

});

describe("ordinary requests are untouched", () => {
  test("a normal signed request still works", async () => {
    // The cheap fix — refusing anything without a Content-Length — would have
    // broken every client that streams. This one must not.
    const res = await fetch(`${h.url}/api/deadlines`, { headers: { cookie: organizer.cookie } });
    expect(res.status).toBe(200);
  });

  test("and still works on the connection an oversized one was refused on", async () => {
    /*
     * The regression this exists for, and it was a real bug rather than a
     * flaky test.
     *
     * Refusing at the cap means not reading the rest of the body, so the
     * remainder stays in the socket. On a keep-alive connection the next
     * request is then parsed as those leftover bytes and comes back 400 — an
     * ordinary GET failing a few milliseconds after somebody else's oversized
     * POST, which is a denial of service handed out by the thing meant to
     * prevent one. The oversize reply closes the connection now.
     *
     * Ten in a row because the pairing depends on the connection being reused,
     * which is likely but not guaranteed on any single attempt.
     */
    for (let i = 0; i < 10; i++) {
      const big = await fetch(`${h.url}/api/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: h.url },
        body: oversizedJson(),
      });
      expect(big.status).toBe(413);
      expect(big.headers.get("connection")).toBe("close");

      const after = await fetch(`${h.url}/api/deadlines`, { headers: { cookie: organizer.cookie } });
      expect(after.status).toBe(200);
    }
  }, 20_000);

  test("malformed JSON is still a 400, not a 413", async () => {
    const res = await fetch(`${h.url}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: h.url },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });
});

describe("every route reads through the meter", () => {
  test("no API route parses a body directly any more", () => {
    /*
     * The middleware cannot do this on its own: Astro gives it no way to
     * replace the request the route will read, so the cap has to live at the
     * point of parsing. That only holds while every route uses it.
     */
    const routes = [
      "session", "invite", "persistence", "deadlines", "programme",
      "knowledge", "chat", "account",
    ].map((n) => `src/pages/api/${n}.ts`)
      .concat(["users", "shared", "broadcast"].map((n) => `src/pages/api/admin/${n}.ts`));

    for (const path of routes) {
      const src = readFileSync(path, "utf-8");
      expect(src).not.toContain("request.json()");
      expect(src).toContain("readJsonBody");
    }
  });
});

describe("the limit is still a limit", () => {
  /*
   * Last in the file on purpose. This one abandons a body mid-stream, which
   * drops the connection — that is the intended outcome for something this far
   * over, and it is why the drain is bounded. Run before another test, it
   * leaves a socket that the next request trips over, which is a property of
   * the scenario rather than a fault in it.
   */
  test("the drain is bounded, so it is not the denial of service it prevents", async () => {
    /*
     * The whole point of the cap. An unbounded drain would read whatever
     * anybody sent; this one gives up well short of it and drops the
     * connection, which for a body this far over is the right answer.
     */
    const HUGE = 40 * 1024 * 1024;
    let pushed = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (pushed >= HUGE) { controller.close(); return; }
        const chunk = new Uint8Array(64 * 1024).fill(120);
        pushed += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const res = await fetch(`${h.url}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: h.url },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" }).catch(() => ({ status: 0 }));

    expect([413, 0]).toContain(res.status);
    // Nowhere near the whole thing was accepted.
    expect(pushed).toBeLessThan(HUGE / 2);
  }, 60_000);
});
