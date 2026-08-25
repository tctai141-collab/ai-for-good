import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createOrganizer, get, startServer, type Harness, type Session } from "./helpers/harness";

/**
 * The mentor's page.
 *
 * Everything else on /admin is for running the cohort — adding people, setting
 * deadlines, sending mail. A mentor does none of that, and a mentor who opens
 * an operating console finds nothing addressed to them and does not come back.
 * So this tab is first, it answers one question (who should I talk to, and
 * about what), and it writes nothing.
 *
 * The two things worth guarding are the ones that would make it useless rather
 * than merely plain: that it never invents a reason, and that it reads no data
 * a founder has not published.
 */

let h: Harness;
let organizer: Session;

const admin = readFileSync("src/pages/admin.astro", "utf-8");
const script = admin
  .slice(admin.indexOf("async function loadMentor()"), admin.indexOf("async function loadMentor()") + 7000);

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
});

afterAll(() => h?.stop());

describe("it never cries wolf", () => {
  test("silence is not a reason until the week is over", () => {
    /*
     * In week one every founder has "no check-in in week 1" — three names with
     * the same non-reason, on the page a mentor is meeting for the first time.
     * The cohort dashboard already refuses to count a missing check-in before
     * the week has finished, and this has to as well.
     */
    expect(script).toContain("const weekSettled = week > 1;");
    expect(script).toContain("v === 0 && weekSettled");
  });

  test("the empty state is decided by signal, not by how many boxes were built", () => {
    // An earlier version counted sections, and a list of "nobody has checked
    // in yet" was enough to suppress the honest message.
    expect(script).toContain("const anySignal = top.length || shared.length || map.length || behind.length;");
    expect(script).toContain("if (!anySignal) {");
  });

  test("it says what will appear rather than looking broken", () => {
    expect(script).toContain("Nothing to read yet");
    expect(script).toContain("This page fills in as the cohort uses the app");
  });

  test("it names at most three people", () => {
    // A mentor has one evening, not twenty. A grid is a thing you scan once.
    expect(script).toContain("reasons.slice(0, 3)");
  });

  test("every name carries a reason", () => {
    expect(script).toContain('reasons.push({ name: t.name, why:');
    expect(script).toContain("esc(r.why)");
  });
});

describe("it reads, and does not reach further than the rest of the page", () => {
  test("it writes nothing", () => {
    expect(script).not.toContain('method: "POST"');
    expect(script).not.toContain("method: 'POST'");
  });

  test("it uses only endpoints that already existed", () => {
    const urls = [...script.matchAll(/fetch\("([^"]+)"/g)].map((m) => m[1]!);
    expect(urls.sort()).toEqual([
      "/api/admin/shared",
      "/api/cohort",
      "/api/deadlines?view=status",
      "/api/programme",
    ]);
  });

  test("a founder still cannot reach any of them", async () => {
    // The mentor page adds no new access; these are the same organizer-only
    // guards the rest of /admin sits behind.
    for (const path of ["/api/cohort", "/api/admin/shared", "/api/deadlines?view=status"]) {
      const res = await get(h, path);
      expect(res.status).toBe(401);
    }
  });

  test("an organizer can read all of them", async () => {
    for (const path of ["/api/cohort", "/api/admin/shared", "/api/deadlines?view=status", "/api/programme"]) {
      const res = await get(h, path, organizer.cookie);
      expect(res.status).toBe(200);
    }
  });
});

describe("where it sits", () => {
  test("it is the first tab, and where a first visit lands", () => {
    expect(admin.indexOf('data-tab="mentor"')).toBeLessThan(admin.indexOf('data-tab="people"'));
    expect(admin).toContain('let storedTab = "mentor";');
  });

  test("names and titles are escaped on the way into the DOM", () => {
    // Same rule as every other list on this page.
    expect(script).toContain("esc(r.name)");
    expect(script).toContain("esc(t.founderName");
    expect(script).toContain("esc(d.title)");
  });
});
