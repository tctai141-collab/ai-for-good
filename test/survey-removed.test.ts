import { Database } from "bun:sqlite";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createOrganizer, get, startServer, type Harness, type Session } from "./helpers/harness";
import { initSchema } from "../src/db/schema";

/**
 * The survey is gone, and so is what it collected.
 *
 * Removed on 15 September 2026, the day its first round ran, because the
 * answers were sensitive. The feature is deleted from the app; the data is
 * dropped from the database on the first boot after the deploy, with pages
 * zeroed and the file vacuumed so no fragment of an answer is left in it.
 */

const MARKER = "SENSITIVE-SURVEY-ANSWER-7c1f";

describe("the data", () => {
  test("every survey table is dropped, and the file no longer contains any of it", () => {
    const path = join(tmpdir(), `survey-purge-${crypto.randomUUID()}.sqlite`);
    try {
      /* A database as production had it: current schema, plus the survey
         tables with a round, a statement and an answer in them. */
      let db = new Database(path);
      initSchema(db);
      db.run("CREATE TABLE survey_rounds (id TEXT PRIMARY KEY, title TEXT)");
      db.run("CREATE TABLE survey_groups (id TEXT PRIMARY KEY, round_id TEXT, heading TEXT)");
      db.run("CREATE TABLE survey_items (id TEXT PRIMARY KEY, group_id TEXT, statement TEXT)");
      db.run("CREATE TABLE survey_submissions (round_id TEXT, user_email TEXT, submitted_at TEXT)");
      db.run("CREATE TABLE survey_answers (round_id TEXT, user_email TEXT, item_id TEXT, value INTEGER)");
      db.run("CREATE TABLE survey_seeds (key TEXT PRIMARY KEY)");
      for (let i = 0; i < 50; i++) {
        db.run("INSERT INTO survey_rounds VALUES (?, ?)", [`r${i}`, `${MARKER} round ${i}`]);
        db.run("INSERT INTO survey_items VALUES (?, ?, ?)", [`i${i}`, "g", `${MARKER} statement ${i}`]);
        db.run("INSERT INTO survey_submissions VALUES (?, ?, ?)", [`r${i}`, `${MARKER}-founder${i}@example.test`, "now"]);
        db.run("INSERT INTO survey_answers VALUES (?, ?, ?, ?)", [`r${i}`, `${MARKER}-founder${i}@example.test`, `i${i}`, 4]);
      }
      db.close();
      expect(readFileSync(path).includes(Buffer.from(MARKER))).toBe(true);

      db = new Database(path);
      initSchema(db);
      const left = db
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'survey%'")
        .all();
      db.close();

      expect(left).toEqual([]);
      for (const file of [path, `${path}-wal`, `${path}-journal`]) {
        if (existsSync(file)) expect([file, readFileSync(file).includes(Buffer.from(MARKER))]).toEqual([file, false]);
      }
    } finally {
      for (const file of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]) rmSync(file, { force: true });
    }
  });

  test("a database that never had the survey is left alone", () => {
    const path = join(tmpdir(), `survey-none-${crypto.randomUUID()}.sqlite`);
    try {
      const db = new Database(path);
      initSchema(db);
      initSchema(db);
      expect(db.query("SELECT name FROM sqlite_master WHERE name LIKE 'survey%'").all()).toEqual([]);
      db.close();
    } finally {
      for (const file of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]) rmSync(file, { force: true });
    }
  });
});

describe("the feature", () => {
  let h: Harness;
  let organizer: Session;
  beforeAll(async () => {
    h = await startServer();
    organizer = await createOrganizer(h, "olivia@example.test");
  });
  afterAll(() => h?.stop());

  test("the survey endpoint no longer exists", async () => {
    expect((await get(h, "/api/survey", organizer.cookie)).status).toBe(404);
  });

  test("nothing in the app offers it", () => {
    for (const file of ["src/components/Survey.tsx", "src/pages/api/survey.ts"]) {
      expect([file, existsSync(file)]).toEqual([file, false]);
    }
    const app = readFileSync("src/components/SprintBuddy.tsx", "utf-8").toLowerCase();
    const admin = readFileSync("src/pages/admin.astro", "utf-8").toLowerCase();
    expect(app).not.toContain("survey");
    expect(admin).not.toContain("survey");
    expect(readFileSync("PRIVACY.md", "utf-8").toLowerCase()).not.toContain("survey answers");
  });
});
