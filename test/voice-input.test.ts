import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { appendTranscript, levelFromBytes, speechRecognizer } from "../src/components/VoiceInput";

/**
 * Dictation into the composer.
 *
 * The property worth guarding above all others is that it does not send. What
 * a microphone thought it heard is a draft; a founder telling their coach the
 * wrong thing because a model mangled a sentence is not recoverable by editing
 * it afterwards.
 */

const source = readFileSync("src/components/VoiceInput.tsx", "utf-8");
const app = readFileSync("src/components/SprintBuddy.tsx", "utf-8");
const orb = readFileSync("src/components/VoiceOrb.tsx", "utf-8");

/* Comments stripped before any "must not contain" assertion. The note in
   VoiceOrb explaining why ogl was *not* used contains the word "ogl", and this
   file has failed on its own prose before. */
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("it dictates, it does not send", () => {
  test("nothing in the voice component sends or posts", () => {
    const stripped = strip(source);
    expect(stripped).not.toContain("fetch(");
    expect(stripped).not.toContain("send(");
  });

  test("the host puts the phrase in the box and nowhere else", () => {
    /* Bounded to the element itself. A fixed character window ran past it and
       into the Send button's own onClick, which is exactly the thing that is
       supposed to be there. */
    const from = app.indexOf("<VoiceInput");
    const wiring = app.slice(from, app.indexOf("/>", from));
    expect(wiring).toContain("appendTranscript");
    expect(wiring).toContain("setInput");
    // Not auto-submitting on a settled phrase.
    expect(wiring).not.toContain("send()");
  });
});

describe("joining what it heard onto what is there", () => {
  test("the first phrase is capitalised", () => {
    expect(appendTranscript("", "we should raise prices")).toBe("We should raise prices");
    expect(appendTranscript("   ", "hello there")).toBe("Hello there");
  });

  test("words are not glued together", () => {
    expect(appendTranscript("We should", "raise prices")).toBe("We should raise prices");
  });

  test("an existing trailing space is not doubled", () => {
    expect(appendTranscript("We should ", "raise prices")).toBe("We should raise prices");
  });

  test("a new sentence starts with a capital", () => {
    expect(appendTranscript("We should raise prices.", "the pilot proves it"))
      .toBe("We should raise prices. The pilot proves it");
    expect(appendTranscript("Is that right?", "probably not"))
      .toBe("Is that right? Probably not");
  });

  test("mid-sentence stays lower case", () => {
    expect(appendTranscript("We should", "probably wait")).toBe("We should probably wait");
  });

  test("an empty or blank phrase changes nothing", () => {
    expect(appendTranscript("We should", "")).toBe("We should");
    expect(appendTranscript("We should", "   ")).toBe("We should");
  });
});

describe("the level meter", () => {
  test("silence is zero and a full frame is one", () => {
    expect(levelFromBytes(new Uint8Array(32))).toBe(0);
    expect(levelFromBytes(new Uint8Array(32).fill(255))).toBe(1);
  });

  test("an empty frame does not divide by zero", () => {
    expect(levelFromBytes(new Uint8Array(0))).toBe(0);
  });

  test("it rises with loudness and stays inside the range", () => {
    const quiet = levelFromBytes(new Uint8Array(32).fill(10));
    const loud = levelFromBytes(new Uint8Array(32).fill(120));
    expect(quiet).toBeLessThan(loud);
    for (const v of [0, 10, 120, 255]) {
      const level = levelFromBytes(new Uint8Array(32).fill(v));
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
    }
  });
});

describe("browsers that cannot do it", () => {
  test("the prefixed constructor counts", () => {
    const plain = function () {} as unknown as new () => never;
    expect(speechRecognizer({ SpeechRecognition: plain } as never)).toBe(plain);
    expect(speechRecognizer({ webkitSpeechRecognition: plain } as never)).toBe(plain);
  });

  test("Firefox has neither, and gets no button rather than a broken one", () => {
    expect(speechRecognizer({} as never)).toBeNull();
    expect(source).toContain("if (!supported) return null;");
  });
});

describe("what it tells you before it listens", () => {
  test("the tradeoff is stated before the microphone opens, not after", () => {
    /*
     * Chrome's speech API streams audio to Google. Sprint Buddy's promise is
     * that nothing a founder writes is read by anybody else, so the one feature
     * that leaves the machine has to say so first.
     */
    expect(source).toContain("speech is sent to Google");
    expect(source).toContain('role="dialog"');
    // The consent gate is checked in the toggle, before start() is called.
    const toggle = source.slice(source.indexOf("const toggle = useCallback"), source.indexOf("const accept = useCallback"));
    expect(toggle).toContain("setAsking(true)");
    expect(toggle).toContain("return;");
  });

  test("agreeing is remembered, so it is asked once and not every time", () => {
    expect(source).toContain('localStorage.setItem(CONSENT_KEY, "1")');
  });

  test("declining does not open the microphone", () => {
    const gate = source.slice(source.indexOf("if (!understood)"), source.indexOf("}, [listening, start, teardown]);"));
    expect(gate).toContain("setAsking(true)");
    expect(gate.indexOf("return;")).toBeLessThan(gate.indexOf("void start()"));
  });
});

describe("it lets go of the microphone", () => {
  test("tracks are stopped and the audio context closed", () => {
    // A page that keeps the recording indicator lit is a page nobody trusts twice.
    expect(source).toContain("streamRef.current?.getTracks().forEach((track) => track.stop())");
    expect(source).toContain("contextRef.current.close()");
    expect(source).toContain("cancelAnimationFrame(rafRef.current)");
  });

  test("unmounting tears down too", () => {
    expect(source).toContain("useEffect(() => teardown, [teardown]);");
  });
});

describe("the orb", () => {
  test("no WebGL library was added for a wobbling circle", () => {
    expect(strip(orb)).not.toContain("ogl");
    expect(orb).toContain('getContext("2d")');
    const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("ogl");
  });

  test("it respects a reduced-motion preference", () => {
    expect(orb).toContain("prefers-reduced-motion");
  });

  test("it stops animating when unmounted", () => {
    expect(orb).toContain("cancelAnimationFrame(raf)");
  });
});

describe("where the transcript sits", () => {
  test("it is taken out of the composer's flex row", () => {
    /*
     * Regression, found by rendering it. The composer is a single nowrap flex
     * line, so a child asking for flex: 1 1 100% does not wrap onto a second
     * row — it steals width from the textarea and spills past the rounded
     * border. It is positioned against the box instead.
     */
    expect(source).not.toContain("flex: 1 1 100%; order: 99");
    expect(source).toContain(".composer-box { position: relative; }");
    expect(source).toContain('position: absolute;');
  });

  test("it hangs above the composer, not below it", () => {
    // The composer sits on the bottom edge of the viewport; anything below it
    // is drawn off-screen.
    const block = source.slice(source.indexOf(".vi-interim, .vi-error {"), source.indexOf(".vi-error { color"));
    expect(block).toContain("bottom: calc(100% + 7px)");
    expect(block).not.toContain("top: calc(100% + 7px)");
  });
});

describe("stopping is always possible", () => {
  test("the button is not disabled while the microphone is open", () => {
    /*
     * Regression. The host passes disabled={busy}, true for as long as the
     * model is answering — ten seconds and more. Dictate, press Send, and the
     * button went dead with the microphone still running: no way to stop it,
     * and the browser's recording indicator lit the whole time.
     */
    expect(source).toContain("disabled={disabled && !listening}");
    expect(source).not.toContain("disabled={disabled}\n");
  });
});
