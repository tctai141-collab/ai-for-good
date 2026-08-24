import type { ButtonHTMLAttributes } from "react";

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
 * near-black. 18 is kept as a compromise: it reads on the constellation lines
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
      <GlassFilter />
    </button>
  );
}

/**
 * The filter itself. Rendered inside the button rather than once at the root
 * because there is exactly one of these on the page; if a second ever appears,
 * the duplicate id is the thing to fix, and having it here makes that obvious
 * rather than leaving an orphan <svg> in a layout nobody reads.
 *
 * backdrop-filter: url() is a real capability, not a fallback that quietly
 * does nothing: verified rendering in Chrome 151. Where it is unsupported the
 * pane simply stays transparent and the bevel still draws the button, so
 * nothing becomes unreadable or unclickable.
 */
function GlassFilter() {
  return (
    <svg className="glass-button-filter" aria-hidden="true" focusable="false">
      <defs>
        <filter
          id="sprint-glass"
          x="0%"
          y="0%"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence type="fractalNoise" baseFrequency="0.05 0.05" numOctaves={1} seed={1} result="noise" />
          <feGaussianBlur in="noise" stdDeviation="2" result="softNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="softNoise"
            scale="18"
            xChannelSelector="R"
            yChannelSelector="B"
            result="displaced"
          />
          <feGaussianBlur in="displaced" stdDeviation="1.5" />
        </filter>
      </defs>
    </svg>
  );
}
