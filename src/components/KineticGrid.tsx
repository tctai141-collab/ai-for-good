import { useEffect, useRef } from "react";
import {
  CELL,
  EASE,
  displace,
  isDead,
  lerp,
  rippleAt,
  smooth,
  type Point,
  type Ripple,
} from "../lib/kineticGrid";

/**
 * The grid behind the sign-in screen.
 *
 * Adapted from a supplied KineticGrid: a lattice that warps toward the cursor
 * and ripples out from a click. It replaces the constellation field, and keeps
 * that component's rules about what a background is allowed to do, because
 * they were the right rules and the supplied component breaks most of them.
 *
 * What changed, and why:
 *
 *   It paints nothing. The original fills an opaque #000 or #161618 every
 *   frame, which on this page would cover the login screen's own gradients and
 *   the red halo behind the cube. The lattice layers over them instead.
 *
 *   The active colour is white, not #4a9eff. Blue is the one colour this
 *   codebase has deliberately removed, and a blue lattice behind a red mascot
 *   and a red sign-in button would be the only blue left in the product.
 *
 *   It is drawn at device pixel ratio. The original sizes the canvas in CSS
 *   pixels, so on a retina display every line is soft. Same fix and same
 *   reasoning as the constellation field before it: setTransform rather than
 *   scale, since scale multiplies the transform already in place and compounds
 *   on every resize.
 *
 *   It stops when nothing is watching. The original runs its loop forever.
 *   This one parks the frame when the tab is hidden.
 *
 * It is decoration: no pointer events, hidden from screen readers, and a
 * single still frame for anyone who has asked for reduced motion.
 */

const LINE_IDLE = { r: 255, g: 255, b: 255, a: 0.13 };
const LINE_LIVE = { r: 255, g: 255, b: 255, a: 0.9 };
const NODE_IDLE = { r: 255, g: 255, b: 255, a: 0.2 };
const NODE_LIVE = { r: 255, g: 255, b: 255, a: 1 };

type Rgba = { r: number; g: number; b: number; a: number };
const mix = (from: Rgba, to: Rgba, t: number) =>
  `rgba(${Math.round(lerp(from.r, to.r, t))},${Math.round(lerp(from.g, to.g, t))},${Math.round(lerp(from.b, to.b, t))},${lerp(from.a, to.a, t).toFixed(3)})`;

export default function KineticGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let frame = 0;

    /* Where the cursor is, and where the drawing has got to. Separate so the
       lattice eases toward the pointer instead of snapping to it. */
    const target: Point = { x: -9999, y: -9999 };
    const eased: Point = { x: -9999, y: -9999 };
    let ripples: Ripple[] = [];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      /* setTransform, not scale: scale multiplies whatever transform is
         already on the context, so resizing twice would double the ratio. */
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (now: number) => {
      /* No background fill: the page's gradients and the cube's halo are
         underneath and have to stay visible. */
      ctx.clearRect(0, 0, width, height);

      ripples = ripples.filter((r) => !isDead(r, now));

      const cols = Math.max(2, Math.ceil(width / CELL)) + 1;
      const rows = Math.max(2, Math.ceil(height / CELL)) + 1;
      const cellW = width / (cols - 1);
      const cellH = height / (rows - 1);

      const pts: { x: number; y: number; near: number }[][] = [];
      for (let row = 0; row < rows; row++) {
        const line: { x: number; y: number; near: number }[] = [];
        for (let col = 0; col < cols; col++) {
          line.push(displace(col * cellW, row * cellH, col, row, cols, rows, eased, ripples, now));
        }
        pts.push(line);
      }

      ctx.lineCap = "butt";
      const segment = (a: (typeof pts)[0][0], b: (typeof pts)[0][0]) => {
        const t = smooth((a.near + b.near) / 2);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = mix(LINE_IDLE, LINE_LIVE, t);
        ctx.lineWidth = lerp(0.8, 1.5, t);
        ctx.stroke();
      };

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols - 1; col++) segment(pts[row]![col]!, pts[row]![col + 1]!);
      }
      for (let col = 0; col < cols; col++) {
        for (let row = 0; row < rows - 1; row++) segment(pts[row]![col]!, pts[row + 1]![col]!);
      }

      for (const line of pts) {
        for (const p of line) {
          const t = smooth(p.near);
          const r = lerp(1.8, 3.2, t);
          if (t > 0.3) {
            const glow = r + lerp(0, 6, (t - 0.3) / 0.7);
            const grad = ctx.createRadialGradient(p.x, p.y, r * 0.5, p.x, p.y, glow);
            grad.addColorStop(0, `rgba(255,255,255,${(t * 0.3).toFixed(3)})`);
            grad.addColorStop(1, "rgba(255,255,255,0)");
            ctx.beginPath();
            ctx.arc(p.x, p.y, glow, 0, Math.PI * 2);
            ctx.fillStyle = grad;
            ctx.fill();
          }
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fillStyle = mix(NODE_IDLE, NODE_LIVE, t);
          ctx.fill();
        }
      }

      for (const ripple of ripples) {
        const { radius, strength } = rippleAt(ripple, now);
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,${(strength * 0.28).toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    };

    const tick = (now: number) => {
      eased.x = lerp(eased.x, target.x, EASE);
      eased.y = lerp(eased.y, target.y, EASE);
      draw(now);
      frame = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;
    };
    const onLeave = () => {
      target.x = -9999;
      target.y = -9999;
    };
    const onClick = (e: MouseEvent) => {
      ripples.push({ x: e.clientX, y: e.clientY, born: performance.now() });
    };

    /* Nothing to animate for a hidden tab, and the browser throttles the loop
       to a crawl anyway rather than stopping it. */
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else if (!frame) {
        frame = requestAnimationFrame(tick);
      }
    };

    resize();
    window.addEventListener("resize", resize);

    if (still) {
      draw(performance.now());
      return () => window.removeEventListener("resize", resize);
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    window.addEventListener("click", onClick);
    document.addEventListener("visibilitychange", onVisibility);
    frame = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("click", onClick);
      document.removeEventListener("visibilitychange", onVisibility);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={canvasRef} className="kinetic-grid" aria-hidden="true" />;
}
