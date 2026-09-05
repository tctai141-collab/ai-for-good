import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createFounder, createOrganizer, get, post, startServer,
  type Harness, type Session,
} from "./helpers/harness";
import {
  WORKING_GENIUS_OPENS_AT, WORKING_GENIUS_OPENS_ON, WORKING_GENIUS_OPENS_TIME,
  workingGeniusLocked, workingGeniusOpensLabel,
} from "../src/lib/working-genius-window";
import { WORKING_GENIUS_ITEMS } from "../src/lib/workingGenius";

/**
 * The working-style assessment is held closed until Tuesday 8 September 2026
 * at 09:00, which is the morning the sprint opens.
 *
 * Asked for, and temporary. It matters more than the check-in hold: a stray
 * check-in is a bad row nobody reads, while a set of thirty answers given
 * before anybody has explained what the six types are produces a result that
 * is kept, banded, and shown on the team map to everyone running the
 * programme. Guessing has a permanent output here.
 *
 * Most of what follows is about the two ways a cosmetic hold leaks: a tab left
 * open from before it, and anybody who opens a console.
 */

let h: Harness;
let organizer: Session;
let founder: Session;

/** Thirty answers, in the shape the endpoint accepts, so nothing but the hold
    can be what refuses them. */
const answers = () =>
  Object.fromEntries(WORKING_GENIUS_ITEMS.map((i) => [i.id, i.options[0]!.id]));

beforeAll(async () => {
  // The one suite that stands on this side of the hold rather than past it.
  h = await startServer({ workingGeniusOpen: false });
  organizer = await createOrganizer(h, "olivia@example.test");
  founder = await createFounder(h, organizer, "frida@example.test", "Frida Founder", "frida-password-11");
});

afterAll(() => h?.stop());

describe("when it opens", () => {
  test("09:00 is a clock on a wall in Espoo, not UTC", () => {
    /* The server runs UTC and September is summer time, so 09:00 Helsinki is
       06:00Z. Computed through dueInstant rather than written down, so moving
       the date across the October change would stay correct. */
    expect(new Date(WORKING_GENIUS_OPENS_AT).toISOString()).toBe("2026-09-08T06:00:00.000Z");
    expect(
      new Date(WORKING_GENIUS_OPENS_AT).toLocaleString("en-GB", { timeZone: "Europe/Helsinki" }),
    ).toBe("08/09/2026, 09:00:00");
  });

  test("the boundary is exact, and open at the moment itself", () => {
    expect(workingGeniusLocked(WORKING_GENIUS_OPENS_AT - 1)).toBe(true);
    expect(workingGeniusLocked(WORKING_GENIUS_OPENS_AT)).toBe(false);
    expect(workingGeniusLocked(WORKING_GENIUS_OPENS_AT + 1)).toBe(false);
  });

  test("it says so in words a founder can act on", () => {
    expect(workingGeniusOpensLabel()).toBe("Tuesday 8 September, 09:00");
  });

  test("it opens the morning the sprint does, not before it", () => {
    // The hold exists so nobody meets the thirty questions before the room
    // has been told what the six types are. Opening it earlier than day one
    // would defeat the point of having it at all.
    expect(WORKING_GENIUS_OPENS_ON).toBe("2026-09-08");
    expect(WORKING_GENIUS_OPENS_TIME).toBe("09:00");
  });

  test("the harness override cannot reach a browser", () => {
    /*
     * The escape hatch exists so the suites that take the assessment end to
     * end can still reach the database. It must not be settable client-side,
     * or the server would accept saves while every founder's screen said
     * closed.
     *
     * Asserted against the built bundle rather than the source, because what
     * decides it is what Vite emitted: it replaces process.env with an empty
     * object literal, so the lookup is against {} and returns null whatever
     * the environment says.
     */
    const bundle = readFileSync(
      `dist/client/_astro/${
        readdirSync("dist/client/_astro").find((f) => /^Root\..*\.js$/.test(f))!
      }`,
      "utf-8",
    );
    expect(bundle).toMatch(/var \w+=\{\};[\s\S]{0,400}WORKING_GENIUS_OPENS_AT_OVERRIDE/);
  });
});

describe("the server refuses it", () => {
  const save = (who: Session, body: Record<string, unknown> = {}) =>
    post(h, "/api/persistence", {
      action: "save-working-genius",
      userEmail: who.email,
      workingGeniusResponses: answers(),
      workingGeniusShareConsent: true,
      ...body,
    }, who.cookie);

  test("a founder's answers are refused while the hold is on", async () => {
    /* 423 rather than 403: this is not about who they are, and it stops being
       true at a known moment, which the body carries so a stale tab can say
       when without hard-coding the date a second time. */
    const res = await save(founder);
    expect(res.status).toBe(423);
    const body = await res.json() as { error: string; opensAt: number };
    expect(body.error).toContain("Tuesday 8 September, 09:00");
    expect(body.opensAt).toBe(WORKING_GENIUS_OPENS_AT);
  });

  test("an organizer is held too", async () => {
    // No staff bypass. The result lands on the same team map.
    expect((await save(organizer)).status).toBe(423);
  });

  test("the hold is answered before the payload is looked at", async () => {
    /*
     * A stale tab posting a complete set of answers and one posting rubbish
     * must both come back with the date, not a validation error — otherwise
     * the reason a save failed depends on how the request happened to be
     * malformed, and the client shows the wrong explanation.
     */
    const res = await save(founder, {
      workingGeniusResponses: undefined,
      workingGeniusShareConsent: undefined,
    });
    expect(res.status).toBe(423);
  });

  test("nobody signed in still gets 401, not a lock message", async () => {
    // Authentication is answered first, so the hold never becomes a way to
    // probe what exists.
    const res = await post(h, "/api/persistence", {
      action: "save-working-genius",
      userEmail: founder.email,
      workingGeniusResponses: answers(),
      workingGeniusShareConsent: true,
    });
    expect(res.status).toBe(401);
  });

  test("reading a profile is untouched", async () => {
    /* The hold is on taking it, not on the rest of the app. A founder whose
       account carries an older result keeps seeing it. */
    const res = await get(
      h,
      `/api/persistence?resource=working-genius&user=${encodeURIComponent(founder.email)}`,
      founder.cookie,
    );
    expect(res.status).toBe(200);
  });
});

describe("the page does not offer what the server will refuse", () => {
  const app = readFileSync("src/components/SprintBuddy.tsx", "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  test("the one way in is guarded at the function, not only at the button", () => {
    /* Both buttons are already hidden while the hold is on, so this is the
       backstop: whatever renders, consent cannot be opened. */
    expect(app).toContain("const askWorkingGenius = () => { if (!workingGeniusLocked()) setWgConsenting(true); }");
  });

  test("the consent dialog has no second way of being opened", () => {
    // If something else could set it true, the guard above would be theatre.
    const opens = app.match(/setWgConsenting\(true\)/g) ?? [];
    expect(opens.length).toBe(1);
  });

  test("the hold outranks the retake window", () => {
    /*
     * A founder holding a result from the earlier six-question version is
     * inside a retake window right now. Left in the old order they would be
     * told "Next on" a date weeks away, when the true answer is the morning
     * of the 8th.
     */
    const header = app.slice(app.indexOf("{wgResult ? ("));
    expect(header.slice(0, 400)).toContain("workingGeniusLocked() ? (");
    expect(header.indexOf("workingGeniusLocked()")).toBeLessThan(header.indexOf("canRetake"));
  });

  test("every held surface says when it opens", () => {
    /*
     * Hiding it outright would be worse than holding it: somebody told this is
     * part of the programme, who cannot find it, concludes the app is broken.
     * The date is the answer to the question they would otherwise ask.
     */
    const uses = app.match(/workingGeniusOpensLabel\(\)/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(2);

    /* Two, and not more, is the point. There are exactly two states that need
       a date — holding a result and holding none — and they never render at
       once. A third use meant the same card printed the date twice about eight
       lines apart, which is what this floor was quietly permitting. */
    expect(uses.length).toBe(2);
  });
});
