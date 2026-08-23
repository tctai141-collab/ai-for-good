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

  test("allows a write from a second hostname the service also answers on", async () => {
    /*
     * The regression this exists for. This service answers on its custom domain
     * and on its onrender.com address. An earlier version of the check trusted
     * only PUBLIC_BASE_URL, so every state-changing request from the second host
     * was rejected with a 403 that produced no log line — the app looked broken
     * with a silent server. Chat, check-in, deadlines and login all went through
     * that path.
     */
    const response = await post(
      "/api/deadlines",
      { action: "create", title: "Second host", dueDate: "2026-10-04" },
      {
        cookie: organizer.cookie,
        origin: "https://sprint-buddy-0gon.onrender.com",
        "x-forwarded-host": "sprint-buddy-0gon.onrender.com",
        "x-forwarded-proto": "https",
      },
    );
    expect(response.status).toBe(200);
  });

  test("still rejects an origin that matches no host it answers on", async () => {
    const response = await post(
      "/api/deadlines",
      { action: "create", title: "Nope", dueDate: "2026-10-05" },
      {
        cookie: organizer.cookie,
        origin: "https://sprint-buddy-0gon.onrender.com.evil.example",
        "x-forwarded-host": "aaltofoundersprint.com",
      },
    );
    expect(response.status).toBe(403);
  });

  test("leaves reads alone", async () => {
    // A GET changes nothing, and blocking it would break ordinary navigation.
    expect((await get(h, "/api/session", founder.cookie)).status).toBe(200);
  });
});

/**
 * The origin check itself, exercised directly.
 *
 * The integration tests above run against a server on an OS-assigned port, so
 * they can only cover the unconfigured fallback. These drive the predicate
 * with synthetic requests, which is the only way to cover the configured case
 * — and the configured case is the one that matters, because it is what runs
 * in production.
 */
describe("the origin check, with PUBLIC_BASE_URL configured", () => {
  const SITE = "https://sprintbuddy.example";
  let saved: string | undefined;

  beforeAll(async () => {
    saved = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = SITE;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = saved;
  });

  const make = (headers: Record<string, string>, method = "POST") =>
    new Request(`${SITE}/api/chat`, { method, headers });

  test("same-origin POST is accepted", async () => {
    const { crossSiteRequest } = await import("../src/lib/origin");
    expect(crossSiteRequest(make({ origin: SITE }))).toBe(false);
  });

  test("cross-origin POST is rejected", async () => {
    const { crossSiteRequest } = await import("../src/lib/origin");
    expect(crossSiteRequest(make({ origin: "https://evil.example" }))).toBe(true);
  });

  test("missing Origin and Referer is rejected", async () => {
    const { crossSiteRequest } = await import("../src/lib/origin");
    expect(crossSiteRequest(make({}))).toBe(true);
  });

  test("a spoofed X-Forwarded-Host cannot widen the allow-set", async () => {
    /*
     * The regression this guards. The host set used to include the request's
     * own forwarded host, so a caller who set both Origin and
     * X-Forwarded-Host to the same value authorised themselves.
     */
    const { crossSiteRequest } = await import("../src/lib/origin");
    expect(crossSiteRequest(make({
      origin: "https://evil.example",
      "x-forwarded-host": "evil.example",
    }))).toBe(true);
  });

  test("a spoofed Host cannot widen it either", async () => {
    const { crossSiteRequest } = await import("../src/lib/origin");
    expect(crossSiteRequest(make({ origin: "https://evil.example", host: "evil.example" }))).toBe(true);
  });

  test("Sec-Fetch-Site: cross-site is rejected even with a matching Origin", async () => {
    // The browser sets this and script cannot, so it outranks Origin.
    const { crossSiteRequest } = await import("../src/lib/origin");
    expect(crossSiteRequest(make({ origin: SITE, "sec-fetch-site": "cross-site" }))).toBe(true);
  });

  test("Sec-Fetch-Site: same-origin with a matching Origin is accepted", async () => {
    const { crossSiteRequest } = await import("../src/lib/origin");
    expect(crossSiteRequest(make({ origin: SITE, "sec-fetch-site": "same-origin" }))).toBe(false);
  });

  test("Referer stands in when Origin is absent", async () => {
    const { crossSiteRequest } = await import("../src/lib/origin");
    expect(crossSiteRequest(make({ referer: `${SITE}/chat` }))).toBe(false);
    expect(crossSiteRequest(make({ referer: "https://evil.example/x" }))).toBe(true);
  });

  test("GET and HEAD are never treated as cross-site", async () => {
    const { crossSiteRequest } = await import("../src/lib/origin");
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(crossSiteRequest(make({ origin: "https://evil.example" }, method))).toBe(false);
    }
  });

  test("every state-changing method is checked", async () => {
    const { crossSiteRequest } = await import("../src/lib/origin");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(crossSiteRequest(make({ origin: "https://evil.example" }, method))).toBe(true);
    }
  });
});
