import { useEffect, useRef } from "react";

/**
 * The login headline.
 *
 * Big, still, centred, and it bends under the cursor: each letter lifts toward
 * the reader as the pointer passes, with the lift falling away over a radius,
 * so the line reads as a sheet of glass being pressed from behind.
 *
 * The bend comes from a supplied three.js component. That one renders the text
 * to a 1024px canvas, maps it onto a 150x150 plane and runs a vertex shader
 * that pushes vertices along z near the cursor, with a second blurred mesh
 * behind it for the shadow. What makes the effect is the falloff curve, and a
 * curve does not need WebGL: the letters are already separate elements, so the
 * same easing applied to translateZ on twelve spans is the same picture,
 * without three, a canvas, a render loop that never stops, or text rasterised
 * at a fixed size and resampled.
 *
 * It also keeps the real font. The supplied version draws with
 * `bold 160px system-ui` into a canvas, so the headline would have stopped
 * being set in the Sprint's serif.
 *
 * This replaces an orbiting ring that carried the same words. Tai asked for it
 * to stop flying and hold still, which also retired the seats, the phase-
 * locked fades and the backface culling that went with it.
 */

const PHRASE = "SPRINT BUDDY";

/** How far from a letter's centre the bend still reaches, in px. */
const REACH = 260;
/** Peak lift toward the reader, in px of translateZ. */
const LIFT = 96;

/** The supplied shader's easing, so the bulge has the same shoulders. */
function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export default function Headline() {
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = wrap.current;
    if (!root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const line = root.querySelector<HTMLElement>(".headline-line");
    const letters = [...root.querySelectorAll<HTMLElement>(".headline-letter")];
    if (!line) return;

    /*
     * Positions are read from offsetLeft/offsetWidth against the line's own
     * box, not from getBoundingClientRect on the letters.
     *
     * Two reasons, and the first one is a bug this already had. A bent letter's
     * client rect is its *bent* box, so measuring live through it feeds the
     * effect its own output. Caching instead was the first fix, and it traded
     * that for a worse one: the cache was taken before the serif had settled,
     * so every centre was short and the bulge landed seven letters right of
     * the cursor.
     *
     * offset* are layout values. Transforms do not touch them, there is
     * nothing to invalidate on a font load or a resize, and they are always
     * current. The line itself is never transformed, only its children, so its
     * client rect is a stable origin.
     */
    const centre = (letter: HTMLElement, box: DOMRect) => ({
      x: box.left + letter.offsetLeft + letter.offsetWidth / 2,
      y: box.top + letter.offsetTop + letter.offsetHeight / 2,
    });

    let queued = 0;
    let pointer = { x: -9999, y: -9999 };

    const paint = () => {
      queued = 0;
      const box = line.getBoundingClientRect();
      for (const letter of letters) {
        const c = centre(letter, box);
        const d = Math.hypot(pointer.x - c.x, pointer.y - c.y);
        if (d >= REACH) {
          if (letter.style.transform) letter.style.transform = "";
          continue;
        }
        const lift = easeInOutCubic(1 - d / REACH);
        letter.style.transform = `translateZ(${(lift * LIFT).toFixed(2)}px)`;
      }
    };

    const onMove = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
      if (!queued) queued = requestAnimationFrame(paint);
    };

    const onLeave = () => {
      pointer = { x: -9999, y: -9999 };
      if (!queued) queued = requestAnimationFrame(paint);
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);

    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      if (queued) cancelAnimationFrame(queued);
    };
  }, []);

  return (
    /* aria-hidden: the real heading is an .sr-only <h1> beside the form. Split
       into twelve spans this would otherwise be announced letter by letter. */
    <div className="headline" aria-hidden="true" ref={wrap}>
      <div className="headline-line">
        {[...PHRASE].map((ch, i) => (
          <span key={i} className="headline-letter">
            {ch === " " ? " " : ch}
          </span>
        ))}
      </div>
    </div>
  );
}
