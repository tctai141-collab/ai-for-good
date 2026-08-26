import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createFounder, createMentor, createOrganizer, get, post, startServer,
  type Harness, type Session,
} from "./helpers/harness";

/**
 * Ending sessions without waiting for an email, and seeing your own reset link.
 *
 * Both exist because revoking access used to depend on mail delivery: sessions
 * died only when a reset link was redeemed, so somebody signed in on a machine
 * they no longer controlled had to wait on a queue to get out of it.
 *
 * The second one is the delicate half. The link used to come back in the
 * response for anybody, which let an organizer reset a founder, redeem it, and
 * sign in as them — reading conversations this app promises are private. That
 * was closed once. Most of this file is about it staying closed.
 */

let h: Harness;
let organizer: Session;
let other: Session;
let mentor: Session;
let alice: Session;

const users = (body: Record<string, unknown>, cookie: string) =>
  post(h, "/api/admin/users", body, cookie);

/** Whether a cookie still opens a signed-in session. */
async function stillIn(cookie: string): Promise<boolean> {
  const res = await get(h, "/api/session", cookie);
  const data = (await res.json()) as { user: unknown };
  return Boolean(data.user);
}

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "org@example.test");
  other = await createOrganizer(h, "other@example.test", "Other Organizer");
  mentor = await createMentor(h, "mentor@example.test", "M");
  alice = await createFounder(h, organizer, "alice@example.test", "Alice", "alice-password-11");
});
afterAll(() => h?.stop());

describe("signing an account out everywhere", () => {
  test("it ends a founder's sessions immediately, with no email involved", async () => {
    expect(await stillIn(alice.cookie)).toBe(true);
    const res = await users({ action: "signout-all", email: alice.email }, organizer.cookie);
    expect(res.status).toBe(200);
    expect(await stillIn(alice.cookie)).toBe(false);
  });

  test("their password still works — this revokes access, it does not change it", async () => {
    /* The distinction matters: a lost laptop needs the session gone, not the
       founder locked out of their own account. */
    const res = await post(h, "/api/session", {
      action: "login", email: alice.email, password: "alice-password-11",
    }, "");
    expect(res.status).toBe(200);
  });

  test("an organizer can do it to themselves, which is the case it was built for", async () => {
    const self = await createOrganizer(h, "self@example.test", "Self");
    expect(await stillIn(self.cookie)).toBe(true);
    const res = await users({ action: "signout-all", email: self.email }, self.cookie);
    expect(res.status).toBe(200);
    // And the response says so, so the page can stop pretending otherwise.
    expect(((await res.json()) as { self: boolean }).self).toBe(true);
    expect(await stillIn(self.cookie)).toBe(false);
  });

  test("founders and mentors cannot sign anybody out", async () => {
    /* A founder with a live session: Alice's was ended two tests ago, and a
       dead cookie answers 401, which would have passed for the wrong reason. */
    const bob = await createFounder(h, organizer, "bob@example.test", "Bob", "bob-password-1122");
    expect((await users({ action: "signout-all", email: bob.email }, bob.cookie)).status).toBe(403);
    expect((await users({ action: "signout-all", email: bob.email }, mentor.cookie)).status).toBe(403);
    expect((await users({ action: "signout-all", email: bob.email }, "")).status).toBe(401);
  });

  test("an unknown account is a 404, not a silent success", async () => {
    expect((await users({ action: "signout-all", email: "nobody@example.test" }, organizer.cookie)).status).toBe(404);
  });
});

describe("showing a reset link on screen", () => {
  test("your own account gives you a link", async () => {
    const res = await users({ action: "reset-link", email: organizer.email }, organizer.cookie);
    expect(res.status).toBe(200);
    const { link } = (await res.json()) as { link: string };
    expect(link).toContain("/setup?token=");
  });

  test("and the link actually works", async () => {
    const made = await users({ action: "reset-link", email: organizer.email }, organizer.cookie);
    const { link } = (await made.json()) as { link: string };
    const token = new URL(link).searchParams.get("token");

    const redeemed = await post(h, "/api/invite", { token, password: "a-brand-new-password-1" }, "");
    expect(redeemed.status).toBe(200);
    // Redeeming ends every session, which is the whole point of the flow.
    expect(await stillIn(organizer.cookie)).toBe(false);
  });

  test("NOBODY else's, whoever is asking", async () => {
    /*
     * The load-bearing one. A link on that screen for another person is a way
     * to set their password and sign in as them, and the privacy model says an
     * organizer cannot read a founder's conversations.
     */
    const fresh = await createOrganizer(h, "fresh@example.test", "Fresh");
    for (const target of [alice.email, mentor.email, other.email]) {
      const res = await users({ action: "reset-link", email: target }, fresh.cookie);
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain("/setup?token=");
    }
  });

  test("the ordinary reset still never returns a link", async () => {
    const fresh = await createOrganizer(h, "fresh2@example.test", "Fresh2");
    const res = await users({ action: "reinvite", email: alice.email }, fresh.cookie);
    // It either emails or fails; either way the link does not come back here.
    expect(await res.text()).not.toContain("/setup?token=");
  });
});

describe("what the page promises", () => {
  const admin = readFileSync("src/pages/admin.astro", "utf-8");

  test("signing yourself out says it will sign you out here too", () => {
    expect(admin).toContain("This signs you out here too. Sure?");
    // And then actually leaves, rather than showing a page it cannot load.
    expect(admin).toContain('location.href = "/"');
  });

  test("the show-link button is only rendered for your own row", () => {
    const block = admin.slice(admin.indexOf('showLink.textContent = "Show link"') - 600, admin.indexOf('actions.append(showLink)'));
    expect(block).toContain("user.email === me");
  });

  test("the link is shown as single-use, with what redeeming it does", () => {
    expect(admin).toContain("Single use. Setting the password signs you out everywhere.");
  });
});
