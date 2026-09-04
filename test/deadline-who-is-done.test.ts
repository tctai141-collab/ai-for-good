import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createFounder, createOrganizer, get, post, startServer,
  type Harness, type Session,
} from "./helpers/harness";

/**
 * Who has done a deadline, and who has not.
 *
 * The admin list gave a count and named only the founders who had *not* done
 * it. That answers "who do I chase" and leaves the other half unanswerable:
 * whether the person you just spoke to actually ticked it off could only be
 * worked out by reading the not-done list and noticing an absence.
 *
 * Both lists are the same fact from opposite ends, and both are task status —
 * names and a tick, never anything a founder wrote. That line does not move.
 */

let h: Harness;
let organizer: Session;
let mentor: Session;
let ada: Session;
let bo: Session;
let deadlineId: string;

type Row = {
  id: string; title: string; doneCount: number;
  done: { email: string; name: string }[];
  behind: { email: string; name: string }[];
};
const rows = async (who: Session) =>
  ((await (await get(h, "/api/deadlines?view=status", who.cookie)).json()) as { deadlines: Row[] }).deadlines;

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "olivia@example.test");
  mentor = await createOrganizer(h, "mikko@example.test", "Mikko Mentor", "mikko-password-11", "mentor");
  ada = await createFounder(h, organizer, "ada@example.test", "Ada Lovelace", "ada-password-1122");
  bo = await createFounder(h, organizer, "bo@example.test", "Bo Nilsson", "bo-password-112233");

  const made = await post(h, "/api/deadlines", {
    action: "create", title: "Lifeline pitch", dueDate: "2026-09-11", sprintWeek: 1,
  }, organizer.cookie);
  deadlineId = ((await made.json()) as { id: string }).id;
});

afterAll(() => h?.stop());

describe("both halves are named", () => {
  test("before anybody ticks it off, everyone is behind and nobody is done", async () => {
    const row = (await rows(organizer)).find((d) => d.id === deadlineId)!;
    expect(row.done).toEqual([]);
    expect(row.behind.map((f) => f.name).sort()).toEqual(["Ada Lovelace", "Bo Nilsson"]);
  });

  test("ticking it off moves a founder from one list to the other", async () => {
    await post(h, "/api/deadlines", { action: "toggle", id: deadlineId, done: true }, ada.cookie);

    const row = (await rows(organizer)).find((d) => d.id === deadlineId)!;
    expect(row.done.map((f) => f.name)).toEqual(["Ada Lovelace"]);
    expect(row.behind.map((f) => f.name)).toEqual(["Bo Nilsson"]);
    /* The count and the lists come from different queries and have to agree —
       a count that disagrees with the names under it is worse than either. */
    expect(row.doneCount).toBe(row.done.length);
  });

  test("un-ticking moves them back", async () => {
    await post(h, "/api/deadlines", { action: "toggle", id: deadlineId, done: false }, ada.cookie);
    const row = (await rows(organizer)).find((d) => d.id === deadlineId)!;
    expect(row.done).toEqual([]);
    expect(row.behind.map((f) => f.name).sort()).toEqual(["Ada Lovelace", "Bo Nilsson"]);
  });

  test("nobody is on both lists, and everybody is on one", async () => {
    /*
     * The invariant worth holding rather than the example. done and behind are
     * built by two separate queries — one joining completions, one excluding
     * them — so a founder appearing twice or vanishing entirely is exactly the
     * shape a bug in either would take.
     */
    await post(h, "/api/deadlines", { action: "toggle", id: deadlineId, done: true }, bo.cookie);
    const row = (await rows(organizer)).find((d) => d.id === deadlineId)!;

    const done = row.done.map((f) => f.email);
    const behind = row.behind.map((f) => f.email);
    expect(done.filter((e) => behind.includes(e))).toEqual([]);
    // Two founders exist, so the two lists together must account for both.
    expect([...done, ...behind].sort()).toEqual([ada.email, bo.email].sort());
  });

  test("only founders are counted, not the organizer or the mentor", async () => {
    // Staff are not the cohort. They cannot tick a deadline off and must not
    // show up as owing one.
    const row = (await rows(organizer)).find((d) => d.id === deadlineId)!;
    const everyone = [...row.done, ...row.behind].map((f) => f.email);
    expect(everyone).not.toContain(organizer.email);
    expect(everyone).not.toContain(mentor.email);
  });
});

describe("who may see it", () => {
  test("a mentor sees both lists", async () => {
    // They read the cohort dashboard; this is the same class of fact.
    const row = (await rows(mentor)).find((d) => d.id === deadlineId)!;
    expect(row.done.length + row.behind.length).toBe(2);
  });

  test("a founder's own list carries neither", async () => {
    /*
     * The founder view is their own tasks. Who else has and has not done a
     * deadline is the operating team's business, and putting it in the
     * founder's payload would make a private tick into a leaderboard.
     */
    const res = await get(h, "/api/deadlines", ada.cookie);
    const body = await res.text();
    expect(body).not.toContain("Bo Nilsson");

    /* Their own list has `done` too, and it means something else entirely: a
       boolean for whether *they* ticked it off. The staff view's `done` is a
       list of people. Same name, and the founder's must not quietly become
       the other one. */
    const mine = JSON.parse(body).deadlines[0] as { done: unknown };
    expect(typeof mine.done).toBe("boolean");
  });
});

describe("the admin row shows both", () => {
  const admin = readFileSync("src/pages/admin.astro", "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  test("a done list is rendered, not only the behind one", () => {
    expect(admin).toContain('nameList("done"');
    expect(admin).toContain('nameList("not done yet"');
  });

  test("names go in as text, never as markup", () => {
    /*
     * A founder's name is somebody else's input reaching an organizer's
     * screen. This branch builds DOM nodes rather than an innerHTML string, so
     * textContent is what keeps it text — admin-xss.test.ts cannot see a
     * mistake here because there is no interpolation to inspect.
     */
    const block = admin.slice(admin.indexOf("const nameList = function"));
    expect(block.slice(0, 600)).toContain("names.textContent");
    expect(block.slice(0, 600)).not.toContain("innerHTML");
  });

  test("an archived deadline still shows who finished it", () => {
    /*
     * The chase is over once it is archived, but who did it is the record —
     * which is the whole reason archiving keeps completions instead of
     * dropping them. The old code hid the list on anything not active.
     */
    const block = admin.slice(admin.indexOf("const tally = document.createElement"));
    expect(block.slice(0, 900)).not.toContain('d.status === "active"');
  });

  test("an empty list is left out rather than shown as zero", () => {
    // "0 done" beside "6 not done yet" is a row of noise on every new deadline.
    expect(admin).toContain("if (!people.length) return null");
  });
});
