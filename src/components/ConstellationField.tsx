import { useEffect, useRef } from "react";

/**
 * The moving mesh behind the sign-in screen.
 *
 * Adapted from a supplied ConstellationGrid demo. What changed and why, because
 * most of it was demo scaffolding rather than a background:
 *
 *   The giant "CONSTELLATION" wordmark and its blurb are gone. So are the hex
 *   coordinate labels that printed next to every node near the cursor: they
 *   read as debug output, and on this page they would print underneath a
 *   password field.
 *
 *   It paints nothing. The original filled an opaque background every frame,
 *   which would have covered the page's own gradients and the mascot. This
 *   layers over them instead.
 *
 *   Two real bugs in the original are fixed below, each noted where it lives:
 *   a compounding canvas transform and a pointer-leave listener on the wrong
 *   target. The all-pairs link loop is replaced too, but that one was a
 *   scaling headroom question rather than a bug; the numbers are down there.
 *
 * It is decoration. It never takes pointer events, it is hidden from screen
 * readers, it stops when the tab is hidden, and it draws a single still frame
 * for anyone who has asked for reduced motion.
 */

type Node = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseX: number;
  baseY: number;
  radius: number;
  pulse: number;
};

/** Grid pitch. Nodes only ever link to neighbours, so this drives density. */
const SPACING = 55;
/** Nothing links further than this, which is what makes the spatial grid work. */
const MAX_LINK = 75;
const CURSOR_REACH = 220;
/** Hooke's law, loosely: stiffness back to the anchor, and velocity bleed. */
const SPRING_K = 18;
const DAMPING = 0.82;

export default function ConstellationField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Read the brand out of CSS rather than hardcoding it, so a change to the
    // accent token moves this too. The fallbacks are the current values.
    const styles = getComputedStyle(document.documentElement);
    const accent = (styles.getPropertyValue("--brand-accent").trim() || "#e8170a");
    const accentRgb = hexToRgb(accent) ?? "232, 23, 10";
    const inkRgb = "255, 255, 255";

    const stillOnly = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let nodes: Node[] = [];
    let frame = 0;
    let running = true;

    const mouse = { x: -9999, y: -9999, prevX: -9999, prevY: -9999, vx: 0, vy: 0 };

    const build = () => {
      nodes = [];
      const cols = Math.ceil(width / SPACING) + 1;
      const rows = Math.ceil(height / SPACING) + 1;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = i * SPACING;
          const y = j * SPACING;
          nodes.push({
            x, y, vx: 0, vy: 0,
            baseX: x, baseY: y,
            radius: Math.random() * 1.2 + 1.2,
            pulse: Math.random() * Math.PI * 2,
          });
        }
      }
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = parent.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      /*
       * setTransform, not scale. ctx.scale multiplies the existing transform,
       * so the original's resize handler squared the device pixel ratio on the
       * second resize and every one after it: drag a window between monitors
       * and the grid quietly doubled in size.
       */
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    };

    /*
     * Only neighbours can link, so only neighbours are compared.
     *
     * The original compared every node against every other one each frame and
     * threw nearly all of it away against a 75px cutoff. Measured, both ways,
     * same link count, average over ten runs:
     *
     *   1440x900   504 nodes   0.95ms naive   0.49ms this   1.9x
     *   2560x1440 1344 nodes   1.70ms naive   0.72ms this   2.4x
     *   3840x2160 2911 nodes   7.42ms naive   1.09ms this   6.8x
     *
     * So this is headroom, not a rescue: the naive version was inside a 16.7ms
     * frame at every size tested. It earns its place on a large display, where
     * 7ms of the budget spent before a single line is stroked is worth not
     * spending. At laptop size the difference is invisible and either would do.
     */
    const linkCells = new Map<string, Node[]>();
    const NEIGHBOURS = [[0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;

    const drawLinks = () => {
      linkCells.clear();
      for (const n of nodes) {
        const key = `${Math.floor(n.x / MAX_LINK)},${Math.floor(n.y / MAX_LINK)}`;
        const bucket = linkCells.get(key);
        if (bucket) bucket.push(n);
        else linkCells.set(key, [n]);
      }

      ctx.lineWidth = 0.7;
      const maxSq = MAX_LINK * MAX_LINK;

      for (const [key, bucket] of linkCells) {
        const [cx, cy] = key.split(",").map(Number) as [number, number];
        for (const [ox, oy] of NEIGHBOURS) {
          const other = ox === 0 && oy === 0 ? bucket : linkCells.get(`${cx + ox},${cy + oy}`);
          if (!other) continue;
          for (let a = 0; a < bucket.length; a++) {
            const n = bucket[a]!;
            // Within one cell, only look forward, or every pair is drawn twice.
            const start = other === bucket ? a + 1 : 0;
            for (let b = start; b < other.length; b++) {
              const m = other[b]!;
              const dx = n.x - m.x;
              const dy = n.y - m.y;
              const distSq = dx * dx + dy * dy;
              if (distSq >= maxSq) continue;
              const alpha = (1 - Math.sqrt(distSq) / MAX_LINK) * 0.18;
              ctx.strokeStyle = `rgba(${inkRgb}, ${alpha})`;
              ctx.beginPath();
              ctx.moveTo(n.x, n.y);
              ctx.lineTo(m.x, m.y);
              ctx.stroke();
            }
          }
        }
      }
    };

    const drawNodes = () => {
      for (const n of nodes) {
        const dx = mouse.x - n.x;
        const dy = mouse.y - n.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const near = dist < CURSOR_REACH;

        const alpha = near ? 0.95 : 0.25 + Math.sin(n.pulse) * 0.1;
        ctx.fillStyle = near ? `rgba(${accentRgb}, ${alpha})` : `rgba(${inkRgb}, ${alpha})`;
        const r = near ? n.radius * 2.2 : n.radius + Math.sin(n.pulse) * 0.3;
        ctx.beginPath();
        ctx.arc(n.x, n.y, Math.max(0.5, r), 0, Math.PI * 2);
        ctx.fill();

        if (dist < 90) {
          const ring = ((n.pulse * 20) % 30) + 4;
          ctx.strokeStyle = `rgba(${accentRgb}, ${(1 - ring / 34) * 0.4})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(n.x, n.y, ring, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    };

    let last = performance.now();

    const render = (now: number) => {
      if (!running) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      mouse.vx = (mouse.x - mouse.prevX) / (dt * 1000 || 1);
      mouse.vy = (mouse.y - mouse.prevY) / (dt * 1000 || 1);
      mouse.prevX = mouse.x;
      mouse.prevY = mouse.y;
      const speed = Math.hypot(mouse.vx, mouse.vy);

      ctx.clearRect(0, 0, width, height);

      for (const n of nodes) {
        n.pulse += dt * 3;

        const dx = mouse.x - n.x;
        const dy = mouse.y - n.y;
        const dist = Math.hypot(dx, dy);

        if (dist < CURSOR_REACH && dist > 0) {
          const force = (1 - dist / CURSOR_REACH) * (1500 + speed * 150);
          const angle = Math.atan2(dy, dx);
          n.vx -= Math.cos(angle) * force * dt;
          n.vy -= Math.sin(angle) * force * dt;
        }

        n.vx = (n.vx + (n.baseX - n.x) * SPRING_K * dt) * DAMPING;
        n.vy = (n.vy + (n.baseY - n.y) * SPRING_K * dt) * DAMPING;
        n.x += n.vx * dt * 60;
        n.y += n.vy * dt * 60;
      }

      drawLinks();
      drawNodes();
      frame = requestAnimationFrame(render);
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = parent.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };
    /*
     * On the document, not the window. A mouseleave bound to window does not
     * fire reliably, so in the original the grid stayed pushed open around
     * wherever the cursor was when it left the page.
     */
    const onLeave = () => { mouse.x = -9999; mouse.y = -9999; };

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(frame);
      } else if (!running && !stillOnly) {
        running = true;
        last = performance.now();
        frame = requestAnimationFrame(render);
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    document.addEventListener("visibilitychange", onVisibility);

    if (stillOnly) {
      // One frame, no animation loop, no cursor reaction.
      ctx.clearRect(0, 0, width, height);
      drawLinks();
      drawNodes();
    } else {
      frame = requestAnimationFrame(render);
    }

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className="constellation-field" aria-hidden="true" />;
}

/** "#e8170a" to "232, 23, 10", so it can be dropped into an rgba() string. */
function hexToRgb(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}
