import type { ButtonHTMLAttributes } from "react";
import GlassFilter from "./GlassFilter";

/**
 * The liquid glass button.
 *
 * Ported from a supplied shadcn `LiquidButton`. Three layers, in this order
 * back to front: a pane that refracts whatever is behind it, a bevel drawn
 * entirely in box-shadow, and the label. The label has to sit above both or it
 * gets refracted along with the background and stops being readable, which is
 * exactly what happened the first time this was assembled.
 *
 * What was dropped, and why:
 *
 *   class-variance-authority and @radix-ui/react-slot carried six colour
 *   variants, six sizes and an `asChild` escape hatch. There is one button on
 *   one screen. Two dependencies for a prop nobody passes.
 *
 *   The supplied file also shipped a shadcn `Button` and a `MetalButton`
 *   neither of which is used here.
 *
 * On `scale`: the original displaces by 70. Measured against this app's own
 * login background rather than the demo's, 70, 24 and 8 are indistinguishable,
 * because the ground is near-black and refracting near-black returns
 * near-black. 18 is kept as a compromise: it reads on the lattice lines
 * and the grid where they pass behind the button, and it does not smear when
 * the mascot's glow reaches this far.
 */

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Rendered above the glass. Anything else would be refracted. */
  children: React.ReactNode;
};

export default function LiquidGlassButton({ children, className, ...rest }: Props) {
  return (
    <button {...rest} className={`glass-button${className ? ` ${className}` : ""}`}>
      <span className="glass-button-pane" aria-hidden="true" />
      <span className="glass-button-bevel" aria-hidden="true" />
      <span className="glass-button-label">{children}</span>
      {/* Shared, and named explicitly. This used to be defined inline below,
          with a note that a second copy on the page would be the thing to fix.
          The assessment now puts several glass surfaces on one screen, so it
          moved into its own component and each family names its own id. */}
      <GlassFilter id="sprint-glass" />
    </button>
  );
}
