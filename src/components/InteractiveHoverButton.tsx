import type { ButtonHTMLAttributes } from "react";

/**
 * A button whose label steps aside on hover to show what it will do.
 *
 * A dot in the corner swells to fill the whole pill, the resting label slides
 * out to the right, and the action slides in behind it with an arrow.
 *
 * Ported from a supplied component. Two departures, one mechanical and one
 * about what the thing is for:
 *
 *   No Tailwind and no lucide-react. The whole of the original is utility
 *   classes and one icon; the classes are a stylesheet and the icon is eight
 *   SVG path commands.
 *
 *   The original shows the *same* text at rest and on hover, so hovering tells
 *   you nothing you did not already know. Here they are separate, because the
 *   problem this is being used to fix is that the control did not look like a
 *   control: at rest it says what the state is, and on hover it says what
 *   clicking will do.
 */

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Shown at rest. Usually the current state. */
  label: string;
  /** Shown on hover and on focus. Say what the click will do. */
  action: string;
  /** Draws the pill as the live, primary choice. */
  emphasis?: boolean;
};

export default function InteractiveHoverButton({
  label,
  action,
  emphasis = false,
  className,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      className={`ihb${emphasis ? " ihb--on" : ""}${className ? ` ${className}` : ""}`}
    >
      {/* The resting label sets the pill's width, so it does not resize when
          the longer action slides in. */}
      <span className="ihb-label">{label}</span>
      <span className="ihb-action" aria-hidden="true">
        {action}
        <svg viewBox="0 0 24 24" className="ihb-arrow" aria-hidden="true" focusable="false">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
      <span className="ihb-fill" aria-hidden="true" />
      {/* The action is aria-hidden because it is the same act the button
          already performs; a screen reader gets the accessible name below. */}
    </button>
  );
}
