import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { applyKey, type KeyOutput } from "../src/components/OnScreenKeyboard";

/**
 * The on-screen keyboard.
 *
 * The supplied component renders a keyboard and produces no output — it
 * animates a keycap, plays a sound, shows the pressed key in a caption, and
 * nothing reaches a text field. Dropped in as-is it would be an ornament under
 * the composer that looks broken the moment somebody tries to write with it.
 * So the interesting tests here are about what comes out.
 *
 * applyKey is pure for exactly that reason: it is the one piece both hosts
 * share, and it can be checked without a browser.
 */

const kb = readFileSync("src/components/OnScreenKeyboard.tsx", "utf-8");
const composer = readFileSync("src/components/SprintBuddy.tsx", "utf-8");
const toggle = readFileSync("src/components/GlassToggle.tsx", "utf-8");
const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

const char = (c: string): KeyOutput => ({ type: "char", char: c });

describe("inserting at the caret", () => {
  test("types into an empty field", () => {
    expect(applyKey("", 0, 0, char("H"))).toEqual({ value: "H", caret: 1 });
  });

  test("inserts in the middle, not at the end", () => {
    // "helo" with the caret after "hel" → "hello"
    expect(applyKey("helo", 3, 3, char("l"))).toEqual({ value: "hello", caret: 4 });
  });

  test("replaces a selection", () => {
    expect(applyKey("hello", 1, 4, char("a"))).toEqual({ value: "hao", caret: 2 });
  });

  test("space and enter are characters too", () => {
    expect(applyKey("hi", 2, 2, { type: "space" })).toEqual({ value: "hi ", caret: 3 });
    expect(applyKey("hi", 2, 2, { type: "enter" })).toEqual({ value: "hi\n", caret: 3 });
  });
});

describe("backspace", () => {
  test("deletes the character before the caret", () => {
    expect(applyKey("hello", 5, 5, { type: "backspace" })).toEqual({ value: "hell", caret: 4 });
  });

  test("deletes in the middle", () => {
    expect(applyKey("hello", 3, 3, { type: "backspace" })).toEqual({ value: "helo", caret: 2 });
  });

  test("deletes a selection rather than one character", () => {
    expect(applyKey("hello", 1, 4, { type: "backspace" })).toEqual({ value: "ho", caret: 1 });
  });

  test("at the start it does nothing, rather than throwing or wrapping", () => {
    expect(applyKey("hello", 0, 0, { type: "backspace" })).toEqual({ value: "hello", caret: 0 });
    expect(applyKey("", 0, 0, { type: "backspace" })).toEqual({ value: "", caret: 0 });
  });
});

describe("the two bugs this had, which only showed up under fast input", () => {
  test("applyKey takes a value, not an element", () => {
    /*
     * The first version read el.value and el.selectionStart off the DOM. For a
     * React-controlled textarea those are last render's, so two presses inside
     * one frame both start from the same string and the second discards the
     * first. Typing "Hi there" produced "err422Y" — reproduced in a browser,
     * not theorised. Slow human typing hid it entirely.
     */
    expect(kb).toContain("export function applyKey(\n  value: string,");
    expect(kb).not.toContain("el.selectionStart ?? value.length");
  });

  test("the composer computes from React state, not the DOM", () => {
    expect(composer).toContain("setInput((prev) => {");
    expect(composer).toContain("caretRef.current = caret;");
  });

  test("modifier state lives in refs, written inside the handler", () => {
    /*
     * The second one. Mirroring state into a ref during render looks
     * equivalent and is not: Shift then H inside one frame read the pre-Shift
     * value and produced a lowercase h.
     */
    expect(kb).toContain("shiftRef.current = !shiftRef.current;");
    expect(kb).toContain("capsRef.current = !capsRef.current;");
    expect(kb).not.toContain("shiftRef.current = shiftOn;");
  });

  test("shift is one-shot and caps is not", () => {
    expect(kb).toContain("const upper = shiftRef.current !== capsRef.current;");
    expect(kb).toContain("clearShift();");
  });
});

describe("what was left out of the supplied component", () => {
  test("no new dependency", () => {
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps).not.toContain("motion");
    expect(deps).not.toContain("framer-motion");
  });

  test("no 30KB audio sample in the bundle", () => {
    // It would ship to everybody whether or not they ever open the keyboard.
    // The click is synthesised instead.
    expect(kb).not.toContain("data:@file/ogg");
    expect(kb).not.toContain("base64ToArrayBuffer");
    expect(kb).toContain("ctx.createBuffer(1, frames, ctx.sampleRate)");
  });

  test("no global keydown listener", () => {
    // The original binds one to highlight keycaps and calls preventDefault on
    // Alt. A listener that swallows modifiers app-wide is not worth a
    // highlight, least of all for people not using a physical keyboard.
    expect(kb).not.toContain('addEventListener("keydown"');
    expect(kb).not.toContain("CODE_TO_KEY_ID");
  });

  test("the switch is a real control", () => {
    // The original is a div with onClick: no role, no keyboard, invisible to a
    // screen reader — a poor thing to build for an accessibility feature.
    expect(toggle).toContain('type="checkbox"');
    expect(toggle).toContain('role="switch"');
    expect(toggle).toContain("aria-label={label}");
  });
});

describe("where it appears", () => {
  test("the founder composer, and nowhere else", () => {
    expect(composer).toContain("<OnScreenKeyboard onKey={onKeyboardKey} />");
    // Insertion still goes through the shared rules rather than the DOM.
    expect(composer).toContain("applyKey(");
  });

  test("not on /admin", () => {
    /*
     * It was under the broadcast box, on the reasoning that /admin has no chat
     * and that is the one place an organizer writes prose. In practice it made
     * a dense operations page worse: a vintage keyboard under a form is
     * furniture, and organizers are at a desk with a real one.
     */
    const admin = readFileSync("src/pages/admin.astro", "utf-8");
    expect(admin).not.toContain("KeyboardFor");
    expect(admin).not.toContain("OnScreenKeyboard");
  });

  test("off by default, and remembered once chosen", () => {
    // Somebody who needs it needs it every time; somebody who does not should
    // not meet it twice.
    expect(composer).toContain('localStorage.getItem("sprintbuddy.osk") === "1"');
  });
});
