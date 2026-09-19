import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * Folds on the admin page.
 *
 * Tabs ran to nearly three screens with everything expanded: add forms open
 * above every list, two to four paragraphs explaining each tab, and closed
 * bugs and answered wishes at full length. Measured against a seeded cohort,
 * People was 2.8 screens. Now the heavy panels live behind a
 * <details class="fold">, and the page remembers which were left open.
 *
 * What these guard is not the look. It is that nothing becomes unreachable:
 * a form inside a closed fold is invisible, so everything that fills one in or
 * focuses it has to open the fold first.
 */

const admin = readFileSync("src/pages/admin.astro", "utf-8");
const script = admin.slice(admin.indexOf("<script is:inline>"));

/** The markup between an element's opening tag and the nearest enclosing fold. */
function insideFold(id: string): boolean {
  const at = admin.indexOf(`id="${id}"`);
  expect(at).toBeGreaterThan(-1);
  const before = admin.slice(0, at);
  const opened = before.lastIndexOf('<details class="fold"');
  const closed = before.lastIndexOf("</details>");
  return opened > closed;
}

describe("what is folded away", () => {
  test("every add form sits in a fold", () => {
    for (const form of ["add-one", "add-bulk", "add-deadline", "event-form", "programme-form", "bug-form", "add-book", "knowledge-form"]) {
      expect([form, insideFold(form)]).toEqual([form, true]);
    }
  });

  test("the lists people act on do not", () => {
    for (const list of ["users", "deadline-list", "event-list", "programme-list", "wish-list", "bug-list", "library-list", "shared-list", "knowledge-list"]) {
      expect([list, insideFold(list)]).toEqual([list, false]);
    }
  });

  test("closed bugs and answered wishes fold away with a count", () => {
    expect(script).toContain('data-fold="bugs-closed"');
    expect(script).toContain('data-fold="wishes-answered"');
    expect(script).toContain("closedBugs.length");
    expect(script).toContain("answeredWishes.length");
  });

  test("the usage table folds behind a one-line summary", () => {
    expect(insideFold("usage-rows")).toBe(true);
    expect(insideFold("usage-summary")).toBe(false);
  });
});

describe("nothing becomes unreachable", () => {
  test("the quick-action menu opens the fold around the field it focuses", () => {
    const go = script.slice(script.indexOf("function goToAction("), script.indexOf("function goToAction(") + 900);
    expect(go.indexOf("reveal(target)")).toBeGreaterThan(-1);
    expect(go.indexOf("reveal(target)")).toBeLessThan(go.indexOf("scrollIntoView"));
  });

  test("Edit buttons that load a form in place open its fold first", () => {
    expect(script).toContain("reveal(kbTopic);\n            kbTopic.focus();");
    expect(script).toContain('reveal(document.getElementById("bk-title"));');
  });

  test("folds remember whether they were left open, including rebuilt ones", () => {
    expect(script).toContain('const FOLD_KEY = "sprintbuddy.admin.folds"');
    expect(script).toContain('document.querySelectorAll("details.fold[data-fold]").forEach(watchFold)');
    expect(script).toContain('bugList.querySelectorAll("details.fold[data-fold]").forEach(watchFold)');
    expect(script).toContain('wishList.querySelectorAll("details.fold[data-fold]").forEach(watchFold)');
  });

  test("every fold has a name to remember it by, and names are unique", () => {
    const names = [...admin.matchAll(/data-fold="([a-z-]+)"/g)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(20);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("the copy it touched", () => {
  test("the deadline explanation no longer contradicts itself", () => {
    // It said delete "takes the completions with it and keeps the completion history".
    expect(admin).not.toContain("and keeps the completion history");
    expect(admin).toContain("takes its completions with it");
  });
});

describe("long lists", () => {
  test("programme months after next fold into Later, and editing inside it opens it", () => {
    // Programme was the tallest tab after the first pass: every future month listed.
    expect(script).toContain('data-fold="events-later"');
    expect(script).toContain("slot.appendChild(eventForm); reveal(slot);");
    expect(script).toContain('eventList.querySelectorAll("details.fold[data-fold]").forEach(watchFold)');
  });

  test("each wish's reply box is folded", () => {
    // An open textarea under every wish was most of that tab's height.
    expect(script).toContain('<details class="fold wish-replyfold">');
  });
});
