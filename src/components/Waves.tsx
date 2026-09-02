import { useEffect, useRef } from "react";
import {
  AMP_X,
  AMP_Y,
  COLUMN_GAP,
  INFLUENCE,
  MAX_PUSH,
  OVERSCAN_X,
  OVERSCAN_Y,
  POINT_GAP,
  columns,
  clamp,
  falloff,
  lerp,
  makeNoise2D,
  rows,
  waveAngle,
} from "../lib/waves";

/**
 * The field behind the sign-in screen. Vertical lines through a noise field,
 * which the pointer pushes aside and which settles back.
 *
 * Adapted from a supplied Waves component, and it keeps that component's
 * design while breaking with almost all of its implementation. What changed,
 * and why each one mattered here:
 *
 *   It draws to a canvas, not to SVG. The original appends one <path> per
 *   line and rewrites every `d` attribute each frame: at the spacing it asks
 *   for that is about two hundred paths carrying twenty-four thousand line
 *   segments, re-serialised into strings sixty times a second. The geometry is
 *   affordable; serialising it is not, and this is the first screen anyone
 *   opens. Canvas draws the same pixels with no strings and no DOM.
 *
 *   It paints no background. The original fills its own opaque colour, which
 *   here would cover the page's gradients and the halo behind the mascot.
 *
 *   The lines are the product's indigo, not white, and they fade out top and
 *   bottom. A flat white field behind the email and password fields fights the
 *   form for attention and hurts its contrast; this sits underneath it.
 *
 *   It takes no touch events. The original binds touchmove and calls
 *   preventDefault on a container that covers the screen, which on a phone
 *   swallows gestures meant for the page behind it. There is no cursor on a
 *   phone to follow anyway.
 *
 *   It stops when nothing is watching, and shows one still frame to anyone who
 *   has asked for reduced motion. Both rules are inherited from the grid this
 *   replaces, which had them right.
 *
 * It is decoration: no pointer events, hidden from screen readers.
 */

/* The ground the lines are drawn over is --surface-bg; these are picked to sit
   on it. Written as components rather than as a colour string because the draw
   loop builds rgba() per stroke and would otherwise be parsing hex. */
const LINE = { r: 94, g: 106, b: 210 }; // --brand-accent
const GLOW = { r: 143, g: 151, b: 228 }; // the light face of the cube

/* How visible the field is at rest, and where the pointer has been. Low: it is
   the last thing on the page that should be read, not the first. */
const BASE_ALPHA = 0.24;
const LIT_ALPHA = 0.5;

/* Fraction of the height over which the field fades in at the top and out at
   the bottom, so the lines are never seen to start or stop. */
const FADE = 0.22;

export default function Waves() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const noise = makeNoise2D(7);

    let width = 0;
    let height = 0;
    let cols = 0;
    let pointRows = 0;
    let frame = 0;

    /* Point state, in flat arrays allocated once per resize. The offsets the
       pointer has pushed each point to, and the velocity carrying it back.
       Objects here would be tens of thousands of allocations per frame. */
    let offsetX = new Float32Array(0);
    let offsetY = new Float32Array(0);
    let velX = new Float32Array(0);
    let velY = new Float32Array(0);

    /* Where the pointer is, where the drawing believes it is, and how fast it
       is travelling. Eased so the field follows rather than snaps. */
    const ptr = { x: -9999, y: -9999, sx: -9999, sy: -9999, lx: 0, ly: 0, speed: 0, angle: 0 };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      /* setTransform, not scale: scale multiplies whatever is already on the
         context, so a second resize would double the ratio. */
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      cols = columns(width);
      pointRows = rows(height);
      const total = cols * pointRows;
      offsetX = new Float32Array(total);
      offsetY = new Float32Array(total);
      velX = new Float32Array(total);
      velY = new Float32Array(total);
    };

    /* Rebuilt on resize only. A gradient is what gives the field a top and a
       bottom instead of a hard crop, and building one per frame would be the
       one allocation big enough to notice. */
    let gradient: CanvasGradient | null = null;
    const buildGradient = (alpha: number) => {
      const g = ctx.createLinearGradient(0, 0, 0, height);
      const { r, b: bl, g: gr } = LINE;
      g.addColorStop(0, `rgba(${r},${gr},${bl},0)`);
      g.addColorStop(FADE, `rgba(${r},${gr},${bl},${alpha})`);
      g.addColorStop(1 - FADE * 0.6, `rgba(${r},${gr},${bl},${alpha})`);
      g.addColorStop(1, `rgba(${r},${gr},${bl},0)`);
      return g;
    };

    const draw = (now: number) => {
      ctx.clearRect(0, 0, width, height);

      const startX = -OVERSCAN_X / 2;
      const startY = -OVERSCAN_Y / 2;

      if (!gradient) gradient = buildGradient(BASE_ALPHA);

      /* One path for the whole field, stroked once. Per-line strokes would be
         two hundred state changes a frame for a difference nobody can see. */
      ctx.beginPath();

      for (let c = 0; c < cols; c++) {
        const baseX = startX + c * COLUMN_GAP;
        for (let r = 0; r < pointRows; r++) {
          const baseY = startY + r * POINT_GAP;
          const i = c * pointRows + r;

          const angle = waveAngle(noise, baseX, baseY, now);
          const wx = Math.cos(angle) * AMP_X;
          const wy = Math.sin(angle) * AMP_Y;

          if (!still) {
            const dx = baseX - ptr.sx;
            const dy = baseY - ptr.sy;
            const d = Math.hypot(dx, dy);
            if (d < INFLUENCE) {
              const f = falloff(d) * ptr.speed * 0.012;
              velX[i] = velX[i]! + Math.cos(ptr.angle) * f;
              velY[i] = velY[i]! + Math.sin(ptr.angle) * f;
            }
            /* Pulled back toward rest, and damped, so the surface settles
               instead of ringing. */
            velX[i] = (velX[i]! + -offsetX[i]! * 0.014) * 0.94;
            velY[i] = (velY[i]! + -offsetY[i]! * 0.014) * 0.94;
            offsetX[i] = clamp(offsetX[i]! + velX[i]!, -MAX_PUSH, MAX_PUSH);
            offsetY[i] = clamp(offsetY[i]! + velY[i]!, -MAX_PUSH, MAX_PUSH);
          }

          const x = baseX + wx + offsetX[i]!;
          const y = baseY + wy + offsetY[i]!;
          if (r === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }

      ctx.strokeStyle = gradient;
      ctx.lineWidth = 1;
      ctx.stroke();

      /* The light the pointer carries. A soft radial wash rather than the
         original's hard dot, which read as a cursor rather than as a sheen. */
      if (!still && ptr.sx > -9000) {
        const glow = ctx.createRadialGradient(ptr.sx, ptr.sy, 0, ptr.sx, ptr.sy, INFLUENCE);
        const lit = LIT_ALPHA * Math.min(1, 0.35 + ptr.speed / 40);
        glow.addColorStop(0, `rgba(${GLOW.r},${GLOW.g},${GLOW.b},${(lit * 0.22).toFixed(3)})`);
        glow.addColorStop(1, `rgba(${GLOW.r},${GLOW.g},${GLOW.b},0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(ptr.sx - INFLUENCE, ptr.sy - INFLUENCE, INFLUENCE * 2, INFLUENCE * 2);
      }
    };

    const tick = (now: number) => {
      ptr.sx = lerp(ptr.sx, ptr.x, 0.1);
      ptr.sy = lerp(ptr.sy, ptr.y, 0.1);

      const dx = ptr.x - ptr.lx;
      const dy = ptr.y - ptr.ly;
      ptr.speed = Math.min(100, lerp(ptr.speed, Math.hypot(dx, dy), 0.1));
      if (dx || dy) ptr.angle = Math.atan2(dy, dx);
      ptr.lx = ptr.x;
      ptr.ly = ptr.y;

      draw(now);
      frame = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      /* Ignore touch: there is no hover on a phone, and following a finger
         means the field lurches to wherever the screen was last tapped. */
      if (e.pointerType === "touch") return;
      if (ptr.sx < -9000) {
        ptr.sx = e.clientX;
        ptr.sy = e.clientY;
      }
      ptr.x = e.clientX;
      ptr.y = e.clientY;
    };
    const onLeave = () => {
      ptr.x = -9999;
      ptr.y = -9999;
    };
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else if (!frame) {
        frame = requestAnimationFrame(tick);
      }
    };

    const onResize = () => {
      resize();
      gradient = null;
    };

    resize();
    window.addEventListener("resize", onResize);

    if (still) {
      draw(performance.now());
      return () => window.removeEventListener("resize", onResize);
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    frame = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={canvasRef} className="waves-field" aria-hidden="true" />;
}
