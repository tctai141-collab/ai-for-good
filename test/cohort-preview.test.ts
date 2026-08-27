import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createFounder, createMentor, createOrganizer, get, post, startServer,
  type Harness, type Session,
} from "./helpers/harness";

/**
 * Previewing the cohort view as staff.
 *
 * The ask was to stop signing out of one account and into another just to see
 * how a change to a deadline or the programme week looks to a founder.
 *
 * The thing to get right is what it is *not*. It does not view as a founder
 * and it does not impersonate anybody: it renders the founder view against the
 * staff member's own account, and every request it makes is one they could
 * already make. The parts worth checking — deadlines, the week, the composer —
 * are cohort-wide and show faithfully. The parts that are somebody's private
 * writing are simply not there.
 *
 * Most of this file guards that distinction, because a "view as" feature is
 * the obvious next thing somebody would build on top of it, and it would undo
 * the whole privacy model in one commit.
 */

let h: Harness;
let organizer: Session;
let mentor: Session;
let founder: Session;

const app = readFileSync("src/components/App.tsx", "utf-8");
const admin = readFileSync("src/pages/admin.astro", "utf-8");

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
  mentor = await createMentor(h, "marten@example.test", "Mårten");
  founder = await createFounder(h, organizer, "founder@example.test", "Founder", "founder-password-1");

  // Something private, so the assertions below have something to fail on.
  await post(h, "/api/persistence", {
    action: "save-thread",
    userEmail: founder.email,
    thread: {
      id: "t-private", title: "Private", theme: "x", state: "thinking",
      lastAt: "now", personality: "none",
      messages: [{ role: "user", content: "PRIVATE CONTENT" }],
    },
  }, founder.cookie);
});

afterAll(() => h?.stop());

describe("the preview reads the staff member's own account", () => {
  test("it renders with their own email, never a founder's", () => {
    const branch = app.slice(app.indexOf("if (previewCohort) {"), app.indexOf("if (previewCohort) {") + 2200);
    expect(branch).toContain('persona="founder"');
    expect(branch).toContain("userEmail={user.email}");
    // Nothing selects a founder to be viewed as.
    expect(branch).not.toContain("founderEmail");
    expect(branch).not.toContain("viewAs");
  });

  test("the server still refuses a staff read of a founder's threads", async () => {
    /*
     * The preview changes no permission, so this is unchanged — but it is the
     * assertion that would break the day somebody turns it into "view as".
     */
    const res = await get(
      h,
      `/api/persistence?resource=threads&user=${encodeURIComponent(founder.email)}`,
      organizer.cookie,
    );
    const body = await res.text();
    expect(body).not.toContain("PRIVATE CONTENT");
    expect(JSON.parse(body).redacted).toBe(true);
  });

  test("a staff member reading themselves gets themselves", async () => {
    const res = await get(
      h,
      `/api/persistence?resource=threads&user=${encodeURIComponent(organizer.email)}`,
      organizer.cookie,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { threads: unknown[] };
    expect(data.threads).toEqual([]);
  });

  test("the deadline list an organizer sees is the cohort's", async () => {
    // Which is what makes previewing with their own account worth anything.
    const res = await get(h, "/api/deadlines", organizer.cookie);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { deadlines: unknown[]; progress: unknown };
    expect(Array.isArray(data.deadlines)).toBe(true);
    expect(data.progress).toBeDefined();
  });

  test("a mentor can preview too, and is still refused everything else", async () => {
    expect((await get(h, "/api/deadlines", mentor.cookie)).status).toBe(200);
    expect((await get(h, "/api/admin/users", mentor.cookie)).status).toBe(403);
  });
});

describe("you always know which view you are in", () => {
  test("the preview carries a bar saying whose data it is", () => {
    /*
     * This view is meant to be indistinguishable from a founder's, which is
     * exactly why somebody has to be told which one they are in, and told
     * that the emptiness is theirs, not evidence about a founder.
     *
     * Asserted on the claim, not the wording. Pinning the exact sentence made
     * a copy edit look like a regression: capitalising one word after a
     * rewrite failed this test while the bar said the same thing.
     */
    expect(app).toContain('className="preview-bar"');
    const bar = app.slice(app.indexOf('className="preview-bar"'), app.indexOf("preview-exit"));
    expect(bar.toLowerCase()).toContain("your own account");
    expect(bar.toLowerCase()).toContain("not a");
    expect(bar.toLowerCase()).toContain("founder");
  });

  test("the bar is impossible to miss", () => {
    const css = readFileSync("src/pages/index.astro", "utf-8");
    const bar = css.slice(css.indexOf(".preview-bar {"), css.indexOf(".preview-bar strong"));
    expect(bar).toContain("position: fixed");
    expect(bar).toContain("background: var(--brand-accent)");
  });

  test("it is not remembered across a reload", () => {
    // A preview that survives is a way to forget which view you are in.
    expect(app).not.toContain('localStorage.setItem("sprintbuddy.preview"');
    expect(app).toContain('get("view") === "cohort"');
  });
});

describe("getting in and out", () => {
  test("the URL is the source of truth, so back works", () => {
    expect(app).toContain('window.history.pushState(null, "", "/?view=cohort")');
    expect(app).toContain('window.history.pushState(null, "", "/")');
    expect(app).toContain('window.addEventListener("popstate", onPop)');
  });

  test("both directions have a control", () => {
    expect(app).toContain("onClick={() => enterPreview()}");
    expect(app).toContain("onClick={() => leavePreview()}");
  });

  test("/admin links straight into it", () => {
    // The whole point: change a deadline, then see it as a founder does,
    // without signing out.
    expect(admin).toContain('href="/?view=cohort"');
    expect(admin).toContain("See the cohort view");
  });

  test("a founder never sees the switch", () => {
    // It lives inside the staff branch, after the founder branch has returned.
    expect(app.indexOf("enterPreview()")).toBeGreaterThan(app.indexOf('user.role === "organizer" || user.role === "mentor"'));
  });
});
