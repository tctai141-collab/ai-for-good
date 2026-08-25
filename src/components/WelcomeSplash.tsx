import { useEffect, useRef } from "react";
import Typewriter from "./Typewriter";
import { runAsciiRain } from "../lib/asciiRain";

/**
 * The screen between a successful sign-in and the app.
 *
 * Code rain behind, the welcome typed over it, held for three seconds.
 *
 * The rain needs something to sample, and the spec's source photo does not
 * exist in this project. Rather than ship a stock image nobody chose, the
 * source is painted: the words themselves, large, plus a soft centre glow. The
 * grid then samples that, so the falling characters are dense where the
 * wordmark is and sparse around it, and the message is legible in the rain
 * before the typing has even started.
 *
 * The greeting uses the name on the account. Every account has one: it is set
 * when the organizer adds the person, and the session returns it alongside the
 * email and the role.
 */

/*
 * Two lines, and the break is written rather than left to the box.
 *
 * As one string it wrapped wherever the width happened to fall, which orphaned
 * "It" at the end of the first line and dropped "begins here!" on its own.
 * With a name in it the break moves about as the name changes length, so there
 * is no width that fixes it. The newline is rendered by white-space: pre-line.
 */
const SECOND_LINE = "It begins here!";

function greeting(name: string): string {
  const clean = name.trim();
  /* No name on the account is not worth a blank line: the cohort's own word
     stands in, which is what this said before it was personal. */
  return clean.length > 0 ? `Welcome, ${clean}.` : "Welcome Sprinters.";
}

/** How long the splash is held. A floor, not a cut: see `onDone` below. */
export const SPLASH_MS = 3000;

/**
 * Paints what the rain samples. Not a photograph: the word itself, so the
 * denser characters trace the letters.
 */
function paintSource(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  /* A faint centre lift, not a wash. At 0.55 this raised the floor across the
     whole frame and the wordmark below had nothing left to stand out against:
     the rain came out an even field of green. */
  const glow = ctx.createRadialGradient(
    width / 2,
    height / 2,
    0,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.5,
  );
  glow.addColorStop(0, "rgba(255,255,255,0.18)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  const size = Math.min(width * 0.16, height * 0.26);
  /* Inter, like everything else. Drawn to a canvas, so it names the family
     directly rather than reading a CSS token. */
  ctx.font = `800 ${size}px Inter, ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText("SPRINT", width / 2, height / 2 - size * 0.55);
  ctx.fillText("BUDDY", width / 2, height / 2 + size * 0.55);
  ctx.restore();
}

export default function WelcomeSplash({ name, onDone }: { name: string; onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
    };
    resize();

    /* The supplied preset, with cellSize scaled for device pixels so the grid
       is the same size on screen at any ratio rather than half as coarse on a
       retina display. */
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const stop = runAsciiRain(canvas, paintSource, {
      cellSize: 14 * dpr,
      bgColor: "#05070a",
    });

    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      stop();
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(onDone, SPLASH_MS);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="splash" role="status" aria-live="polite">
      <canvas ref={canvasRef} className="splash-canvas" aria-hidden="true" />
      <p className="splash-line">
        {/* The message is in the DOM as text for a screen reader; the rain
            behind it is decoration and is hidden. */}
        <Typewriter text={`${greeting(name)}\n${SECOND_LINE}`} speed={48} startDelay={220} />
      </p>
    </div>
  );
}
