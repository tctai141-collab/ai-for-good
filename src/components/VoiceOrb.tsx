import { useEffect, useRef } from "react";

/**
 * The thing that moves while the microphone is on.
 *
 * Rebuilt from a supplied component that draws this with ogl — a WebGL library,
 * two GLSL shaders and a simplex-noise implementation, to render a circle that
 * wobbles when you speak. This app ships four runtime dependencies on purpose
 * and a 2D canvas does the job: a ring of points pushed out by the current
 * audio level, which is the entire perceptual content of the original.
 *
 * It is not decoration. A microphone with no visible response is a microphone
 * you cannot tell is broken, muted, or listening to the wrong device — and the
 * one thing somebody needs to know here is whether they are being heard.
 *
 * The level is passed in rather than read here, because the component that owns
 * the microphone already has the analyser and two of them would mean two.
 */
export default function VoiceOrb({
  level,
  size = 52,
  active,
}: {
  /** 0–1, current loudness. */
  level: number;
  size?: number;
  /** False while stopping, so the ring settles rather than freezing mid-wobble. */
  active: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const levelRef = useRef(0);
  const smoothRef = useRef(0);

  levelRef.current = level;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let raf = 0;
    let t = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      t += reduced ? 0 : 0.03;

      /* Eased towards the live level rather than snapping to it. Raw analyser
         output jitters every frame and an orb that flickers reads as a fault. */
      const target = active ? levelRef.current : 0;
      smoothRef.current += (target - smoothRef.current) * 0.18;
      const amp = smoothRef.current;

      const mid = size / 2;
      const base = size * 0.28;
      ctx.clearRect(0, 0, size, size);

      // A soft halo that grows with loudness.
      const halo = ctx.createRadialGradient(mid, mid, base * 0.4, mid, mid, mid);
      halo.addColorStop(0, `rgba(94, 106, 210, ${0.34 + amp * 0.4})`);
      halo.addColorStop(1, "rgba(94, 106, 210, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(mid, mid, mid, 0, Math.PI * 2);
      ctx.fill();

      /* The ring: three summed sines around the circumference. Not noise — at
         this size the difference is invisible and this is four lines. */
      ctx.beginPath();
      const steps = 64;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const wobble =
          Math.sin(a * 3 + t) * 0.6 +
          Math.sin(a * 5 - t * 1.3) * 0.3 +
          Math.sin(a * 2 + t * 0.7) * 0.4;
        const r = base * (1 + amp * 0.55) + wobble * amp * size * 0.13;
        const x = mid + Math.cos(a) * r;
        const y = mid + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(94, 106, 210, ${0.55 + amp * 0.35})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(190, 197, 255, ${0.5 + amp * 0.5})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, active]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ width: size, height: size, display: "block" }}
      aria-hidden="true"
    />
  );
}
