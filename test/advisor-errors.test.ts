import { describe, expect, test } from "bun:test";
import { advisorErrorMessage } from "../src/lib/advisor-errors";

/**
 * What a founder is told when a message fails to send.
 *
 * Every failure used to produce the same sentence — "Could not reach your
 * advisor just now. Check your connection and try again." When the real cause
 * was a 403 from the cross-site check, that message sent everyone looking at
 * connectivity while the server was refusing requests perfectly happily, and
 * gave the founder no reason to do the one thing that would have fixed it.
 *
 * These assert the distinctions that matter operationally: a refusal is not a
 * dropped connection, an expired session is not an outage, and being told to
 * slow down is not the same as being told something broke.
 */

describe("advisor error messages", () => {
  test("no response at all reads as a connection problem", () => {
    expect(advisorErrorMessage(null).toLowerCase()).toContain("could not reach the server");
  });

  test("401 tells them to sign in, not to check their wifi", () => {
    const message = advisorErrorMessage(401);
    expect(message.toLowerCase()).toContain("sign in");
    expect(message.toLowerCase()).not.toContain("connection");
  });

  test("403 tells them to reload — the thing that actually fixes it", () => {
    const message = advisorErrorMessage(403);
    expect(message.toLowerCase()).toContain("refused");
    expect(message.toLowerCase()).toContain("reload");
    // The exact confusion this exists to prevent.
    expect(message.toLowerCase()).not.toContain("connection");
  });

  test("429 is about pace, not failure", () => {
    expect(advisorErrorMessage(429).toLowerCase()).toContain("minute");
  });

  test("413 names the actual problem", () => {
    expect(advisorErrorMessage(413).toLowerCase()).toContain("too long");
  });

  test("5xx is the advisor being down, and says so", () => {
    for (const status of [500, 502, 503]) {
      expect(advisorErrorMessage(status).toLowerCase()).toContain("unavailable");
    }
  });

  test("every status produces something a person can act on", () => {
    for (const status of [null, 400, 401, 403, 404, 413, 418, 429, 500, 502, 503]) {
      const message = advisorErrorMessage(status as number | null);
      expect(message.length).toBeGreaterThan(15);
      expect(message.endsWith(".")).toBe(true);
      // No status codes or jargon leaking to a founder.
      expect(message).not.toMatch(/\b[45]\d{2}\b/);
    }
  });
});
