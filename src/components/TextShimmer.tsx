/**
 * Text with a highlight travelling through it.
 *
 * The supplied component wraps the element in framer-motion to animate one
 * property, `backgroundPosition`, and writes the gradient as a stack of
 * Tailwind arbitrary-value classes. Neither is available here, and neither is
 * needed: a moving background position is a keyframe, and the gradient is four
 * lines of CSS. So this is the same effect with no dependency and no build-time
 * class generation.
 *
 * The one piece of real logic kept from it is the spread scaling with the
 * length of the string. A fixed-width highlight crossing a long line reads as a
 * dot sliding along; scaled, it reads as a sweep, which is the difference
 * between the effect working and not.
 */

type Props = {
  children: string;
  /** Seconds for one pass. */
  duration?: number;
  /** Highlight width per character, in px. */
  spread?: number;
  className?: string;
};

export default function TextShimmer({
  children,
  duration = 1.6,
  spread = 2,
  className,
}: Props) {
  return (
    <span
      className={`shimmer${className ? ` ${className}` : ""}`}
      style={{
        // Code points, not code units, so the width is right for any script.
        ["--shimmer-spread" as string]: `${[...children].length * spread}px`,
        ["--shimmer-duration" as string]: `${duration}s`,
      }}
    >
      {children}
    </span>
  );
}
