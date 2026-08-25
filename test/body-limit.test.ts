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
