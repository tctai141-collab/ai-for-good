import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createFounder, createOrganizer, get, startServer, type Harness, type Session } from "./helpers/harness";

/**
 * Cross-site protection on state-changing requests.
 *
 * Astro's built-in check is switched off in astro.config.mjs and replaced by
 * the one in src/middleware.ts. That is only defensible if the replacement is
 * stronger, so this file holds it to that: it must cover JSON requests, which
 * the built-in skipped entirely and which is every endpoint this app has, and
 * it must keep working behind a proxy that rewrites the protocol, which is what
 * broke the built-in.
 */

let h: Harness;
let organizer: Session;
let founder: Session;

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
  founder = await createFounder(h, organizer, "founder@example.test", "Aino", "founder-password-11");
});

afterAll(() => h?.stop());

function post(path: string, body: unknown, headers: Record<string, string>) {
  return fetch(`${h.url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("cross-site protection", () => {
  test("rejects a JSON write from another origin", async () => {
    // The case the built-in check let through: a form content type is not
    // required to change state here, because every endpoint takes JSON.
    const response = await post(
      "/api/deadlines",
      { action: "toggle", id: "anything", done: true },
      { cookie: founder.cookie, origin: "https://evil.example", host: "aaltofoundersprint.com" },
    );
    expect(response.status).toBe(403);
  });

  test("rejects an unsafe request carrying no origin at all", async () => {
    const response = await post("/api/deadlines", { action: "toggle", id: "x", done: true }, { cookie: founder.cookie });
    expect(response.status).toBe(403);
  });

  test("allows a same-site write when the proxy has rewritten the protocol", async () => {
    // https from the browser, http as far as the server can tell. This exact
    // mismatch is what made the built-in check reject sign-out in production.
    const response = await post(
      "/api/deadlines",
      { action: "create", title: "Proxy-safe", dueDate: "2026-10-01" },
      {
        cookie: organizer.cookie,
        origin: "https://aaltofoundersprint.com",
        host: "aaltofoundersprint.com",
        "x-forwarded-proto": "https",
      },
    );
    expect(response.status).toBe(200);
  });

  test("prefers the forwarded host over the internal one", async () => {
    const response = await post(
      "/api/deadlines",
      { action: "create", title: "Forwarded", dueDate: "2026-10-02" },
      {
        cookie: organizer.cookie,
        origin: "https://aaltofoundersprint.com",
        host: "sprint-buddy-0gon:10000",
        "x-forwarded-host": "aaltofoundersprint.com",
        "x-forwarded-proto": "https",
      },
    );
    expect(response.status).toBe(200);
  });

  test("falls back to Referer when Origin is absent", async () => {
    const response = await post(
      "/api/deadlines",
      { action: "create", title: "Referer only", dueDate: "2026-10-03" },
      { cookie: organizer.cookie, referer: "https://aaltofoundersprint.com/admin", host: "aaltofoundersprint.com" },
    );
    expect(response.status).toBe(200);
  });

  test("leaves reads alone", async () => {
    // A GET changes nothing, and blocking it would break ordinary navigation.
    expect((await get(h, "/api/session", founder.cookie)).status).toBe(200);
  });
});
