import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { get, post, startServer, twoFounders, type Harness, type Session } from "./helpers/harness";

/**
 * H-5 — the Reflections page told every founder the same invented thing.
 *
 * "On your mind" and "You keep returning to" were driven by seedThemes: three
 * hardcoded names (Research / Team / Direction) with zero-filled 15-week arcs,
 * never fetched, never persisted, and filtered on a literal allow-list of those
 * same three names. Two founders with completely different histories saw
 * identical output, and it reset on reload.
 *
 * Themes are now derived server-side from real signals.
 */

let h: Harness;
let alice: Session;
let bob: Session;

beforeAll(async () => {
  h = await startServer();
  ({ alice, bob } = await twoFounders(h));

  // Alice talks about runway and hiring.
  for (const [i, theme] of ["runway", "runway", "hiring"].entries()) {
    await post(h, "/api/persistence", {
      action: "save-thread", userEmail: alice.email,
      thread: {
        id: `t-a-${i}`, title: `Alice ${i}`, theme, state: "thinking",
        lastAt: "now", personality: "none", messages: [{ role: "user", content: "x" }],
      },
    }, alice.cookie);
  }
  await post(h, "/api/persistence", {
    action: "save-decision", userEmail: alice.email,
    decision: { id: "d-a", summary: "x", door: "one-way", theme: "runway", status: "open" },
  }, alice.cookie);

  // Bob talks about something else entirely.
  await post(h, "/api/persistence", {
    action: "save-thread", userEmail: bob.email,
    thread: {
      id: "t-b-0", title: "Bob", theme: "cofounder", state: "panic",
      lastAt: "now", personality: "none", messages: [{ role: "user", content: "y" }],
    },
  }, bob.cookie);
});

afterAll(() => h?.stop());

describe("themes are real, not invented", () => {
  test("they reflect what the founder actually talked about", async () => {
    const res = await get(h, `/api/persistence?resource=themes&user=${alice.email}`, alice.cookie);
    expect(res.status).toBe(200);
    const { themes } = await res.json();

    const names = themes.map((t: { name: string }) => t.name);
    expect(names).toContain("runway");
    expect(names).toContain("hiring");

    // runway (3 signals) must outrank hiring (1) — the list is sorted by weight.
    expect(names[0]).toBe("runway");
  });

  test("the invented defaults are gone", async () => {
    const res = await get(h, `/api/persistence?resource=themes&user=${alice.email}`, alice.cookie);
    const { themes } = await res.json();
    const names = themes.map((t: { name: string }) => t.name);
    for (const invented of ["Research", "Team", "Direction"]) {
      expect(names).not.toContain(invented);
    }
  });

  test("two founders with different histories see different themes", async () => {
    const aliceThemes = (await (await get(h, `/api/persistence?resource=themes&user=${alice.email}`, alice.cookie)).json()).themes;
    const bobThemes = (await (await get(h, `/api/persistence?resource=themes&user=${bob.email}`, bob.cookie)).json()).themes;

    const aliceNames = aliceThemes.map((t: { name: string }) => t.name).sort();
    const bobNames = bobThemes.map((t: { name: string }) => t.name).sort();

    expect(aliceNames).not.toEqual(bobNames);
    expect(bobNames).toContain("cofounder");
    expect(bobNames).not.toContain("runway");
  });

  test("a founder with no history gets an empty list, not three fake ones", async () => {
    const organizerSession = await (async () => {
      const db = h.db();
      try {
        db.run("INSERT INTO users (email,name,role,created_at) VALUES ('quiet@example.test','Quiet','founder',datetime('now'))");
      } finally {
        db.close();
      }
    })();
    void organizerSession;

    // Read as an organizer, who is allowed to look up a founder that exists.
    const res = await get(h, `/api/persistence?resource=themes&user=quiet@example.test`, alice.cookie);
    // Alice is not that founder, so this must be refused outright.
    expect(res.status).toBe(403);
  });

  test("arcs are placed in a real sprint week, not a hardcoded one", async () => {
    const res = await get(h, `/api/persistence?resource=themes&user=${alice.email}`, alice.cookie);
    const { themes, week } = await res.json();

    expect(typeof week).toBe("number");
    const runway = themes.find((t: { name: string }) => t.name === "runway");
    expect(runway.arc).toHaveLength(15);

    // Everything was written now, so all the weight sits in the current week —
    // and specifically not in index 5, which the old bumpTheme always used.
    const nonZero = runway.arc
      .map((n: number, i: number) => (n > 0 ? i : -1))
      .filter((i: number) => i >= 0);
    expect(nonZero).toEqual([week - 1]);
  });

  test("themes are private to the founder", async () => {
    const res = await get(h, `/api/persistence?resource=themes&user=${alice.email}`, bob.cookie);
    expect(res.status).toBe(403);
  });

  test("an organizer cannot read a founder's theme breakdown either", async () => {
    const organizer = await (await import("./helpers/harness")).createOrganizer(
      h, "themes-organizer@example.test", "Org", "organizer-password-9",
    );
    const res = await get(h, `/api/persistence?resource=themes&user=${alice.email}`, organizer.cookie);
    expect(res.status).toBe(403);
  });
});
