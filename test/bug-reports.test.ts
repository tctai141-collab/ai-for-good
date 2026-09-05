import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createFounder, createOrganizer, get, post, startServer,
  type Harness, type Session,
} from "./helpers/harness";

/**
 * Reporting a bug, and triaging one.
 *
 * Modelled on wishes, and different in three ways that are the point of the
 * feature:
 *
 *   Anyone signed in files one. A wish comes from the cohort by definition; a
 *   bug is a fact about the software, and an organizer who finds one on /admin
 *   needs somewhere to put it too.
 *
 *   Nobody but staff reads the queue. It is other people's reports, and a
 *   founder browsing what everybody else has complained about turns filing one
 *   into something done in front of an audience.
 *
 *   The report outlives the reporter. Erasing an account takes the name and
 *   the identifier and leaves the knowledge that something is broken, which is
 *   the opposite of what wishes do and is argued for in the schema.
 */

let h: Harness;
let organizer: Session;
let mentor: Session;
let founder: Session;

const file = (who: Session | null, body: unknown, extra: Record<string, unknown> = {}) =>
  post(h, "/api/bugs", { body, ...extra }, who?.cookie);

const queue = (who: Session | null) => get(h, "/api/bugs", who?.cookie);

type Report = {
  id: string; fromEmail: string | null; fromName: string; body: string;
  page: string; userAgent: string; status: string; createdAt: string; updatedAt: string;
};
const reports = async (who: Session) =>
  ((await (await queue(who)).json()) as { reports: Report[] }).reports;

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "olivia@example.test", "Olivia Organizer");
  mentor = await createOrganizer(h, "mikko@example.test", "Mikko Mentor", "mikko-password-11", "mentor");
  founder = await createFounder(h, organizer, "frida@example.test", "Frida Founder", "frida-password-11");
});

afterAll(() => h?.stop());

describe("filing one", () => {
  test("a founder can", async () => {
    const res = await file(founder, "The check-in button does nothing on my phone.");
    expect(res.status).toBe(200);
  });

  test("so can an organizer and a mentor", async () => {
    /*
     * The rule that separates this from wishes. Staff hit bugs too, and the
     * person most likely to notice that /admin is broken is the person using
     * /admin.
     */
    expect((await file(organizer, "Week themes shows a week that does not exist.")).status).toBe(200);
    expect((await file(mentor, "The cohort heatmap is empty for me.")).status).toBe(200);
  });

  test("nobody signed out can", async () => {
    expect((await file(null, "anonymous")).status).toBe(401);
  });

  test("an empty report is refused", async () => {
    expect((await file(founder, "   ")).status).toBe(400);
    expect((await file(founder, undefined)).status).toBe(400);
  });

  test("the reporter's name travels with it", async () => {
    const all = await reports(organizer);
    expect(all.some((r) => r.fromName === "Frida Founder")).toBe(true);
  });
});

describe("the screen and the browser come with it", () => {
  test("both are stored as sent", async () => {
    /*
     * The reason this table exists rather than an email address in a footer.
     * The bugs that cost the most here only happened on somebody's phone, and
     * a description is a guess where a user-agent string is an answer.
     */
    await file(founder, "Corner button covers the page.", {
      page: "/#cohort",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/605.1.15",
    });
    const latest = (await reports(organizer)).find((r) => r.body.startsWith("Corner button"))!;
    expect(latest.page).toBe("/#cohort");
    expect(latest.userAgent).toContain("iPhone");
  });

  test("the screen is a screen, not the URL every report would share", () => {
    /*
     * `page` was `location.pathname + location.hash`, which looks like it
     * answers "where were they" and cannot: Sprint Buddy is a single page, so
     * every report ever filed carried "/". The obvious repair is worse — read
     * at submit and it says "Report a bug" every time, because that is where
     * they are standing by the time they press the button.
     *
     * So the app passes in the screen they left, and this holds the component
     * to it. Asserted on the source because the value is decided in a browser
     * the server never sees.
     */
    /* Comments stripped: the one above the component names the old approach
       in order to explain why it went, and that is not a use of it. */
    const bug = readFileSync("src/components/BugReport.tsx", "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(bug).not.toContain("location.pathname");
    expect(bug).toContain("page: from ?? \"\"");

    const app = readFileSync("src/components/SprintBuddy.tsx", "utf-8");
    /* Captured on the way in, and never overwritten by the bug screen itself. */
    expect(app).toContain('if (view !== "bugs") setBugFrom(VIEW_NAMES[view])');
    expect(app).toContain("<BugReport from={bugFrom} />");
    /* Keyed by View, so a new destination cannot be added without naming it. */
    expect(app).toContain("const VIEW_NAMES: Record<View, string>");
  });

  test("both are capped, because both come from the client", async () => {
    // They are evidence, not proof, and not a place to put a megabyte.
    await file(founder, "Long context.", { page: "p".repeat(5_000), userAgent: "u".repeat(5_000) });
    const latest = (await reports(organizer)).find((r) => r.body === "Long context.")!;
    expect(latest.page.length).toBeLessThanOrEqual(200);
    expect(latest.userAgent.length).toBeLessThanOrEqual(300);
  });

  test("a report without them is still a report", async () => {
    // An older client, or a browser that says nothing useful.
    const res = await file(founder, "No context at all.");
    expect(res.status).toBe(200);
    const latest = (await reports(organizer)).find((r) => r.body === "No context at all.")!;
    expect(latest.page).toBe("");
  });
});

describe("who reads the queue", () => {
  test("an organizer and a mentor do", async () => {
    expect((await queue(organizer)).status).toBe(200);
    expect((await queue(mentor)).status).toBe(200);
  });

  test("a founder does not, not even to see their own", async () => {
    /*
     * Deliberate. There is no "my reports" view either: status is not shown to
     * whoever filed, so a list would be a row with nothing on it.
     */
    expect((await queue(founder)).status).toBe(403);
  });

  test("nobody signed out does", async () => {
    expect((await queue(null)).status).toBe(401);
  });
});

describe("moving one along", () => {
  const move = (who: Session, id: string, status: string) =>
    post(h, "/api/bugs", { action: "update", id, status }, who.cookie);

  test("an organizer can move it through every status", async () => {
    const id = (await reports(organizer))[0]!.id;
    for (const status of ["need_info", "fixing", "done", "wont_fix", "new"]) {
      expect(`${status}: ${(await move(organizer, id, status)).status}`).toBe(`${status}: 200`);
    }
  });

  test("a status outside the five is refused", async () => {
    const id = (await reports(organizer))[0]!.id;
    expect((await move(organizer, id, "nearly_done")).status).toBe(400);
    expect((await move(organizer, id, "")).status).toBe(400);
  });

  test("a mentor reads but does not triage", async () => {
    // They are on the programme and should see what is already filed. Triage
    // is operational work and belongs to whoever will do it.
    const id = (await reports(organizer))[0]!.id;
    expect((await move(mentor, id, "fixing")).status).toBe(403);
  });

  test("a founder cannot", async () => {
    const id = (await reports(organizer))[0]!.id;
    expect((await move(founder, id, "done")).status).toBe(403);
  });

  test("an unknown id is a 404, not a silent success", async () => {
    expect((await move(organizer, "no-such-report", "fixing")).status).toBe(404);
  });

  test("moving one stamps when it moved", async () => {
    /*
     * A tracker where a fresh report and one that has sat in Fixing for a week
     * look identical is not doing the job.
     */
    const before = (await reports(organizer))[0]!;
    await new Promise((r) => setTimeout(r, 1_100));
    await move(organizer, before.id, "fixing");
    const after = (await reports(organizer)).find((r) => r.id === before.id)!;
    expect(after.updatedAt > before.updatedAt).toBe(true);
    expect(after.createdAt).toBe(before.createdAt);
  });
});

describe("the report outlives the reporter", () => {
  test("erasing the account keeps the bug and takes the name", async () => {
    /*
     * Where this parts company with wishes, and the one schema decision worth
     * arguing with. A wish belongs to the person who asked. A bug report is
     * knowledge about the product: deleting whoever happened to find it should
     * not delete the fact that the thing is broken.
     */
    const doomed = await createFounder(h, organizer, "doomed@example.test", "Doomed Founder", "doomed-password-11");
    await file(doomed, "Something only I have seen.");

    const gone = await post(h, "/api/admin/users", { action: "remove", email: doomed.email }, organizer.cookie);
    expect(gone.ok).toBe(true);

    const after = (await reports(organizer)).find((r) => r.body === "Something only I have seen.");
    expect(after).toBeDefined();
    // The identifier goes by the constraint; the name is an ordinary column
    // that deleteUser has to clear itself.
    expect(after!.fromEmail).toBeNull();
    expect(after!.fromName).toBe("");
  });
});

describe("filing is rate limited", () => {
  test("the eleventh in an hour is refused", async () => {
    /*
     * Every report emails the organizers. Ten is above anything anybody files
     * on purpose and below what makes an inbox unusable.
     */
    const chatty = await createFounder(h, organizer, "chatty@example.test", "Chatty Founder", "chatty-password-11");
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await file(chatty, `Report ${i}`)).status);
    expect(codes.filter((c) => c === 200).length).toBe(10);
    expect(codes.filter((c) => c === 429).length).toBe(2);
  });
});

describe("what the interface promises", () => {
  const admin = readFileSync("src/pages/admin.astro", "utf-8");
  const app = readFileSync("src/components/SprintBuddy.tsx", "utf-8");
  const form = readFileSync("src/components/BugReport.tsx", "utf-8");

  test("the badge counts untriaged reports, not every report ever filed", () => {
    // A number that only goes up stops meaning anything.
    expect(admin).toContain('b.status === "new"');
  });

  test("only an organizer is given the control", () => {
    // A mentor sees the status; they do not get a select to change it.
    expect(admin).toContain('myRole === "organizer"');
  });

  test("mentors get the tab", () => {
    expect(admin).toContain('new Set(["mentor", "shared", "wishes", "bugs"])');
  });

  test("the founder's route in is on the rail, not only in the panel", () => {
    /*
     * On a phone the rail is the whole navigation, so a destination reachable
     * only from the open sidebar is one a founder on a phone cannot reach.
     */
    expect(app).toContain('key: "bugs"');
    expect(app).toContain("Report a bug");
  });

  test("the form says what goes with the report before they type", () => {
    // Their screen and their browser travel with it. Somebody should know that
    // while deciding what to write, not discover it afterwards.
    const beforeSend = form.slice(0, form.indexOf("bug-actions"));
    expect(form).toContain("which browser you are");
    expect(beforeSend).toContain("navigator.userAgent");
  });

  test("the founder side offers no way to read the queue", () => {
    // There is no list component and nothing fetches the queue from the app.
    expect(form).not.toContain('fetch("/api/bugs")');
    expect(form).toContain('method: "POST"');
  });

  test("every field from a reporter is escaped into the admin list", () => {
    /*
     * body, page and user_agent are all typed or sent by somebody else, and
     * they land in innerHTML. admin-xss.test.ts enforces this generally; this
     * names the three that matter here.
     */
    const render = admin.slice(admin.indexOf("function renderBugs()"));
    for (const field of ["esc(bug.body)", "esc(bug.page)", "esc(bug.userAgent)", "esc(bug.id)"]) {
      expect(`${field} escaped`).toBe(render.includes(field) ? `${field} escaped` : `${field} MISSING`);
    }
  });
});
