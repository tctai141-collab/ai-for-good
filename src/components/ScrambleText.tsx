import { useEffect, useState } from "react";

/**
 * Text that arrives as noise and resolves into itself.
 *
 * Two phases, from a supplied component: the line fills left to right with
 * random characters, then resolves left to right into the real thing with a
 * cursor at the boundary.
 *
 * Rebuilt rather than copied. What changed:
 *
 *   It rebuilds its setInterval on every animation step, because the effect
 *   that owns the interval lists the step counter in its dependencies. For a
 *   twenty-character line that is eighty intervals created and cleared per
 *   pass. One chained timeout, with the step held in the closure, does the
 *   same job and needs no state to drive it.
 *
 *   It types the handle as NodeJS.Timeout in a browser component.
 *
 *   It pads with real spaces before the animation starts, and HTML collapses
 *   those, so the line has no width until the first tick and everything below
 *   it jumps. Non-breaking spaces hold the box.
 *
 *   It indexes the target with text[i], which walks UTF-16 code units, so any
 *   character outside the basic plane resolves as two broken halves.
 *
 *   Its `useInView` needs motion/react. This sits above the sign-in fields and
 *   is on screen the moment the page is, so the dependency buys nothing.
 *
 * It also had no reduced-motion path. A line that shakes itself out of static
 * is exactly what that setting is for; there, the names simply change.
 */

/** The alphabet the noise is drawn from. */
const NOISE = "_!X$0-+*#";

/** Milliseconds per step. Two steps per character in each phase. */
const STEP_MS = 22;
/** How long a resolved name is held before the next one starts. */
const HOLD_MS = 1900;

function noiseChar(previous?: string): string {
  // Never the same character twice in a row: a repeated glyph reads as a
  // stalled animation rather than as noise.
  let char = NOISE[Math.floor(Math.random() * NOISE.length)]!;
  if (char === previous) {
    char = NOISE[(NOISE.indexOf(char) + 1) % NOISE.length]!;
  }
  return char;
}

type Props = {
  /** Cycled in order, each one scrambling in. */
  texts: string[];
  className?: string;
};

export default function ScrambleText({ texts, className }: Props) {
  const [shown, setShown] = useState(texts[0] ?? "");
  /* The longest name reserves the width, so resolving a short one does not
     let the box collapse and drag the fields up. */
  const widest = texts.reduce((a, b) => ([...a].length >= [...b].length ? a : b), "");

  useEffect(() => {
    if (texts.length === 0) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(texts[0]!);
      return;
    }

    let index = 0;
    let step = 0;
    let phase: "noise" | "resolve" | "hold" = "noise";
    let timer = 0;

    /* Code points, not code units, so a character outside the basic plane is
       one cell rather than two broken halves. */
    let target = [...texts[0]!];

    const tick = () => {
      const len = target.length;

      if (phase === "noise") {
        const filled = Math.min(step + 1, len);
        const out: string[] = [];
        for (let i = 0; i < filled; i++) out.push(noiseChar(out[i - 1]));
        /* Non-breaking, and written as an escape rather than as the literal
           character: HTML collapses a real space, so the unfilled tail would
           have no width and everything below the line would jump. A literal
           U+00A0 in source is invisible and gets "tidied" back to a space. */
        for (let i = filled; i < len; i++) out.push("\u00A0");
        setShown(out.join(""));

        step++;
        if (step >= len * 2) {
          phase = "resolve";
          step = 0;
        }
        timer = window.setTimeout(tick, STEP_MS);
        return;
      }

      if (phase === "resolve") {
        const solved = Math.floor(step / 2);
        const out: string[] = [];
        for (let i = 0; i < solved && i < len; i++) out.push(target[i]!);
        if (solved < len) out.push(step % 2 === 0 ? "_" : noiseChar());
        for (let i = out.length; i < len; i++) out.push(noiseChar(out[i - 1]));
        setShown(out.join(""));

        step++;
        if (step >= len * 2) {
          setShown(target.join(""));
          phase = "hold";
          step = 0;
          timer = window.setTimeout(tick, HOLD_MS);
          return;
        }
        timer = window.setTimeout(tick, STEP_MS);
        return;
      }

      // hold finished: move to the next name and scramble it in.
      index = (index + 1) % texts.length;
      target = [...texts[index]!];
      phase = "noise";
      step = 0;
      timer = window.setTimeout(tick, STEP_MS);
    };

    /* One chained timeout rather than an interval rebuilt every step, which is
       what the supplied version does: eighty creations per pass on a
       twenty-character line. */
    timer = window.setTimeout(tick, STEP_MS);
    return () => window.clearTimeout(timer);
  }, [texts]);

  return (
    /* aria-hidden: the characters change several times a second, so a screen
       reader following them would get a stream of noise. The readable copy is
       the .sr-only heading beside the form. */
    <span className={`scramble${className ? ` ${className}` : ""}`} aria-hidden="true">
      {/* Reserves the line's width from the longest name, and never paints. */}
      <span className="scramble-gauge">{widest}</span>
      <span className="scramble-live">{shown}</span>
    </span>
  );
}
