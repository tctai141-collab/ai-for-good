import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createFounder, createMentor, createOrganizer, get, post, startServer, type Harness, type Session } from "./helpers/harness";
import { F26_SCHEDULE } from "../src/lib/f26-schedule";

/**
 * Loading the F26 schedule from /admin.
 *
 * It exists because forty-one entries is too many to type and a shell is too
 * much to ask. What it must not do is surprise anybody: it writes forty-one
 * rows over whatever is already there, so the preview has to be honest and
 * has to write nothing.
 */

let h: Harness; let organizer: Session; let mentor: Session; let founder: Session;

const call = (action: string, who: Session) => post(h, "/api/programme-events", { action }, who.cookie);
const events = async (who: Session) =>
  ((await (await get(h, "/api/programme-events", who.cookie)).json()) as { events: unknown[] }).events;

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "o@example.test");
  mentor = await createMentor(h, "m@example.test", "M");
  founder = await createFounder(h, organizer, "f@example.test", "F", "founder-password-11");
});
afterAll(() => h?.stop());

describe("who may press it", () => {
  test("organizers only, for both the preview and the write", async () => {
    for (const action of ["preview-f26", "import-f26"]) {
      expect((await call(action, founder)).status).toBe(403);
      expect((await call(action, mentor)).status).toBe(403);
    }
    expect((await post(h, "/api/programme-events", { action: "import-f26" }, "")).status).toBe(401);
    // And nothing was written by any of that.
    expect((await events(organizer)).length).toBe(0);
  });
});

describe("the preview", () => {
  test("counts everything as new, and writes nothing", async () => {
    const res = await call("preview-f26", organizer);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { total: number; added: number; changed: number; same: number; written: boolean; conflicts: string[] };

    expect(data.total).toBe(F26_SCHEDULE.length);
    expect(data.added).toBe(F26_SCHEDULE.length);
    expect(data.changed).toBe(0);
    expect(data.written).toBe(false);
    expect((await events(organizer)).length).toBe(0);
  });

  test("it hands back what the source got wrong about its own dates", async () => {
    const data = (await (await call("preview-f26", organizer)).json()) as { conflicts: string[] };
    expect(data.conflicts.length).toBeGreaterThanOrEqual(4);
    expect(data.conflicts.join(" ")).toContain("Thursday Oct 9");
  });
});

describe("the import", () => {
  test("writes the whole schedule", async () => {
    const data = (await (await call("import-f26", organizer)).json()) as { written: boolean; total: number };
    expect(data.written).toBe(true);
    expect((await events(organizer)).length).toBe(F26_SCHEDULE.length);
  });

  test("the cohort can read it", async () => {
    // The point of the button: it lands on the founders' Programme page.
    expect((await events(founder)).length).toBe(F26_SCHEDULE.length);
  });

  test("pressing it twice does not duplicate", async () => {
    await call("import-f26", organizer);
    expect((await events(organizer)).length).toBe(F26_SCHEDULE.length);

    const again = (await (await call("preview-f26", organizer)).json()) as { added: number; changed: number; same: number };
    expect(again.added).toBe(0);
    expect(again.changed).toBe(0);
    expect(again.same).toBe(F26_SCHEDULE.length);
  });

  test("an edit made here is reported before it is overwritten", async () => {
    /*
     * The sharp edge of being idempotent. Somebody who has corrected a session
     * on this page should see that loading again puts the original back, and
     * see it before pressing rather than after.
     */
    const first = F26_SCHEDULE[0]!;
    const edited = await post(h, "/api/programme-events", {
      id: first.id, title: "Moved to the other room", kind: first.kind,
      startsOn: first.startsOn, startTime: first.startTime, endTime: first.endTime,
    }, organizer.cookie);
    expect(edited.status).toBe(200);

    const preview = (await (await call("preview-f26", organizer)).json()) as { changed: number; added: number };
    expect(preview.changed).toBe(1);
    expect(preview.added).toBe(0);

    // And the write does restore it, which is what the warning said.
    await call("import-f26", organizer);
    const all = (await events(organizer)) as { id: string; title: string }[];
    expect(all.find((e) => e.id === first.id)?.title).toBe(first.title);
  });
});

describe("the page", () => {
  test("the button asks before it writes", () => {
    const admin = readFileSync("src/pages/admin.astro", "utf-8");
    expect(admin).toContain('importF26("preview-f26")');
    expect(admin).toContain('importF26("import-f26")');
    expect(admin).toContain('evImport.dataset.armed !== "yes"');
    // And says what the source got wrong, in the panel, before the second press.
    expect(admin).toContain("the source disagreed with itself about four dates");
  });
});
