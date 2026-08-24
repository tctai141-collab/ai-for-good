import { useEffect, useRef } from "react";

/**
 * Text that melts from one line into the next.
 *
 * Two copies of the line sit on top of each other; one blurs out as the other
 * blurs in, and an SVG threshold filter over both snaps the blurred alpha back
 * to something near binary. That is what turns two fading blurs into one
 * liquid shape pulling apart and reforming, and it is the whole trick.
 *
 * Rebuilt from a supplied component rather than copied. What changed:
 *
 *   It opens with `//@ts-nocheck`. This file is typed.
 *
 *   At fraction 0 it computes `8 / 0 - 8`, which is Infinity, and writes
 *   `blur(Infinitypx)`. That is not a valid filter, so the browser drops the
 *   whole declaration and the outgoing line snaps rather than melting. The
 *   fractions are clamped away from the ends here.
 *
 *   It builds a `new Date()` on every frame to work out the delta.
 *   requestAnimationFrame is handed a timestamp; that is what it is for.
 *
 *   Its filter id is `threshold`, unqualified, in a document this app also
 *   renders other SVG filters into. Ids are global, so it is namespaced.
 *
 *   It never stops. The loop parks when the tab is hidden, and reduced motion
 *   gets one line held still instead of a face melting on a login screen.
 */

/** Seconds spent melting from one line to the next. */
const MORPH = 1.5;
/** Seconds the finished line is held before the next morph starts. */
const HOLD = 1.2;

/**
 * Peak blur, in em.
 *
 * The supplied component blurs by a fixed `8 / fraction - 8` pixels, which is
 * tuned for the ~96px display type its demo uses. At the size this sits at
 * above the sign-in fields that is proportionally three times too strong, and
 * the threshold filter turns both lines into unreadable blobs. In em it scales
 * with whatever size the wordmark is set at: 0.083em is the same 8px the
 * original used, at the size the original used it.
 */
const BLUR_EM = 0.083;
/** Where the blur is clamped, so a near-zero fraction cannot explode it. */
const BLUR_MAX_EM = 1.2;

type Props = {
  texts: string[];
  className?: string;
};

export default function MorphingText({ texts, className }: Props) {
  const aRef = useRef<HTMLSpanElement>(null);
  const bRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b || texts.length === 0) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still || texts.length === 1) {
      /* One line, held. The morph is the effect, not the message, and a
         login screen is not the place to insist on it. */
      a.textContent = texts[0]!;
      a.style.opacity = "100%";
      a.style.filter = "none";
      b.textContent = "";
      b.style.opacity = "0%";
      return;
    }

    let index = 0;
    let elapsed = 0;
    let last = 0;
    let frame = 0;

    const paint = (fraction: number) => {
      /* Clamped off both ends. At exactly 0 the supplied version divides by
         zero, writes blur(Infinitypx), and the browser throws the whole
         declaration away, so the outgoing line snaps instead of melting. */
      const f = Math.min(Math.max(fraction, 0.001), 0.999);
      const inv = 1 - f;

      a.textContent = texts[index % texts.length]!;
      b.textContent = texts[(index + 1) % texts.length]!;

      const blur = (x: number) =>
        `blur(${Math.min(BLUR_EM * (1 / x - 1), BLUR_MAX_EM).toFixed(4)}em)`;

      a.style.filter = blur(inv);
      a.style.opacity = `${(Math.pow(inv, 0.4) * 100).toFixed(1)}%`;
      b.style.filter = blur(f);
      b.style.opacity = `${(Math.pow(f, 0.4) * 100).toFixed(1)}%`;
    };

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (last === 0) last = now;
      const dt = (now - last) / 1000;
      last = now;

      elapsed += dt;
      if (elapsed <= MORPH) {
        paint(elapsed / MORPH);
        return;
      }
      // Held between morphs: the incoming line sharp, the outgoing one gone.
      paint(1);
      if (elapsed >= MORPH + HOLD) {
        index++;
        elapsed = 0;
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else if (!frame) {
        // Reset the clock, or a tab left in the background for a minute
        // returns and jumps several lines at once.
        last = 0;
        frame = requestAnimationFrame(tick);
      }
    };

    paint(0.001);
    document.addEventListener("visibilitychange", onVisibility);
    frame = requestAnimationFrame(tick);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [texts]);

  return (
    <div className={`morph${className ? ` ${className}` : ""}`}>
      {/* The lines are swapped by textContent every frame, so a screen reader
          would get a stream of half-finished words. The readable copy is the
          .sr-only heading beside the form. */}
      <span className="morph-line" ref={aRef} aria-hidden="true" />
      <span className="morph-line" ref={bRef} aria-hidden="true" />
      <svg className="morph-filter" aria-hidden="true" focusable="false">
        <defs>
          {/* Alpha only: the last row multiplies alpha by 255 and shifts it
              down, so anything faint disappears and anything half-there snaps
              solid. That hard edge across two blurs is the liquid. */}
          <filter id="morph-threshold">
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="1 0 0 0 0
                      0 1 0 0 0
                      0 0 1 0 0
                      0 0 0 255 -140"
            />
          </filter>
        </defs>
      </svg>
    </div>
  );
}
