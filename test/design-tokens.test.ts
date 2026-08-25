import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * The design system, after the rebuild against Linear.
 *
 * Three things here are load-bearing and all three fail silently:
 *
 *   The accent is no longer red. The old palette shipped with a comment
 *   apologising for it: the interactive accent was signal red and so is the
 *   status colour for overdue, error and strain, so accent and alarm were a
 *   shade apart. Red now means one thing. A stray red literal put back into an
 *   interactive surface undoes that without breaking anything.
 *
 *   One family. --font-serif and --font-display are read from about a hundred
 *   inline styles; repointing them at Inter *is* the migration. Pointing
 *   either back at a serif re-splits the app across two faces.
 *
 *   The two pages keep separate token blocks under different names, which is
 *   exactly how the previous recolour went straight past /admin.
 */

const index = readFileSync("src/pages/index.astro", "utf-8");
const admin = readFileSync("src/pages/admin.astro", "utf-8");
const sprint = readFileSync("src/components/SprintBuddy.tsx", "utf-8");
const quick = readFileSync("src/components/QuickActions.tsx", "utf-8");
const setup = readFileSync("src/pages/setup.astro", "utf-8");
const report = readFileSync("src/pages/report.astro", "utf-8");
const splash = readFileSync("src/components/WelcomeSplash.tsx", "utf-8");

const ACCENT = "#5e6ad2";

describe("the accent", () => {
  test("both pages carry it, under their own names", () => {
    expect(index).toContain(`--brand-accent: ${ACCENT}`);
    expect(admin).toContain(`--accent: ${ACCENT}`);
  });

  test("nothing anywhere still holds the old red accent", () => {
    // Both spellings: the literal and the rgba triple it was written as.
    for (const file of [index, admin, sprint, quick, setup]) {
      expect(file).not.toContain("#e8170a");
      expect(file).not.toContain("232, 23, 10");
    }
  });

  test("status red is a different colour from the accent", () => {
    // The whole point. If these ever converge again, an overdue deadline and a
    // primary action are the same colour.
    const red = index.match(/--brand-red: (#[0-9a-f]{6})/)![1]!;
    expect(red).not.toBe(ACCENT);
    expect(admin).toMatch(/--danger: (#[0-9a-f]{6})/);
    expect(admin.match(/--danger: (#[0-9a-f]{6})/)![1]).not.toBe(ACCENT);
  });
});

describe("one type family", () => {
  test("the serif and display tokens point at the body face", () => {
    expect(index).toContain("--font-serif: var(--font-family);");
    expect(index).toContain("--font-display: var(--font-family);");
    expect(admin).toContain("--serif: var(--font);");
  });

  test("no rule reaches for Source Serif directly", () => {
    // The tokens are the migration; a direct family name bypasses them.
    // index.astro's token comment names it, describing what was removed.
    for (const file of [admin, sprint, quick, setup, report, splash]) {
      expect(file).not.toContain("Source Serif");
    }
    expect(index.replace(/\/\*[\s\S]*?\*\//g, "")).not.toContain("Source Serif");
  });

  test("the opsz axis is gone", () => {
    /*
     * It was set on about twenty headings. This build ships static Inter
     * faces, which have no optical-size axis, so every one of those was a
     * declaration that did nothing — intent with no effect, which is worse
     * than no declaration at all.
     */
    for (const file of [index, sprint]) {
      expect(file).not.toContain("opsz");
    }
  });
});

describe("the scale", () => {
  test("headings are product-sized, not poster-sized", () => {
    // The display step existed for the login screen and ran to 5.5rem.
    const display = index.match(/--text-display: clamp\(([^)]*)\)/)![1]!;
    const max = Number(display.split(",")[2]!.trim().replace("rem", ""));
    expect(max).toBeLessThanOrEqual(3);
    // And no inline heading reaches past it either.
    for (const m of sprint.matchAll(/fontSize: "clamp\([^)]*?([\d.]+)rem\)"/g)) {
      expect(Number(m[1])).toBeLessThanOrEqual(3);
    }
  });

  test("tracking tightens as type grows", () => {
    // The one thing that makes large Inter look set rather than typed.
    expect(index).toContain("--track-display:");
    expect(index).toContain("--track-heading:");
    expect(sprint).toContain('letterSpacing: "var(--track-display)"');
  });
});

describe("mobile", () => {
  test("the docked mascot does not cover the action bar", () => {
    /*
     * Docked, it sits top-right — which on a 390px screen is on top of the
     * deadline button in the mobile action bar.
     */
    expect(index).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.persistent-buddy--docked \{\s*display: none;/);
  });

  test("the context strip does not reserve space for a mascot that is not there", () => {
    // 132px of right padding on a 390px screen left the line about 200px to
    // wrap in, which is four lines of a one-line remark.
    expect(sprint).toContain(".context-strip {");
    expect(sprint).toMatch(/@media \(max-width: 700px\) \{[\s\S]*?\.context-strip \{ padding: 12px 14px; \}/);
  });
});
