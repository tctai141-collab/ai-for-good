import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createFounder, createOrganizer, post, startServer,
  type Harness, type Session,
} from "./helpers/harness";
import {
  CHECKIN_OPENS_AT, CHECKIN_OPENS_ON, CHECKIN_OPENS_TIME,
  checkinLocked, checkinOpensLabel,
} from "../src/lib/checkin-window";

/**
 * The daily check-in is held closed until 9 September 2026 at 18:00.
 *
 * Asked for directly, and temporary — the sprint opens on the 8th and the
 * ritual is introduced on the 9th, so a founder who finds it first either
 * skips it or fills it in wrong, and a habit gets one first impression.
 *
 * The hold is a rule, not a disabled button. Most of what follows is about the
 * two ways a cosmetic version leaks: a stale tab open from before the lock,
 * and anybody who opens a console.
 */

let h: Harness;
let organizer: Session;
let founder: Session;

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "olivia@example.test");
  founder = await createFounder(h, organizer, "frida@example.test", "Frida Founder", "frida-password-11");
});

afterAll(() => h?.stop());

describe("when it opens", () => {
  test("18:00 is a clock on a wall in Espoo, not UTC", () => {
    /*
     * The server runs UTC. September is summer time, so 18:00 Helsinki is
     * 15:00Z — and this is computed through dueInstant rather than written
     * down, so moving the date into late October would still be correct
     * instead of being an hour out.
     */
    expect(new Date(CHECKIN_OPENS_AT).toISOString()).toBe("2026-09-09T15:00:00.000Z");
    expect(
      new Date(CHECKIN_OPENS_AT).toLocaleString("en-GB", { timeZone: "Europe/Helsinki" }),
    ).toBe("09/09/2026, 18:00:00");
  });

  test("the boundary is exact, and open at the moment itself", () => {
    expect(checkinLocked(CHECKIN_OPENS_AT - 1)).toBe(true);
    expect(checkinLocked(CHECKIN_OPENS_AT)).toBe(false);
    expect(checkinLocked(CHECKIN_OPENS_AT + 1)).toBe(false);
  });

  test("it says so in words a founder can act on", () => {
    // A timestamp is not an answer to "when can I do this".
    expect(checkinOpensLabel()).toBe("Wednesday 9 September, 18:00");
  });

  test("the harness override cannot reach a browser", () => {
    /*
     * The escape hatch exists so two prompt-caching suites can drive a real
     * check-in. It must not be settable client-side, or the server would open
     * while every founder's screen still said closed.
     *
     * Asserted against the built bundle rather than the source, because what
     * decides this is what Vite emitted: it replaces process.env with an empty
     * object literal, so the lookup is against {} and returns null whatever
     * the environment says.
     */
    const bundle = readFileSync(
      `dist/client/_astro/${
        readdirSync("dist/client/_astro").find((f) => /^Root\..*\.js$/.test(f))!
      }`,
      "utf-8",
    );
    expect(bundle).toContain('typeof process>"u"');
    /* The env object it reads is a literal `{}` assigned at build time — the
       name appears, the value never can. */
    expect(bundle).toMatch(/var \w+=\{\};[\s\S]{0,400}CHECKIN_OPENS_AT_OVERRIDE/);
  });

  test("the date and time are one constant each", () => {
    // This is a hold, not a scheduling feature: it should come out by deleting
    // one file and the places that read it.
    expect(CHECKIN_OPENS_ON).toBe("2026-09-09");
    expect(CHECKIN_OPENS_TIME).toBe("18:00");
  });
});

describe("the server refuses it", () => {
  const checkin = (who: Session) =>
    post(h, "/api/chat", {
      messages: [{ role: "user", content: "hi" }],
      kind: "checkin",
      userEmail: who.email,
      personality: "marten",
    }, who.cookie);

  test("a check-in is refused while the hold is on", async () => {
    /*
     * 423 rather than 403: this is not about who they are, and it stops being
     * true at a known moment. The body carries that moment so a client can say
     * when without hard-coding it a second time.
     */
    const res = await checkin(founder);
    expect(res.status).toBe(423);
    const body = await res.json() as { error: string; opensAt: number };
    expect(body.error).toContain("Wednesday 9 September, 18:00");
    expect(body.opensAt).toBe(CHECKIN_OPENS_AT);
  });

  test("an organizer previewing is held too", async () => {
    // The preview runs on their own account and shows the founder's view, so
    // it has to behave like one.
    expect((await checkin(organizer)).status).toBe(423);
  });

  test("ordinary conversation is untouched", async () => {
    /*
     * The hold is on the daily ritual, not on the advisor. Anything but a 423
     * passes here — the harness has no model behind it, so this is asserting
     * that the request got past the gate rather than that it succeeded.
     */
    const res = await post(h, "/api/chat", {
      messages: [{ role: "user", content: "hi" }],
      personality: "marten",
    }, founder.cookie);
    expect(res.status).not.toBe(423);
  });

  test("nobody signed in still gets 401, not a lock message", async () => {
    // Order matters: authentication is answered before the hold, so the lock
    // never becomes a way to probe whether an endpoint exists.
    const res = await post(h, "/api/chat", {
      messages: [{ role: "user", content: "hi" }],
      kind: "checkin",
    });
    expect(res.status).toBe(401);
  });
});

describe("the page does not offer what the server will refuse", () => {
  const app = readFileSync("src/components/SprintBuddy.tsx", "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  test("starting one is guarded before anything is sent", () => {
    expect(app).toContain("if (checkinLocked()) return");
  });

  test("all three ways in are held, not just the obvious one", () => {
    /*
     * The sidebar row, the phone strip and the rail. The rail is the one that
     * matters most on a phone, where it is the whole navigation — and it is
     * the one a fix aimed at the sidebar would miss.
     */
    const railItem = app.slice(app.indexOf('key: "checkin"'), app.indexOf('key: "deadlines"'));
    expect(railItem).toContain("checkinLocked()");
    expect(railItem).toContain("dot: !checkinLocked() && !checkinDone");

    const strip = app.slice(app.indexOf('<div className="mobile-actions">'));
    expect(strip.slice(0, 700)).toContain("checkinLocked()");
  });

  test("the empty state stops pointing at it", () => {
    // "use today's check-in" sends the reader at a row that will not open.
    expect(app).toContain("The daily check-in opens");
  });

  test("every held surface says when it opens", () => {
    /*
     * Hiding it would be worse than holding it: a founder told the check-in is
     * the daily habit, who cannot find it, concludes the app is broken.
     */
    const uses = app.match(/checkinOpensLabel\(\)/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(4);
  });
});
