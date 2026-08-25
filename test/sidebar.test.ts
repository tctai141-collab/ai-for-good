import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * The sidebar: an icon rail when collapsed, a panel that peeks over the page.
 *
 * Rebuilt from a supplied component whose one good idea was shrinking to icons
 * rather than to nothing. These assertions are mostly about the two things that
 * would quietly regress: that collapsing still leaves the destinations
 * reachable, and that peeking does not move the page.
 */

const app = readFileSync("src/components/SprintBuddy.tsx", "utf-8");
const rail = app.slice(app.indexOf("function SidebarRail"), app.indexOf("const railButton"));

describe("collapsed is a rail, not a void", () => {
  test("it keeps real width", () => {
    // It was width 0 plus a button floating over the conversation.
    expect(app).toContain("width: open ? 304 : 64");
    expect(app).not.toContain("width: open ? 304 : 0");
  });

  test("the floating expand button it replaced is gone", () => {
    expect(app).not.toContain("{!sidebarOpen && (");
    // And the column no longer pads itself to dodge that button.
    expect(app).not.toContain('sidebarOpen ? "24px" : "60px"');
  });

  test("every founder destination is on the rail", () => {
    for (const key of ["chat", "checkin", "programme", "wishes", "reflections"]) {
      expect(rail).toContain(`key: "${key}"`);
    }
    expect(rail).toContain("onSignOut");
  });

  test("staff get their two cohort-wide views", () => {
    expect(rail).toContain('key: "cohort"');
    expect(rail).toContain('key: "programme"');
  });

  test("no icon is left to speak for itself", () => {
    /*
     * An icon with no accessible name is a rebus. Every rail button carries
     * both a title (the pointer) and an aria-label (everything else).
     */
    const buttons = rail.split("<button").slice(1);
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const button of buttons) {
      const head = button.slice(0, button.indexOf(">"));
      expect(head).toContain("aria-label");
      expect(head).toContain("title");
    }
  });

  test("the overdue count rides the rail", () => {
    // Otherwise the one urgent thing is the thing you must expand to discover.
    expect(rail).toContain("deadlines.overdueCount > 0");
  });

  test("the rail is not hidden from assistive tech", () => {
    // aria-hidden={!open} was correct when collapsed meant zero width.
    expect(app).not.toContain("aria-hidden={!open}");
  });
});

describe("peeking does not move the page", () => {
  test("the peek panel is positioned over the content", () => {
    /*
     * The supplied component animates the sidebar's own width on hover, which
     * reflows the conversation every time the pointer crosses the left edge.
     */
    const peek = app.slice(app.indexOf("{!open && peek && ("), app.indexOf("{!open && peek && (") + 700);
    expect(peek).toContain('position: "absolute"');
    expect(peek).toContain("width: 304");
  });

  test("pinning it open closes the peek", () => {
    expect(app).toContain("useEffect(() => { if (open) setPeek(false); }, [open]);");
  });

  test("the panel's toggle does not lie about what it does", () => {
    // The same panel is the peek, where that button pins rather than collapses.
    expect(app).toContain('aria-label={open ? "Collapse sidebar" : "Keep sidebar open"}');
    expect(app).toContain('{open ? "‹" : "›"}');
  });

  test("peek only ever opens from the collapsed state", () => {
    expect(app).toContain("onMouseEnter={() => { if (!open) setPeek(true); }}");
  });
});

describe("the expanded panel is grouped", () => {
  test("today's obligations sit together, above the schedule", () => {
    const panel = app.slice(app.indexOf("const panel = ("), app.indexOf("<ProgrammeRail"));
    // Deadlines, then the check-in; "What's on" is reference and follows.
    expect(panel.indexOf("<Tasks state={deadlines} />")).toBeLessThan(panel.indexOf("Today's check-in"));
  });

  test("the navigation group is labelled rather than orphaned under a rule", () => {
    expect(app).toContain("Elsewhere");
  });
});
