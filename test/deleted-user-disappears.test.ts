import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createFounder, createOrganizer, get, post, startServer,
  type Harness, type Session,
} from "./helpers/harness";

/**
 * A deleted account stops being named, on screens that were already open.
 *
 * Reported as "the profile is deleted from the system but I can still see them
 * in the Team map", and the erasure was never the problem — the database drops
 * every row in one transaction and /api/cohort inner-joins users, so a deleted
 * founder cannot come back out of the server. What was wrong is that nothing
 * asked again. The cohort was fetched once when the page mounted and never
 * refetched, and an organizer deletes an account on /admin, in another tab, and
 * then returns to this one. Measured before the fix: the server returned an
 * empty map and the open page still drew the row.
 *
 * So the server half is asserted here for completeness, and the two client
 * halves are asserted on source — the failure is a missing call, and a missing
 * call has nothing to catch it at runtime.
 */

let h: Harness;
let organizer: Session;
let doomed: Session;

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
  doomed = await createFounder(h, organizer, "doomed@example.test", "Doomed Founder", "doomed-password-11");
});

afterAll(() => h?.stop());

describe("the server stops naming them immediately", () => {
  test("a deleted founder is gone from every part of the cohort payload", async () => {
    const before = await (await get(h, "/api/cohort", organizer.cookie)).json() as {
      teams: { name: string }[]; map: { name: string }[]; cohortSize: number;
    };
    expect(before.teams.some((t) => t.name === "Doomed Founder")).toBe(true);

    const gone = await post(h, "/api/admin/users", { action: "remove", email: doomed.email }, organizer.cookie);
    expect(gone.ok).toBe(true);

    const after = await (await get(h, "/api/cohort", organizer.cookie)).json() as {
      teams: { name: string }[]; map: { name: string }[]; cohortSize: number;
    };
    /* Named in three places on that payload, and the team map is the one that
       was reported — but a name left behind in any of them is the same bug. */
    expect(after.teams.some((t) => t.name === "Doomed Founder")).toBe(false);
    expect(after.map.some((m) => m.name === "Doomed Founder")).toBe(false);
    expect(after.cohortSize).toBe(before.cohortSize - 1);
  });

  test("they are gone from the account list too", async () => {
    const users = await (await get(h, "/api/admin/users", organizer.cookie)).json() as {
      users: { email: string }[];
    };
    expect(users.users.some((u) => u.email === doomed.email)).toBe(false);
  });
});

describe("an open cohort view asks again", () => {
  const source = readFileSync("src/components/SprintBuddy.tsx", "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  /** The effect that owns /api/cohort. */
  const effect = source.slice(
    source.lastIndexOf("useEffect", source.indexOf('fetch("/api/cohort")')),
    source.indexOf('}, [persona]);', source.indexOf('fetch("/api/cohort")')),
  );

  test("it refetches when the tab comes back to the front", () => {
    /*
     * The roster is edited on a different page, so the change always lands
     * while this tab is in the background. Coming back to the front is the one
     * moment the answer is known to be possibly stale, and it is also the
     * moment somebody is about to read it.
     */
    expect(effect).toContain("visibilitychange");
    expect(effect).toContain('document.visibilityState === "visible"');
  });

  test("the listeners are removed when the view goes away", () => {
    // Two of them, on two different targets; leaking either would refetch for
    // a component that is no longer on screen.
    expect(effect).toContain("removeEventListener");
    expect(effect.match(/removeEventListener/g)?.length).toBe(2);
  });

  test("a failed refetch keeps what is on screen", () => {
    /*
     * setCohort(null) on a dropped request would blank the heatmap, the
     * sidebar and the map at once. Yesterday's answer beats no answer.
     */
    expect(effect).toContain("if (data) setCohort(data)");
  });
});

describe("the admin page refreshes everything that names a founder", () => {
  const script = readFileSync("src/pages/admin.astro", "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  /** From the remove call to the end of its handler. */
  const handler = (() => {
    const at = script.indexOf('action: "remove", email: user.email');
    return script.slice(at, script.indexOf("actions.append(remove)", at));
  })();

  test("the cohort heatmap and team map are re-read", () => {
    /*
     * loadMentor is /api/cohort — the heatmap and the team map — and it was
     * called exactly once, at startup, and never again. This is the call whose
     * absence produced the report.
     */
    expect(handler).toContain("loadMentor()");
  });

  test("so is everything else built from the roster", () => {
    // Shared conversations and wishes belonged to them; the deadline counts
    // are per founder; and deleting a borrower marks their loans unaccounted,
    // so a stale shelf still shows the book as out with them.
    for (const loader of ["loadShared()", "loadWishes()", "loadDeadlines()", "loadLibrary()"]) {
      expect(`${loader} is called`).toBe(handler.includes(loader) ? `${loader} is called` : `${loader} is missing`);
    }
  });

  test("the People table itself is still redrawn", () => {
    // It always was; this guards against the refresh block replacing it
    // rather than joining it.
    expect(handler).toContain("load()");
  });
});
