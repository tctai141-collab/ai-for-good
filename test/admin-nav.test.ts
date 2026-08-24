import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createOrganizer, get, startServer, type Harness, type Session } from "./helpers/harness";

/**
 * The admin page's two navigation surfaces: the tab bar and the quick-actions
 * menu in the bottom-right corner.
 *
 * Both are vanilla JS inside the one inline script, which no typecheck looks
 * inside, so the assertions here read the served HTML the way the date-picker
 * suite does.
 *
 * What is actually worth guarding:
 *
 *   The quick menu is a shortcut to a *field*, not to a tab. If the ids it
 *   focuses drift, every item still opens the right tab and silently stops
 *   doing the thing that makes it better than the tab bar. Those ids are
 *   checked against the markup here, in both directions.
 *
 *   The tab pill is positioned from `offsetLeft`, not from a rect. The bar
 *   scrolls horizontally, and a rect-based version puts the pill in the wrong
 *   place the moment it is scrolled — visible only on a narrow window, which
 *   is exactly where nobody looks.
 *
 *   The pill is the only thing painting a selected state. Nothing may give a
 *   tab a background of its own, or the two disagree.
 */

let h: Harness;
let organizer: Session;
let html: string;
/** The inline script, comments stripped. */
let script: string;

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/*
 * The style block, read from source rather than from the response: Astro
 * hoists page styles into a linked stylesheet at build time, and the harness
 * serves the build, so the served HTML carries no <style> at all.
 */
const css = strip(
  readFileSync("src/pages/admin.astro", "utf-8").match(/<style[^>]*>([\s\S]*?)<\/style>/)![1]!,
);

/*
 * The quick menu is a React island shared with the founder-side app, so its
 * behaviour and its CSS live in the component, not in this page. It is
 * server-rendered (client:load, not client:only), which is why the markup
 * assertions below can still read it out of the response.
 */
const quick = strip(readFileSync("src/components/QuickActions.tsx", "utf-8"));

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
  html = await (await get(h, "/admin", organizer.cookie)).text();

  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  script = strip(scripts.find((block) => block.includes("function showTab"))!);
});

afterAll(() => h?.stop());

describe("quick actions", () => {
  test("every item names a tab that exists", () => {
    const tabs = new Set(
      [...html.matchAll(/class="tab" data-tab="([a-z]+)"/g)].map((m) => m[1]!),
    );
    const targets = [...html.matchAll(/class="qa-item" data-go="([a-z]+)"/g)].map((m) => m[1]!);
    expect(targets.length).toBe(5);
    for (const target of targets) expect(tabs).toContain(target);
  });

  test("every item focuses a field that exists", () => {
    // The whole point of the menu over the tab bar. A stale id here degrades
    // it to a second tab bar without any error.
    const focused = [...html.matchAll(/data-focus="([a-z-]+)"/g)].map((m) => m[1]!);
    expect(focused.length).toBe(5);
    for (const id of focused) expect(html).toContain(`id="${id}"`);
  });

  test("each item's field lives in the tab that item opens", () => {
    // Focusing a field inside a hidden panel scrolls nowhere and puts the
    // caret nowhere. Checked by locating each id inside its own tabpanel.
    const panels = [...html.matchAll(/<div class="tabpanel" id="tab-([a-z]+)"[\s\S]*?(?=<div class="tabpanel"|<\/main>)/g)];
    const owner = new Map<string, string>();
    for (const panel of panels) {
      for (const m of panel[0].matchAll(/id="([a-z-]+)"/g)) owner.set(m[1]!, panel[1]!);
    }
    const items = [...html.matchAll(/data-go="([a-z]+)" data-focus="([a-z-]+)"/g)];
    expect(items.length).toBe(5);
    for (const [, tab, field] of items) expect(owner.get(field!)).toBe(tab!);
  });

  test("the menu is hidden until the component is running", () => {
    // With no JS the buttons do nothing, and five dead circles in the corner
    // are worse than none. Server-rendered hidden, unhidden on mount.
    expect(html).toMatch(/class="qa[^"]*" id="qa" hidden/);
    expect(quick).toContain("useEffect(() => setReady(true), [])");
    expect(quick).toContain("hidden={!ready}");
  });

  test("parked items are out of the tab order", () => {
    // Otherwise five invisible buttons sit between the page and whatever
    // follows it for anyone tabbing through.
    expect(quick).toContain("tabIndex={open ? 0 : -1}");
  });

  test("Escape closes it and returns focus to the trigger", () => {
    expect(quick).toContain('event.key !== "Escape"');
    expect(quick).toContain("trigger.current?.focus()");
  });

  test("the trigger says what it is to a screen reader", () => {
    // The button's only visible content is a plus glyph.
    expect(html).toMatch(/class="qa-trigger"[^>]*aria-expanded="false"/);
    expect(html).toContain("Quick actions</span>");
    expect(quick).toContain("aria-expanded={open}");
  });

  test("it is fixed, so it stays put while a long tab scrolls", () => {
    expect(quick).toMatch(/\.qa \{[^}]*position: fixed/);
  });

  test("the two placements are one component", () => {
    // 130 lines of arc geometry in two stylesheets would drift the first time
    // either was touched.
    expect(readFileSync("src/pages/admin.astro", "utf-8")).toContain(
      '<QuickActions client:load mode="inline" />',
    );
    expect(readFileSync("src/components/App.tsx", "utf-8")).toContain(
      '<QuickActions mode="navigate" />',
    );
    // And the page's own stylesheet no longer carries a copy.
    expect(css).not.toContain(".qa-item");
  });

  test("from the founder app it links, carrying the same instruction", () => {
    // It cannot switch a tab on a page it is not on. Landing on the admin
    // front door with the form four tabs away is the thing this avoids.
    expect(quick).toContain("/admin?go=${tab}&focus=${focus}");
    expect(script).toContain('params.get("go")');
    expect(script).toContain('params.get("focus")');
  });

  test("the arriving instruction is taken out of the address bar", () => {
    // A reload would otherwise re-run it and steal focus from wherever the
    // organizer had moved to.
    expect(script).toContain('history.replaceState(null, "", location.pathname)');
  });

  test("in place it goes through the same handler as an arrival", () => {
    expect(quick).toContain('new CustomEvent(QUICK_ACTION_EVENT');
    expect(script).toContain('window.addEventListener("sprintbuddy:quick-action"');
    expect(script.match(/function goToAction\(/g)?.length).toBe(1);
  });
});

describe("the tab bar", () => {
  test("the pill is positioned from layout offsets, not from a rect", () => {
    // The bar scrolls horizontally. getBoundingClientRect is viewport-relative
    // and would put the pill in the wrong place on a scrolled bar.
    // Scoped to moveCursor: the date picker elsewhere in this script uses a
    // rect legitimately, and a check that cannot tell the two apart is not one.
    const body = script.slice(
      script.indexOf("function moveCursor"),
      script.indexOf("function moveCursor") + 500,
    );
    expect(body).toContain("tab.offsetLeft");
    expect(body).toContain("tab.offsetWidth");
    expect(body).not.toContain("getBoundingClientRect");
  });

  test("selecting a tab moves the pill", () => {
    // showTab is called on click, on load, and from the quick menu; if the
    // pill is not moved there it only ever follows the pointer.
    expect(script).toMatch(/localStorage\.setItem\(TAB_KEY[\s\S]{0,80}moveCursor\(selectedTab\(\)\)/);
  });

  test("leaving the bar sends the pill back to the open tab", () => {
    expect(script).toContain('"pointerleave", () => moveCursor(selectedTab())');
  });

  test("hover is ignored for touch", () => {
    // A tap fires pointerenter and never fires pointerleave, so on a phone the
    // pill would stay parked under whatever was last touched.
    expect(script).toContain('event.pointerType === "touch"');
  });

  test("the pill is re-placed once the webfont has loaded", () => {
    // Label widths change when it lands; a width measured before that leaves
    // the pill short of its tab.
    expect(script).toContain("document.fonts.ready.then");
  });

  test("no tab paints its own selected background", () => {
    // The pill plus mix-blend-difference is the entire selected state. A
    // background on the tab itself would fight it.
    expect(css).not.toMatch(/\.tab\[aria-selected="true"\]/);
    expect(css).toMatch(/\.tab \{[^}]*background: transparent/);
    expect(css).toMatch(/\.tab \{[^}]*mix-blend-mode: difference/);
  });

  test("the bar isolates the blend", () => {
    // Without isolation the labels blend against whatever the page paints
    // behind the bar rather than against the bar and the pill.
    expect(css).toMatch(/\.tabs \{[^}]*isolation: isolate/);
  });

  test("the focus ring opts out of the blend", () => {
    // A blended ring inverts along with the label and disappears over the pill.
    expect(css).toMatch(/\.tab:focus-visible \{[^}]*mix-blend-mode: normal/);
  });

  test("the bar is not in the app's red", () => {
    // Explicit: the effect is black and white and was asked to stay that way.
    // Sliced to the bar's own declarations: the focus ring below it uses the
    // accent on purpose, and that is not part of the effect.
    const bar = css.slice(css.indexOf(".tabs {"), css.indexOf(".tab:focus-visible"));
    expect(bar.length).toBeGreaterThan(400);
    expect(bar).not.toContain("var(--accent)");
    // Every colour in it is white, near-black, or a white alpha.
    for (const colour of bar.match(/#[0-9a-fA-F]{3,8}/g) ?? []) {
      expect(["#fff", "#0b0c0f"]).toContain(colour);
    }
    expect(bar).toMatch(/\.tab-cursor \{[^}]*background: #fff/);
  });
});

describe("class names", () => {
  test("the quick menu namespaces everything it owns", () => {
    /*
     * It mounts on a page that also carries SprintBuddy's global stylesheet.
     * The obvious names collided — the check-in strip called its caption
     * .quick-label too — and whichever <style> mounted second silently won.
     * Prefixing is the fix; this stops it drifting back.
     */
    const sprint = readFileSync("src/components/SprintBuddy.tsx", "utf-8");
    const owned = [...quick.matchAll(/className="([a-z-]+)"/g)].map((m) => m[1]!);
    expect(owned.length).toBeGreaterThan(3);
    for (const name of owned) {
      expect(name.startsWith("qa")).toBe(true);
      expect(sprint).not.toContain(`.${name} `);
      expect(sprint).not.toContain(`.${name}{`);
    }
  });
});
