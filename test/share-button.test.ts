import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The control that lets a founder hand a conversation to their coach.
 *
 * Tai: it is hidden and not visible. It was: a muted grey pill reading
 * "Private", which states a fact and suggests no action, so nobody found it.
 */

const button = readFileSync("src/components/InteractiveHoverButton.tsx", "utf-8");
const chat = readFileSync("src/components/SprintBuddy.tsx", "utf-8");
const css = readFileSync("src/pages/index.astro", "utf-8");
const code = button.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("what it now says", () => {
  test("resting shows the state, hovering shows the act", () => {
    /*
     * The supplied component shows the same text at rest and on hover, so
     * hovering tells you nothing new. Splitting them is the entire fix here:
     * the pill has to say what clicking does, or it stays undiscoverable.
     */
    expect(chat).toContain('label={shared ? "Shared with your coach" : "Private"}');
    expect(chat).toContain('action={shared ? "Make it private" : "Share with your coach"}');
  });

  test("the accessible name carries the action too", () => {
    // It used to live only in a `title`, which is not announced reliably and
    // never appears on touch.
    expect(chat).toContain("Activate to share this conversation with your coach.");
    expect(chat).toContain("Activate to make this conversation private again.");
  });

  test("a shared thread is legible without being hovered", () => {
    expect(chat).toContain("emphasis={shared}");
    expect(css).toMatch(/\.ihb--on \{[^}]*border-color: var\(--brand-accent\)/s);
  });
});

describe("the button", () => {
  test("it brought no dependencies with it", () => {
    // The original is Tailwind utilities plus one lucide icon. The classes are
    // a stylesheet and the icon is eight path commands.
    const imports = [...button.matchAll(/^\s*import[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]!);
    expect(imports).toEqual(["react"]);
    expect(code).not.toContain("lucide");
  });

  test("both labels share one grid cell, so the pill never resizes", () => {
    /*
     * Laid out in flow, the longer hover label would widen the button as it
     * slid in and the whole header row would jump. One grid area means the
     * pill is sized by the wider of the two and stays put.
     */
    expect(css).toMatch(/\.ihb-label,\s*\n\s*\.ihb-action \{[^}]*grid-area: 1 \/ 1/s);
  });

  test("the reveal is on focus as well as hover", () => {
    // Otherwise the control is discoverable with a mouse and invisible to a
    // keyboard, which is the same bug in a different place.
    expect(css).toContain(".ihb:focus-visible .ihb-label");
    expect(css).toContain(".ihb:focus-visible .ihb-action");
    expect(css).toContain(".ihb:focus-visible .ihb-fill");
  });

  test("touch screens get a resting state that reads as a control", () => {
    /*
     * There is no hover on a phone, so the reveal never happens and the pill
     * would be back to a grey word. The dot goes and the border carries it.
     */
    expect(css).toMatch(/@media \(hover: none\) \{[\s\S]{0,220}\.ihb-fill \{ display: none; \}/);
  });

  test("the decorative half is hidden from screen readers", () => {
    // The hover label repeats the act the accessible name already states.
    expect(button).toMatch(/<span className="ihb-action" aria-hidden="true">/);
  });
});
