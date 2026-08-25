import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createFounder, createOrganizer, get, post, startServer,
  type Harness, type Session,
} from "./helpers/harness";
import { WORKING_GENIUS_ITEMS } from "../src/lib/workingGenius";

/**
 * Sharing the working-style profile, and the consent it rests on.
 *
 * The result used to be the founder's alone and the card said so. It is shared
 * with the operating team now, which is only defensible if the founder decided
 * that before answering anything rather than discovering it afterwards. So the
 * consent is a gate in the interface *and* a condition on the server: a
 * submission without it is refused, not stored unshared.
 *
 * What is shared is the profile. The thirty individual answers and the free
 * text are not, and there is no organizer route to them — the guard is that the
 * column never appears in an organizer's response at all.
 */

let h: Harness;
let organizer: Session;
let founder: Session;
let other: Session;

const answers = () =>
  Object.fromEntries(WORKING_GENIUS_ITEMS.map((i) => [i.id, i.options[0]!.id]));

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
  founder = await createFounder(h, organizer, "founder@example.test", "Founder", "founder-password-1");
  other = await createFounder(h, organizer, "other@example.test", "Other", "other-password-11");
});

afterAll(() => h?.stop());

describe("the server requires the agreement", () => {
  test("a submission without it is refused", async () => {
    const res = await post(h, "/api/persistence", {
      action: "save-working-genius",
      userEmail: founder.email,
      workingGeniusResponses: answers(),
    }, founder.cookie);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("agreeing to share");
  });

  test("a falsy or fudged value is not agreement", async () => {
    for (const value of [false, "true", 1, null]) {
      const res = await post(h, "/api/persistence", {
        action: "save-working-genius",
        userEmail: founder.email,
        workingGeniusResponses: answers(),
        workingGeniusShareConsent: value,
      }, founder.cookie);
      expect(res.status).toBe(400);
    }
  });

  test("nothing was stored by any of those attempts", async () => {
    const res = await get(h, `/api/persistence?resource=working-genius&user=${encodeURIComponent(founder.email)}`, founder.cookie);
    const data = (await res.json()) as { workingGenius: unknown };
    expect(data.workingGenius).toBeNull();
  });

  test("with it, the profile saves and is marked shared", async () => {
    const res = await post(h, "/api/persistence", {
      action: "save-working-genius",
      userEmail: founder.email,
      workingGeniusResponses: answers(),
      workingGeniusShareConsent: true,
    }, founder.cookie);
    expect(res.status).toBe(200);

    const read = await get(h, `/api/persistence?resource=working-genius&user=${encodeURIComponent(founder.email)}`, organizer.cookie);
    const data = (await read.json()) as { shared: boolean; sharedAt: string };
    expect(data.shared).toBe(true);
    // Stamped by the server; a client-supplied time is not evidence.
    expect(Number.isNaN(Date.parse(data.sharedAt))).toBe(false);
  });
});

describe("the cohort map", () => {
  test("lists founders who shared, and counts the ones who did not", async () => {
    const res = await get(h, "/api/cohort", organizer.cookie);
    const data = (await res.json()) as {
      map: Array<{ name: string; gifts: string[]; competencies: string[]; drains: string[] }>;
      mapWithheld: number;
    };

    expect(data.map).toHaveLength(1);
    expect(data.map[0]!.name).toBe("Founder");
    expect(data.map[0]!.gifts).toHaveLength(2);
    expect(data.map[0]!.competencies).toHaveLength(2);
    expect(data.map[0]!.drains).toHaveLength(2);

    // The other founder has not taken it. Counted, never named — a list turns
    // a voluntary thing into a visible omission.
    expect(data.mapWithheld).toBe(1);
    expect(JSON.stringify(data.map)).not.toContain(other.email);
  });

  test("carries bands and nothing under them", async () => {
    const body = await (await get(h, "/api/cohort", organizer.cookie)).text();
    for (const leak of ["result_json", "abstentions", "overrides", "consistency", "counts_json"]) {
      expect(body).not.toContain(leak);
    }
  });

  test("a founder cannot read it", async () => {
    const res = await get(h, "/api/cohort", founder.cookie);
    expect(res.status).toBe(403);
  });
});

describe("the interface cannot skip the card", () => {
  const sprint = readFileSync("src/components/SprintBuddy.tsx", "utf-8");

  test("both entry points open it rather than starting", () => {
    // Including the retake: consent is to an arrangement, and the arrangement
    // is the same every time it is asked.
    expect(sprint.match(/onClick=\{askWorkingGenius\}/g)?.length).toBe(2);
    expect(sprint).not.toContain("onClick={startWorkingGenius}");
  });

  test("closing it any way is not agreeing", () => {
    // Escape and the backdrop both fire close, and close cancels.
    expect(sprint).toContain('dialog.addEventListener("close", onClose)');
    expect(sprint).toContain("const onClose = () => onCancel();");
  });

  test("the card names what is shared and what is not", () => {
    const card = sprint.slice(sprint.indexOf("function WgConsent"), sprint.indexOf("function WgConsent") + 2600);
    expect(card).toContain("shared with the Sprint operating team");
    expect(card).toContain("Not shared:");
    expect(card).toContain("thirty individual answers");
  });

  test("the standing note no longer promises what is no longer true", () => {
    expect(sprint).not.toContain("This one is yours alone");
    const note = sprint.slice(sprint.indexOf("function WgPrivateNote"), sprint.indexOf("function WgPrivateNote") + 900);
    expect(note).toContain("cannot see your individual answers");
  });
});
