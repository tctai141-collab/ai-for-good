import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createOrganizer, get, post, startServer, type Harness, type Session } from "./helpers/harness";
import { WORKING_GENIUS_ITEMS } from "../src/lib/workingGenius";

/**
 * Staff take the assessment from their own account.
 *
 * Before this, an organizer or a mentor could not reach it at all: the coach
 * view holds the cohort, not a person, and the assessment lived at the foot of
 * Reflections, which only founders have. The only way in was a second account
 * with the founder role, which would have put a staff member in the cohort
 * heat map, on the team map, and on the list that gets check-in reminders.
 *
 * The results stay out of the cohort views without this file doing anything —
 * listSharedWorkingGenius is founders-only at the query, and
 * team-map-founders-only.test.ts holds that line.
 */

const app = readFileSync("src/components/SprintBuddy.tsx", "utf-8");
const rail = app.slice(app.indexOf("function SidebarRail"), app.indexOf("const railButton"));

let h: Harness;
let organizer: Session;

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
});

afterAll(() => h?.stop());

const answers = () => Object.fromEntries(WORKING_GENIUS_ITEMS.map((item, n) => [item.id, (n % 5) + 1]));

describe("the way in", () => {
  test("the coach view has a Working style destination, on the rail and in the panel", () => {
    expect(rail).toContain('key: "working-style"');
    // The panel and the rail are two renderings of one navigation; a
    // destination in only one of them is unreachable for half the cohort.
    expect(app).toContain("<span>Working style</span>");
    expect(app).toContain('onWorkingStyle={() => setView("working-style")}');
  });

  test("it is a page of their own, not the cohort standing in for one", () => {
    const page = app.slice(app.indexOf('persona === "coach" && view === "working-style"'));
    expect(page.slice(0, 900)).toContain("<WorkingStyle userEmail={userEmail} standalone />");
    // And the cohort heatmap steps aside rather than rendering underneath it.
    expect(app).toContain('view !== "assistant" && view !== "working-style" &&');
  });

  test("the card is one component, used by both pages", () => {
    expect(app).toContain("function WorkingStyle({");
    expect(app).toContain("<WorkingStyle\n        userEmail={userEmail}");
  });
});

describe("an organizer taking it", () => {
  test("is allowed to save their own profile", async () => {
    const res = await post(h, "/api/persistence", {
      action: "save-working-genius",
      userEmail: organizer.email,
      workingGeniusResponses: answers(),
      workingGeniusShareConsent: true,
    }, organizer.cookie);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { ranking: string[]; version: string } };
    expect(body.result.ranking).toHaveLength(6);
    expect(body.result.version).toBe("afs-4");
  });

  test("reads their own profile back, with their takes", async () => {
    const res = await get(
      h,
      `/api/persistence?resource=working-genius&user=${encodeURIComponent(organizer.email)}`,
      organizer.cookie,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      workingGenius: { result_json: string } | null;
      takes: Array<{ taken_on: string }>;
    };
    expect(body.workingGenius).not.toBeNull();
    expect(JSON.parse(body.workingGenius!.result_json).bands.genius).toHaveLength(2);
    expect(body.takes).toHaveLength(1);
  });

  test("still cannot read a colleague's answers", async () => {
    /* Taking it themselves changes nothing about what staff may see of
       anybody else: the profile a founder consented to share, and never the
       answers underneath it. */
    const other = await createOrganizer(h, "second@example.test", "Second Organizer");
    const res = await get(
      h,
      `/api/persistence?resource=working-genius&user=${encodeURIComponent(organizer.email)}`,
      other.cookie,
    );
    const body = (await res.json()) as { workingGenius: { result_json?: string } | null };
    expect(body.workingGenius?.result_json).toBeUndefined();
  });
});
