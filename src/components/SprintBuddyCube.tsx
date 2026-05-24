import React, { useEffect, useRef } from "react";

interface Props {
  compact?: boolean;
  onTip?: () => void;
  reaction?: "wink" | "look-down" | "look-up" | null;
  size?: string;
}

type ReactionFn = (progress: number) => string;

const REACTION_FNS: Record<string, ReactionFn> = {
  wink: (p) => {
    // Squish then restore in first half, overshoot slightly
    const t = p < 0.5 ? p / 0.5 : 1 - (p - 0.5) / 0.5;
    const scaleY = 1 - t * 0.12;
    return `scaleY(${scaleY})`;
  },
  "look-down": (p) => {
    const t = p < 0.3 ? p / 0.3 : 1 - (p - 0.3) / 0.7;
    return `rotateX(${t * 15}deg)`;
  },
  "look-up": (p) => {
    const t = p < 0.3 ? p / 0.3 : 1 - (p - 0.3) / 0.7;
    return `rotateX(${-t * 15}deg)`;
  },
};

export default function SprintBuddyCube({ compact, onTip, reaction, size }: Props) {
  const cubeRef = useRef<HTMLDivElement>(null);
  const pupilsRef = useRef<HTMLSpanElement[]>([]);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const targetRef = useRef({ rotX: 0, rotY: 0 });
  const currentRef = useRef({ rotX: 0, rotY: 0 });
  const reactionRef = useRef<{
    type: string;
    startTime: number;
    duration: number;
  } | null>(null);
  const lastReaction = useRef<string | null>(null);

  useEffect(() => {
    const cube = cubeRef.current;
    if (!cube) return;
    const gazeAnchor = cube.closest(".persistent-buddy") ?? cube.parentElement ?? cube;

    const updateTargets = (x: number, y: number) => {
      pointerRef.current = { x, y };
      const rect = gazeAnchor.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const radiusX = Math.max(rect.width * 1.15, 140);
      const radiusY = Math.max(rect.height * 1.15, 140);
      const nx = Math.max(-1, Math.min(1, (x - centerX) / radiusX));
      const ny = Math.max(-1, Math.min(1, (y - centerY) / radiusY));
      targetRef.current = { rotX: -ny * 14, rotY: nx * 22 };

      pupilsRef.current.forEach((pupil) => {
        if (pupil) {
          const eye = pupil.parentElement;
          const maxX = Math.max(0, ((eye?.clientWidth ?? 0) - pupil.clientWidth) / 2);
          const maxY = Math.max(0, ((eye?.clientHeight ?? 0) - pupil.clientHeight) / 2);

          pupil.style.transform = `translate(${nx * maxX}px, ${ny * maxY}px)`;
        }
      });
    };

    const onPointerMove = (e: PointerEvent) => updateTargets(e.clientX, e.clientY);
    const resetTargets = () => {
      const rect = gazeAnchor.getBoundingClientRect();
      updateTargets(rect.left + rect.width / 2, rect.top + rect.height / 2);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerleave", resetTargets);
    window.addEventListener("resize", resetTargets);

    resetTargets();

    let animId: number;
    const REACTION_DURATION = 600; // ms

    const animate = (now: number) => {
      const c = currentRef.current;
      const t = targetRef.current;
      c.rotX += (t.rotX - c.rotX) * 0.08;
      c.rotY += (t.rotY - c.rotY) * 0.08;
      const drift = Math.sin(now / 1800) * 3;

      let transform = `rotateX(${c.rotX + drift}deg) rotateY(${c.rotY}deg) rotateZ(${drift * 0.2}deg)`;

      // Apply reaction effect (driven by JS, no CSS animation conflict)
      const r = reactionRef.current;
      if (r) {
        const elapsed = now - r.startTime;
        const progress = Math.min(elapsed / r.duration, 1);
        const fn = REACTION_FNS[r.type];
        if (fn) {
          transform += " " + fn(progress);
        }
        if (progress >= 1) {
          reactionRef.current = null;
        }
      }

      cube.style.transform = transform;
      animId = requestAnimationFrame(animate);
    };
    animId = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", resetTargets);
      window.removeEventListener("resize", resetTargets);
      cancelAnimationFrame(animId);
    };
  }, []);

  // Watch for reaction prop changes
  useEffect(() => {
    if (reaction && reaction !== lastReaction.current) {
      lastReaction.current = reaction;
      reactionRef.current = {
        type: reaction,
        startTime: performance.now(),
        duration: 600,
      };
    }
  }, [reaction]);

  const setPupilRef = (el: HTMLSpanElement | null) => {
    if (el && !pupilsRef.current.includes(el)) {
      pupilsRef.current.push(el);
    }
  };

  const resolvedSize = size ?? (compact ? "clamp(3rem, 6vw, 5rem)" : "clamp(11rem, 25vw, 22rem)");
  const half = `calc(${resolvedSize} / 2)`;

  return (
    <div
      className={`cube ${compact ? "cube--compact" : "cube--hero"}`}
      ref={cubeRef}
      onClick={compact && onTip ? onTip : undefined}
      role={compact ? "button" : undefined}
      aria-label={compact ? "Get a coaching tip" : undefined}
      tabIndex={compact ? 0 : undefined}
      onKeyDown={
        compact && onTip
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onTip();
              }
            }
          : undefined
      }
      style={
        {
          "--size": resolvedSize,
          "--half": half,
          width: resolvedSize,
          height: resolvedSize,
        } as React.CSSProperties
      }
    >
      <div className="face front">
        <div className="eyes" aria-hidden="true">
          <span className="eye">
            <span className="pupil" ref={setPupilRef} />
          </span>
          <span className="eye">
            <span className="pupil" ref={setPupilRef} />
          </span>
        </div>
      </div>
      <div className="face back" />
      <div className="face right" />
      <div className="face left" />
      <div className="face top" />
      <div className="face bottom" />
    </div>
  );
}
