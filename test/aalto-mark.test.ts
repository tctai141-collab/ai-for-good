import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * The Aalto mark, beside the Sprint Buddy wordmark.
 *
 * It ships as a slot with no artwork. The mark is a trademarked asset that has
 * to be the approved file rather than something reconstructed, so this is the
 * placement and the guard; the SVG goes in by hand.
 */

const reactMark = readFileSync("src/components/AaltoMark.tsx", "utf-8");
const astroMark = readFileSync("src/components/AaltoMark.astro", "utf-8");
const app = readFileSync("src/components/App.tsx", "utf-8");
const sidebar = readFileSync("src/components/SprintBuddy.tsx", "utf-8");
const admin = readFileSync("src/pages/admin.astro", "utf-8");
const index = readFileSync("src/pages/index.astro", "utf-8");

describe("where it sits", () => {
  test("beside the wordmark in the app's sidebar", () => {
    const lockup = sidebar.slice(sidebar.indexOf('className="wordmark-liquid"') - 400);
    expect(lockup).toContain("height={20}");
    // A rule between them, which is what makes it a lockup rather than two
    // logos that happen to be near each other. The mark draws it, so it is a
    // prop here rather than a span in this file.
    expect(lockup.indexOf("wordmark-liquid")).toBeLessThan(lockup.indexOf("<AaltoMark"));
  });

  test("above the wordmark on the sign-in screen, not beside it", () => {
    /*
     * That line scrambles through three names of different lengths, so
     * anything sitting next to it would shuffle sideways every second.
     */
    expect(app).toContain("<AaltoMark height={26} />");
    expect(app.indexOf("<AaltoMark")).toBeLessThan(app.indexOf("<ScrambleText texts={PROGRAMME_NAMES} />"));
  });

  test("beside the page title on /admin, which has no wordmark", () => {
    expect(admin).toContain("<AaltoMark />");
    expect(admin).toContain('<h1>Cohort admin</h1>');
  });

  test("the divider goes when the mark goes", () => {
    /*
     * With no file on disk the mark removes itself. When the rule was the
     * caller's own span it stayed behind, so every screen showed the wordmark,
     * then a lone vertical bar, then nothing. Both halves belong to the mark.
     */
    expect(astroMark).toContain("aalto-rule");
    expect(admin).not.toContain("title-rule");
    // The astro version removes the whole lockup, not just the image.
    expect(astroMark).toContain("box.remove()");
    // The React version draws the rule only once the image has loaded.
    expect(reactMark).toContain('{rule && state === "ok" &&');
    expect(sidebar).toContain("rule={{");
  });

  test("no longer pinned to a corner", () => {
    // It was fixed bottom-right; it is part of the lockup now.
    expect(reactMark).not.toContain("position");
    expect(astroMark).not.toContain("position: fixed");
    expect(index).not.toContain("AaltoMark");
  });

  test("so the quick-actions button has its corner back", () => {
    const quick = readFileSync("src/components/QuickActions.tsx", "utf-8");
    expect(quick).toContain("bottom: 26px");
    expect(quick).toContain(".qa { right: 16px; bottom: 16px; }");
  });
});

describe("what it must never do", () => {
  test("it renders nothing when the file is not there", () => {
    // A broken-image icon beside the product's own wordmark is worse than no
    // logo at all, and the file is genuinely absent until somebody adds it.
    expect(reactMark).toContain('setState("missing")');
    expect(reactMark).toContain('if (state === "missing") return null;');
    expect(astroMark).toContain('img.addEventListener("error"');
    expect(astroMark).toContain("box.remove()");
    // A cached image can finish loading before the listener is attached.
    expect(astroMark).toContain("img.complete");
  });

  test("it is not a link", () => {
    /* It sits in the corner of a screen somebody may be typing into, and next
       to the wordmark it is a mark, not navigation. */
    for (const source of [reactMark, astroMark]) {
      expect(source).not.toContain("<a ");
      expect(source).not.toContain("href=");
    }
  });

  test("no artwork is committed, invented or reconstructed", () => {
    /* If this fails, somebody has drawn a trademark from memory. The file is
       dropped in by hand from Aalto's own approved set. */
    expect(existsSync("public/aalto-logo.svg")).toBe(false);
    for (const source of [reactMark, astroMark]) {
      expect(source).toContain("/aalto-logo.svg");
      expect(source).not.toContain("<path");
    }
  });

  test("both halves point at the same file", () => {
    // Two components because the two sides are two technologies, not because
    // they disagree.
    expect(reactMark).toContain('src="/aalto-logo.svg"');
    expect(astroMark).toContain('src="/aalto-logo.svg"');
    expect(reactMark).toContain('alt="Aalto University"');
    expect(astroMark).toContain('alt="Aalto University"');
  });
});
