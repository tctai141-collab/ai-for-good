import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createOrganizer, post, startServer, type Harness, type Session } from "./helpers/harness";

/**
 * Where the setup link points.
 *
 * It used to be built from PUBLIC_BASE_URL *or*, failing that, the request's
 * own X-Forwarded-Host / Host. That URL goes into an email carrying a
 * single-use token that sets a founder's password, and a request header is
 * chosen by whoever sent the request. With PUBLIC_BASE_URL unset — and it is
 * `sync: false` in render.yaml, so somebody has to remember — the app would
 * mail an activation link pointing wherever it was told to point. The mail is
 * genuinely from the programme and the token is genuinely valid, which is what
 * makes it worth phishing with.
 *
 * The reminder scheduler had the other half of the same problem: it never read
 * a header, but it fell back to a hardcoded domain, so a deployment living
 * somewhere else would send the whole cohort links to a page that does not
 * exist and say nothing about it.
 */

let h: Harness;
let organizer: Session;

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
});

afterAll(() => h?.stop());

describe("the emailed link", () => {
  test("uses the configured origin, not the host the caller claimed", async () => {
    const response = await fetch(`${h.url}/api/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: h.url,
        cookie: organizer.cookie,
        // What an attacker would supply. It must not reach the email.
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({ action: "add", name: "Aino", email: "aino@example.test", role: "founder" }),
    });
    expect(response.status).toBe(200);

    const mail = h.sent.find((m) => m.to === "aino@example.test");
    expect(mail).toBeDefined();
    expect(mail!.text).not.toContain("evil.example");
    expect(mail!.text).toContain(h.url);
  });
});

describe("nothing builds a link from a request header", () => {
  test("the admin route no longer reads a host header at all", () => {
    const src = readFileSync("src/pages/api/admin/users.ts", "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toContain("x-forwarded-host");
    expect(src).not.toContain('headers.get("host")');
    expect(src).toContain("configuredAppUrl()");
  });

  test("reminders have no hardcoded domain to fall back to", () => {
    const src = readFileSync("src/lib/reminders.ts", "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/https:\/\/[a-z0-9.-]+"/);
    expect(src).toContain("configuredAppUrl()");
  });

  test("an unset origin refuses rather than guesses", () => {
    // A token created and never delivered is a live credential sitting in the
    // table for fourteen days, so the check happens before the row is written.
    const src = readFileSync("src/pages/api/admin/users.ts", "utf-8");
    const fn = src.slice(src.indexOf("async function issueInvite"), src.indexOf("async function issueInvite") + 700);
    expect(fn.indexOf("if (!link) throw")).toBeLessThan(fn.indexOf("createInvite("));
  });
});
