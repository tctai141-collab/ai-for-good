import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { initSchema } from "../src/db/schema";
import { createOrganizer, get, post, startServer, type Harness, type Session } from "./helpers/harness";

/**
 * Taking the loaded F26 schedule back out.
 *
 * The button that loaded it is gone, and so are the rows it wrote. The part
 * worth testing is the aim: it must take the forty-one entries the loader
 * created and nothing that anybody typed into the form.
 */

describe("migration 6 clears what the loader wrote", () => {
  test("f26 rows go, hand-written ones stay, and it runs once", () => {
    const dir = mkdtempSync(join(tmpdir(), "f26-removal-"));
    const db = new Database(join(dir, "test.db"));
    initSchema(db);

    const insert = (id: string, title: string) =>
      db.run(
        "INSERT INTO programme_events (id, title, kind, starts_on) VALUES (?, ?, 'session', '2026-09-08')",
        [id, title],
      );

    /* Pretend the loader ran on a database that predates this migration. */
    db.run("PRAGMA user_version = 5");
    insert("f26-2026-09-08-intro-to-the-sprint", "Intro to the Sprint");
    insert("f26-2026-10-08-trend-report-submission", "Trend report submission");
    insert("b2d5f1a0-typed-by-hand", "Something an organizer typed");
    // Archived ones too — listProgrammeEvents hides them, so a delete that
    // only looked at the active list would leave them behind.
    db.run("UPDATE programme_events SET status = 'archived' WHERE id LIKE 'f26-2026-10%'");

    initSchema(db);

    const left = db.query("SELECT id FROM programme_events ORDER BY id").all() as { id: string }[];
    expect(left.map((r) => r.id)).toEqual(["b2d5f1a0-typed-by-hand"]);

    /* And it does not come back for anything later. Somebody who types the
       schedule in again, or restores a backup, must not lose it on reboot. */
    insert("f26-2026-09-08-intro-to-the-sprint", "Typed in again, on purpose");
    initSchema(db);
    const after = db.query("SELECT id FROM programme_events ORDER BY id").all() as { id: string }[];
    expect(after.length).toBe(2);

    db.close();
  });
});

describe("the loader is gone", () => {
  let h: Harness;
  let organizer: Session;

  beforeAll(async () => {
    h = await startServer();
    organizer = await createOrganizer(h, "o@example.test");
  });
  afterAll(() => h?.stop());

  test("its actions do nothing at all now", async () => {
    /* They fall through to the create-an-event path, which refuses a body with
       no title. Refused is what matters; the wording of the refusal is the
       ordinary one and not worth pinning. */
    for (const action of ["preview-f26", "import-f26"]) {
      const res = await post(h, "/api/programme-events", { action }, organizer.cookie);
      expect(res.status).toBe(400);
    }
    const list = await get(h, "/api/programme-events", organizer.cookie);
    expect(((await list.json()) as { events: unknown[] }).events.length).toBe(0);
  });

  test("adding a session by hand still works, and gets no f26 id", async () => {
    const res = await post(h, "/api/programme-events", {
      title: "Typed by hand", startsOn: "2026-09-08", startTime: "10:00",
    }, organizer.cookie);
    expect(res.status).toBe(200);
    const { event } = (await res.json()) as { event: { id: string } };
    // The prefix migration 6 keys on is the loader's alone.
    expect(event.id.startsWith("f26-")).toBe(false);

    const list = await get(h, "/api/programme-events", organizer.cookie);
    expect(((await list.json()) as { events: unknown[] }).events.length).toBe(1);
  });

  test("its files and its button are gone", () => {
    for (const path of [
      "src/lib/f26-schedule.ts",
      "scripts/seed-programme.ts",
      "test/seed-programme.test.ts",
      "test/f26-import.test.ts",
    ]) {
      expect(existsSync(path)).toBe(false);
    }
    const admin = readFileSync("src/pages/admin.astro", "utf-8");
    expect(admin).not.toContain("ev-import");
    expect(admin).not.toContain("F26 schedule");
  });
});
