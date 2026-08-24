import { useEffect, useRef, useState } from "react";

type Props = {
  compact?: boolean;
  onTip?: () => void;
  reaction?: "wink" | "look-down" | "look-up" | null;
  size?: string;
};

/** How far the eyes travel from centre, in viewBox units. */
const MAX_GAZE = 9;

/**
 * Sprint Buddy.
 *
 * A rounded body with two eyes that follow the cursor, blink on their own, and
 * react to what is happening in the chat. Adapted from the supplied
 * MeshGradientSVG: the silhouette and the idea are that component's, the rest
 * is rebuilt for this codebase.
 *
 * What was dropped, and why none of it is a loss:
 *
 *   @paper-design/shaders-react drew the body fill with a WebGL shader. It is a
 *   soft blob of moving colour, which is three CSS radial gradients on a slow
 *   drift, so the shader bought nothing here and cost a dependency, a canvas,
 *   and the CSP allowances that sank the 3D robot.
 *
 *   framer-motion drove the float, the blink and the eye springs. All three are
 *   CSS: two keyframe animations and a transition. The eye easing below is the
 *   same overshoot-and-settle a spring gives, written as a cubic-bezier.
 *
 *   The palette was pastel pink and sky blue. This is the Sprint's own: signal
 *   red, brand yellow, and the dark surfaces underneath.
 *
 * The cube it replaces could wink and glance up or down when the conversation
 * called for it, and that prop is still honoured here. A face is better at it
 * than a box was.
 */
export default function SprintBuddyMascot({ compact, onTip, reaction, size }: Props) {
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let queued = 0;
    let pending = { x: 0, y: 0 };

    const apply = () => {
      queued = 0;
      setGaze(pending);
    };

    const onMove = (e: PointerEvent) => {
      const box = wrap.current?.getBoundingClientRect();
      if (!box || !box.width) return;
      const dx = e.clientX - (box.left + box.width / 2);
      const dy = e.clientY - (box.top + box.height / 2);
      // Distance is damped so the eyes drift rather than snap to the corner the
      // moment the cursor leaves the mascot.
      const reach = Math.max(box.width, 320);
      pending = {
        x: Math.max(-MAX_GAZE, Math.min(MAX_GAZE, (dx / reach) * MAX_GAZE * 2)),
        y: Math.max(-MAX_GAZE, Math.min(MAX_GAZE, (dy / reach) * MAX_GAZE * 2)),
      };
      // One state update per frame at most, not one per pointer event.
      if (!queued) queued = requestAnimationFrame(apply);
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      if (queued) cancelAnimationFrame(queued);
    };
  }, []);

  // A reaction overrides where the cursor is, briefly and deliberately.
  const look =
    reaction === "look-down" ? { x: gaze.x, y: MAX_GAZE }
    : reaction === "look-up" ? { x: gaze.x, y: -MAX_GAZE }
    : gaze;

  return (
    <div
      ref={wrap}
      className={`buddy${compact ? " buddy--compact" : ""}${reaction ? ` buddy--${reaction}` : ""}`}
      style={{ width: size ?? "100%", height: size ?? "100%" }}
      onClick={onTip}
    >
      <svg viewBox="0 0 231 289" className="buddy-svg" role="img" aria-label="Sprint Buddy">
        <defs>
          <clipPath id="buddy-body">
            {/* The silhouette from the supplied component: a domed head over a
                base that dips three times, like something sitting down. */}
            <path d="M230.809 115.385V249.411C230.809 269.923 214.985 287.282 194.495 288.411C184.544 288.949 175.364 285.718 168.26 280C159.746 273.154 147.769 273.461 139.178 280.23C132.638 285.384 124.381 288.462 115.379 288.462C106.377 288.462 98.1451 285.384 91.6055 280.23C82.912 273.385 70.9353 273.385 62.2415 280.23C55.7532 285.334 47.598 288.411 38.7246 288.462C17.4132 288.615 0 270.667 0 249.359V115.385C0 51.6667 51.6756 0 115.404 0C179.134 0 230.809 51.6667 230.809 115.385Z" />
          </clipPath>
        </defs>

        {/* The body. A div rather than SVG gradients because CSS can animate
            gradient positions and SVG gradient attributes still cannot be
            relied on to. */}
        <foreignObject width="231" height="289" clipPath="url(#buddy-body)">
          <div className="buddy-fill" />
        </foreignObject>

        <g
          className="buddy-eyes"
          style={{ transform: `translate(${look.x}px, ${look.y}px)` }}
        >
          <ellipse className="buddy-eye" cx="80" cy="120" rx="20" ry="30" />
          <ellipse className="buddy-eye buddy-eye--right" cx="151" cy="120" rx="20" ry="30" />
        </g>
      </svg>
    </div>
  );
}
