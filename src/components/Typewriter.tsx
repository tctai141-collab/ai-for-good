import { useEffect, useState } from "react";

/**
 * Text typed out a character at a time.
 *
 * Rebuilt from a supplied component rather than copied, because that one has
 * four faults that matter here:
 *
 *   Its delete-delay timer is a bare setTimeout inside another timeout, and
 *   nothing clears it. Unmount during the pause and it sets state on a dead
 *   component. This splash unmounts on a timer, so that path is the normal
 *   one, not an edge case.
 *
 *   Once typing finishes with loop off, its interval keeps firing every
 *   `speed` ms forever, doing nothing.
 *
 *   It indexes with `text[i]`, which walks UTF-16 code units, so any character
 *   outside the basic plane is emitted as two broken halves.
 *
 *   Its cursor blinks with Tailwind's `animate-pulse`. There is no Tailwind
 *   here, so the cursor would simply not blink.
 *
 * It also had no reduced-motion path. Typing is motion; for anyone who has
 * asked for less of it the line is simply present, which is the whole point of
 * the message anyway.
 */

type Props = {
  text: string;
  /** Milliseconds per character. */
  speed?: number;
  /** Delay before the first character, in ms. */
  startDelay?: number;
  cursor?: string;
  className?: string;
  onDone?: () => void;
};

export default function Typewriter({
  text,
  speed = 55,
  startDelay = 0,
  cursor = "▌",
  className,
  onDone,
}: Props) {
  /* Split into code points, not code units, so a character outside the basic
     plane is one step rather than two broken halves. */
  const chars = [...text];
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(chars.length);
      onDone?.();
      return;
    }

    setShown(0);
    let cancelled = false;
    const timers: number[] = [];

    const step = (i: number) => {
      if (cancelled) return;
      if (i > chars.length) {
        onDone?.();
        return;
      }
      setShown(i);
      // One timer per character, all tracked, so unmount cancels every one of
      // them rather than leaving the last in flight.
      timers.push(window.setTimeout(() => step(i + 1), i === 0 ? startDelay : speed));
    };
    step(0);

    return () => {
      cancelled = true;
      for (const t of timers) window.clearTimeout(t);
    };
    // `text` is the real input; chars is derived from it each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, speed, startDelay]);

  const done = shown >= chars.length;

  return (
    <span className={className}>
      {chars.slice(0, shown).join("")}
      <span className={`typewriter-cursor${done ? " typewriter-cursor--done" : ""}`} aria-hidden="true">
        {cursor}
      </span>
    </span>
  );
}
