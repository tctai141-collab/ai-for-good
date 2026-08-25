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
    // It was width 0 plus a button floating over the conversation. The exact
    // number now depends on screen size — see the phone case below.
    expect(app).toContain("width: open ? 304 : railWidth");
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

describe("the composer is not a tray of controls", () => {
  test("the keyboard switch is outside the box, not in it", () => {
    /*
     * The row had a textarea and three controls sharing one rounded rectangle.
     * The mic and Send act on the message being written and stay; this is a
     * mode switch for the whole composer and belongs beside the box.
     */
    const box = app.slice(app.indexOf('<div className="composer-box"'), app.indexOf('className="composer-switch"'));
    expect(box).toContain("<VoiceInput");
    expect(box).toContain('className="send-button"');
    // The switch appears only after the box has closed.
    expect(box).not.toContain("<GlassToggle");
    expect(app).toContain('className="composer-switch"');
  });

  test("out there it can carry a visible label", () => {
    // Inside the box it was a bare switch explained only by a tooltip.
    const sw = app.slice(app.indexOf('className="composer-switch"'), app.indexOf('className="composer-switch"') + 420);
    expect(sw).toContain("<span>Keyboard</span>");
    expect(sw).toContain('htmlFor="osk-toggle"');
  });

  test("it stacks under the box on a phone rather than squeezing it", () => {
    expect(app).toContain(".composer-row { flex-direction: column;");
  });
});

describe("the composer cannot overflow its own box", () => {
  test("the text column may shrink below the textarea's intrinsic width", () => {
    /*
     * Regression, found by measuring rather than looking. A flex child's
     * min-width is auto, so the textarea's intrinsic width became a floor the
     * column would not go below and Send was pushed out through the right-hand
     * edge of the box. Only visible once the column got narrow enough.
     */
    expect(app).toContain('position: "relative", flex: 1, minWidth: 0, display: "flex"');
    expect(app).toContain('style={{ flex: 1, minWidth: 0, background: "transparent"');
  });
});

describe("the rail on a phone", () => {
  test("it narrows rather than disappearing", () => {
    /*
     * The sidebar is forced closed below 700px, so the rail is the only way to
     * reach anything — it cannot go back to the zero width collapsed used to
     * mean, because the floating expand button it replaced is gone. But 64px
     * of a 390px screen is a sixth of the display given to icons.
     */
    expect(app).toContain("setRailWidth(media.matches ? 48 : 64)");
    expect(app).toContain("width: open ? 304 : railWidth");
  });
});

describe("nothing runs off the bottom of a short screen", () => {
  test("the footer is pinned and the region above it scrolls", () => {
    /*
     * Regression, measured rather than eyeballed. On a 660px-tall laptop the
     * sidebar's fixed blocks plus a thread list with a 96px floor came to more
     * than the panel had, and the overflow left through the bottom: Sign out
     * sat 96px below the viewport with no way to reach it. A sidebar whose
     * last item is unreachable is a sidebar with no sign-out.
     */
    expect(app).toContain('flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column"');
  });

  test("minHeight 0, which is the part that actually does the work", () => {
    // A flex child's automatic minimum is its content size, so without this
    // the region refuses to shrink and pushes the footer out exactly as before.
    const region = app.slice(app.indexOf("Everything above the footer scrolls"), app.indexOf("<Tasks state={deadlines}"));
    expect(region).toContain("minHeight: 0");
  });

  test("both footers refuse to shrink", () => {
    // Founder and coach. Whichever gives way first is the one that vanishes.
    const footers = app.match(/borderTop: `2px solid var\(--line-strong\)`[^}]*\}/g) ?? [];
    expect(footers.length).toBe(2);
    for (const footer of footers) expect(footer).toContain("flexShrink: 0");
  });

  test("the thread list no longer carries a floor that pushed the footer out", () => {
    expect(app).not.toContain("minHeight: 96");
  });

  test("the keyboard gets more clearance than a bare composer", () => {
    // 18px was the whole gap whether or not sixty keys were sitting there, and
    // a keyboard flush with the bottom edge reads as cut off.
    const composer = app.slice(app.indexOf("Bottom padding is its own value"), app.indexOf("{/* composer */}") + 900);
    expect(app).toContain('keyboardOn ? "12px 24px calc(40px');
    expect(app).toContain('"12px 24px calc(30px');
    expect(composer.length).toBeGreaterThan(0);
  });

  test("the bottom edge is given real room, not just clearance on paper", () => {
    /*
     * 24 and 26px measured clear and still read as touching the edge. A
     * control that looks like it is falling off the screen is one people
     * hesitate over whether or not it actually is.
     */
    expect(app).toContain('padding: "24px 20px calc(40px + env(safe-area-inset-bottom, 0px))"');
    expect(app).toContain('padding: "18px 0 calc(34px + env(safe-area-inset-bottom, 0px))"');
  });

  test("the phone's home-indicator strip is added on top", () => {
    // Where the browser's own furniture eats the last few pixels.
    expect((app.match(/env\(safe-area-inset-bottom, 0px\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
