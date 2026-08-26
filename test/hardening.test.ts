import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createFounder, createMentor, createOrganizer, get, post, startServer,
  type Harness, type Session,
} from "./helpers/harness";

/**
 * The ceilings on what a stolen session can do.
 *
 * Written before a red-team exercise, and the framing is deliberate: none of
 * this assumes organizers are suspect. It assumes an organizer *session* is the
 * most valuable thing an attacker can take here, and asks what that session
 * could do in a loop. Two things could do it without limit — creating accounts,
 * which sends an email each time, and writing rows onto the 1 GB disk the
 * database itself lives on.
 */

let h: Harness;
let organizer: Session;
let mentor: Session;
let founder: Session;

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "org@example.test");
  mentor = await createMentor(h, "mentor@example.test", "M");
  founder = await createFounder(h, organizer, "founder@example.test", "F", "founder-password-11");
});
afterAll(() => h?.stop());

describe("an organizer session cannot act without limit", () => {
  test("creating accounts stops, because each one sends an email", async () => {
    /* One stolen cookie could otherwise burn a sending reputation and a
       provider quota in a couple of seconds. */
    const codes: number[] = [];
    for (let i = 0; i < 70; i++) {
      const res = await post(h, "/api/admin/users",
        { action: "add", email: `burst${i}@example.test`, name: "B", role: "founder" },
        organizer.cookie);
      codes.push(res.status);
    }
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
    // And it says how long to wait rather than just refusing.
    const last = await post(h, "/api/admin/users",
      { action: "add", email: "one-more@example.test", name: "B", role: "founder" }, organizer.cookie);
    expect(last.status).toBe(429);
    expect(last.headers.get("Retry-After")).toBeTruthy();
  }, 120_000);
});

describe("rows are bounded, not just paced", () => {
  test("the programme has a ceiling on how many entries can exist", () => {
    /* A rate limit slows a loop; a cap stops it. The database is a file on the
       same 1 GB disk. Deadlines already carried one of these. */
    const source = readFileSync("src/pages/api/programme-events.ts", "utf-8");
    expect(source).toContain("const MAX_EVENTS");
    expect(source).toContain("listProgrammeEvents().length >= MAX_EVENTS");
    // Editing must still work at the ceiling, or the schedule locks.
    expect(source).toContain("const isNew =");
  });

  test("every organizer-only deadline action goes through one gate", () => {
    /* Role and pace together, so a new action added below cannot forget the
       ceiling. */
    const source = readFileSync("src/pages/api/deadlines.ts", "utf-8");
    const gate = source.slice(source.indexOf("const organizerOnly = ()"), source.indexOf("switch (body.action)"));
    expect(gate).toContain('session.role !== "organizer"');
    expect(gate).toContain("adminWriteLimiter.check");
  });
});

describe("the microphone is reachable again", () => {
  test("Permissions-Policy allows it for this origin only", () => {
    /*
     * It was denied outright, which was right until dictation shipped and then
     * quietly wasn't: getUserMedia is refused before the permission prompt, so
     * the feature could never work in production and the founder was told to
     * check settings that would not have helped.
     */
    const middleware = readFileSync("src/middleware.ts", "utf-8");
    expect(middleware).toContain("microphone=(self)");
    expect(middleware).not.toContain("microphone=()");
    // Everything else stays shut, and self is not *.
    for (const denied of ["camera=()", "geolocation=()", "payment=()", "usb=()"]) {
      expect(middleware).toContain(denied);
    }
    expect(middleware).not.toContain("microphone=*");
  });
});

describe("the limits did not become a way in", () => {
  test("roles are still enforced ahead of any ceiling", async () => {
    /* A limiter placed before the auth check would answer 429 to strangers,
       which tells them the endpoint exists and is worth pushing on. */
    for (const [cookie, expected] of [[founder.cookie, 403], [mentor.cookie, 403], ["", 401]] as const) {
      const res = await post(h, "/api/admin/users",
        { action: "add", email: "nope@example.test", name: "N", role: "founder" }, cookie);
      expect(res.status).toBe(expected);
    }
    for (const [cookie, expected] of [[founder.cookie, 403], [mentor.cookie, 403], ["", 401]] as const) {
      const res = await post(h, "/api/programme-events", { title: "x", startsOn: "2026-09-09" }, cookie);
      expect(res.status).toBe(expected);
    }
  }, 60_000);

  test("reads are untouched — a busy writer can still be read", async () => {
    expect((await get(h, "/api/programme-events", founder.cookie)).status).toBe(200);
    expect((await get(h, "/api/deadlines", founder.cookie)).status).toBe(200);
  });
});
