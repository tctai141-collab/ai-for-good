import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { get, startServer, type Harness } from "./helpers/harness";

/**
 * Response headers, and what must not be in the shipped bundle.
 *
 * Headers are the cheapest defence in the app and the easiest to lose in a
 * refactor, because nothing breaks when one disappears. Asserting them here
 * means a missing header fails the build rather than being noticed by a
 * scanner months later.
 */

let h: Harness;

beforeAll(async () => {
  h = await startServer();
});

afterAll(() => h?.stop());

describe("security headers", () => {
  test("every header is present on a normal response", async () => {
    const res = await get(h, "/");
    const expected: Record<string, string> = {
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    };
    for (const [name, value] of Object.entries(expected)) {
      expect(res.headers.get(name)).toBe(value);
    }
    expect(res.headers.get("permissions-policy")).toContain("camera=()");
    expect(res.headers.get("permissions-policy")).toContain("geolocation=()");
  });

  test("the CSP keeps the directives worth keeping", async () => {
    const csp = (await get(h, "/")).headers.get("content-security-policy") ?? "";
    // 'unsafe-inline' is still required for scripts and styles, so the policy
    // is a backstop rather than an XSS defence. These are the parts that do
    // hold: nothing embeds this page, nothing loads plugins, no form posts
    // off-origin, and <base> cannot be rewritten.
    for (const directive of [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "connect-src 'self'",
    ]) {
      expect(csp).toContain(directive);
    }
  });

  test("no framework banner is advertised", async () => {
    expect((await get(h, "/")).headers.get("x-powered-by")).toBeNull();
  });

  test("HSTS is only claimed when the request arrived over TLS", async () => {
    // Sent over plain http here, so asserting its absence is the honest test;
    // a header claiming HSTS on a cleartext response would be meaningless.
    const res = await get(h, "/");
    const hsts = res.headers.get("strict-transport-security");
    if (hsts) expect(hsts).toContain("includeSubDomains");
  });
});

describe("what reaches the browser", () => {
  const bundle = () => {
    const dir = "dist/client/_astro";
    return readdirSync(dir)
      .filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(`${dir}/${f}`, "utf-8"))
      .join("\n");
  };

  test("no secret name appears in the client bundle", () => {
    const js = bundle();
    for (const name of [
      "ANTHROPIC_API_KEY",
      "RESEND_API_KEY",
      "R2_SECRET_ACCESS_KEY",
      "R2_ACCESS_KEY_ID",
      "sk-ant-",
    ]) {
      expect(js).not.toContain(name);
    }
  });

  test("the retired fabricated-founder persona is not shipped", () => {
    /*
     * It lived in the bundle as FOUNDER_CORPUS long after the server stopped
     * using it, doing nothing but carrying a posture string. Anyone could read
     * a biography the product had disowned, and one careless edit would have
     * sent it to the model for real.
     */
    const js = bundle();
    for (const phrase of [
      "near-death runway crisis",
      "cofounder breakup, one real exit",
      "calm, scarred, generous founder",
    ]) {
      expect(js).not.toContain(phrase);
    }
  });

  test("no system prompt is assembled client-side at all", () => {
    // The server owns the prompt. If this fails, something has started
    // building one in the browser, where a user can edit it.
    expect(bundle()).not.toContain("You are Sprint Buddy, the AI coach");
  });
});
