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
    for (const key of ["chat", "checkin", "programme", "wishes", "reflections", "library"]) {
      expect(rail).toContain(`key: "${key}"`);
    }
    expect(rail).toContain("onSignOut");
  });

  test("the library is reachable from the panel too, not only the rail", () => {
    /* The rail and the expanded panel are two renderings of the same
       navigation, and a destination added to one and not the other is
       unreachable for whichever half of the cohort keeps the sidebar that
       way. Peek reuses the panel, so this covers that as well. */
    expect(app).toContain("onClick={onLibrary}");
    expect(app).toContain('view === "library"');
  });

  test("an overdue book can shout, the way an overdue deadline does", () => {
    // The count is the whole reason the badge exists: the page is where the
    // detail lives, and the sidebar only has to say that something is wrong.
    expect(app).toContain("library.overdueCount > 0");
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
    /* The !open half is what this test is about and has not changed. The
       guard gained a second condition — see sidebar-peek.test.ts: a tap on a
       phone synthesises the hover that opened this panel over the page, so it
       now also asks whether the device hovers at all. Written as two
       assertions rather than one literal so that adding a third condition
       later does not read as this rule being broken. */
    expect(app).toMatch(/onMouseEnter=\{\(\) => \{ if \(!open[^)]*\) setPeek\(true\); \}\}/);
    expect(app).toContain("if (!open && canHover) setPeek(true)");
  });
});

describe("the expanded panel is grouped", () => {
  test("conversations sit above the check-in", () => {
    /*
     * Talking to Sprint Buddy is what a founder opens the app to do, so the
     * thing they came for is not under two things they are being asked for.
     * Deadlines and the schedule stay above as the state of the world.
     */
    const panel = app.slice(app.indexOf("const panel = ("));
    /* The deadline summary and the "What's on" rail have both left the
       sidebar: one is a page of its own now, the other was a second copy of
       the Programme page. What is left is what a founder came to do. */
    const order = ["New conversation", "Pick up where you left off", "Today's check-in"];
    let at = -1;
    for (const marker of order) {
      const found = panel.indexOf(marker);
      expect(found).toBeGreaterThan(at);
      at = found;
    }
  });

  test("the check-in cannot scroll away behind the conversations", () => {
    /*
     * Found by rendering it with twelve conversations: the list is bounded and
     * scrolls, but the region holding it scrolls too, so the check-in and
     * "What's on" both fell off the bottom of a sidebar that looked complete.
     * The check-in is pinned outside that region now.
     */
    expect(app).toContain("Pinned, not scrolled");
    const pinned = app.slice(app.indexOf("Pinned, not scrolled"));
    // It is outside the scrolling region, and the footer follows it.
    expect(pinned.indexOf("Today's check-in")).toBeLessThan(pinned.indexOf("Elsewhere"));
    // And the list itself is capped rather than floored.
    expect(app).toContain("maxHeight: 300");
    expect(app).not.toContain("minHeight: 96");
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

describe("the rail is exactly as wide as it says", () => {
  test("width is pinned on every axis the flex algorithm reads", () => {
    /*
     * Regression, found by measuring rather than looking. The aside carried
     * width alone and computed to 64px around a 48px rail on a phone — sixteen
     * pixels of conversation given away with nothing drawn in them. A flex
     * item's used width comes from flex-basis and its automatic minimum, not
     * from width, so width alone is a suggestion.
     */
    const aside = app.slice(app.indexOf("Pinned on every axis"), app.indexOf("onMouseEnter={() =>"));
    for (const prop of ["width:", "minWidth:", "maxWidth:", "flexBasis:"]) {
      expect(aside).toContain(`${prop} open ? 304 : railWidth`);
    }
    expect(aside).toContain("flexShrink: 0");
    expect(aside).toContain("flexGrow: 0");
  });
});

describe("deadlines got a page", () => {
  const tasks = readFileSync("src/components/Tasks.tsx", "utf-8");

  test("out of the sidebar and into a view of its own", () => {
    /*
     * The sidebar block had to be a summary: three rows, a count and a "+4
     * more" that hid the rest. Deadlines are the one thing in the programme
     * with a date and a consequence, so reading them should not mean expanding
     * a strip in a navigation column.
     */
    expect(app).not.toContain("<Tasks state={deadlines} />");
    expect(app).toContain("<DeadlinesPage state={deadlines} />");
  });

  test("the same rows and the same toggle, so ticking off behaves as it did", () => {
    // Reused rather than rewritten; a second implementation is a second set of
    // bugs and a chance for the two to disagree about what "done" means.
    const page = tasks.slice(tasks.indexOf("export function DeadlinesPage"));
    expect(page).toContain("<Row key={item.id} item={item} onToggle={toggle} busy={busyId === item.id} />");
  });

  test("grouped by when, with done last and folded away", () => {
    const page = tasks.slice(tasks.indexOf("export function DeadlinesPage"));
    for (const key of ["overdue", "thisWeek", "upcoming", "done"]) {
      expect(page).toContain(`key: "${key}"`);
    }
    expect(page.indexOf('key: "overdue"')).toBeLessThan(page.indexOf('key: "done"'));
    /*
     * Quiet by being closed, not by being faint. This pinned
     * `.dl-group.is-done { opacity: 0.55; }` — a section permanently rendered
     * at just over half legibility, which by week three is also the longest
     * list on the page and sits between the founder and the work still to do.
     * It is a disclosure now, shut until asked for.
     */
    expect(page).toContain("const [archiveOpen, setArchiveOpen] = useState(false)");
    expect(page).toContain("aria-expanded={archiveOpen}");
    expect(page).toContain("{archiveOpen && (");
    expect(tasks).not.toContain("opacity: 0.55");
  });

  test("folding the archive cannot swallow what was just ticked", () => {
    /*
     * Ticking something moves it into the done group, and if that group is
     * shut the row would vanish from under the cursor with no way to untick a
     * mistake. `pinned` already holds a row in its original group for the rest
     * of the session, which is what makes closing the archive safe — so the
     * two are checked together rather than separately.
     */
    expect(tasks).toContain("const [pinned, setPinned] = useState<Set<string>>");
  });

  test("the overdue count still shouts, from the nav entry", () => {
    // That was the sidebar block's one job worth keeping at a glance.
    const at = app.indexOf("onClick={onDeadlines}");
    expect(at).toBeGreaterThan(-1);
    const entry = app.slice(at, at + 700);
    expect(entry).toContain("deadlines.overdueCount > 0");
    expect(entry).toContain("background: C.red");
  });

  test("and the collapsed rail opens the page rather than the sidebar", () => {
    const rail = app.slice(app.indexOf("function SidebarRail"));
    expect(rail).toContain('{ key: "deadlines", glyph: "◱", label: "Deadlines"');
    // The overdue chip used to expand the sidebar, which showed a summary.
    expect(rail).toContain("onClick={onDeadlines}");
  });

  test("it does not fall over when the deadlines fail to load", () => {
    /* The sidebar block returned null and vanished. A page cannot vanish, so
       it says what happened. */
    const page = tasks.slice(tasks.indexOf("export function DeadlinesPage"));
    expect(page).toContain("if (!data) {");
    expect(page).toContain("These did not load");
  });
});
