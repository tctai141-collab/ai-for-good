/**
 * The switch that opens the on-screen keyboard.
 *
 * Rebuilt from a supplied component. What changed and why:
 *
 *   motion/react is gone. The original animates the knob with a spring, the
 *   track colour with a tween, and a highlight sweep with a keyframe array —
 *   about 30KB of runtime for a control that moves 20 pixels. Two CSS
 *   transitions do the same job, and this app ships four runtime dependencies
 *   on purpose.
 *
 *   Drag-to-toggle is gone with it. It was the component's most interesting
 *   idea and it is the wrong one here: this switch sits beside a text field, a
 *   horizontal drag inside a composer is a text selection, and a control that
 *   sometimes swallows that is worse than one that only takes a tap.
 *
 *   It is a real checkbox now. The original is a div with onClick — no role,
 *   no keyboard, invisible to a screen reader, which is a poor thing to build
 *   for a feature whose whole purpose is helping somebody who cannot use the
 *   ordinary input. The input is the control; everything drawn is decoration
 *   layered on top of it.
 *
 * Kept: the proportions, the pill knob with its rim highlight, the ON bar and
 * OFF ring, and the pressed state.
 */

export default function GlassToggle({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Read by a screen reader. Visible copy is the host's business. */
  label: string;
  id: string;
}) {
  return (
    <span className="gt">
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="gt-input"
        checked={checked}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="gt-track" aria-hidden="true">
        <span className="gt-on" />
        <span className="gt-off" />
        <span className="gt-knob" />
      </span>
    </span>
  );
}

export const GLASS_TOGGLE_CSS = `
.gt { position: relative; display: inline-flex; flex: 0 0 auto; }

/* The input is the control and it is what receives focus; it simply is not
   what you see. Opacity rather than display:none, which would take it out of
   the accessibility tree along with the tab order. */
.gt-input {
  position: absolute; inset: 0; margin: 0;
  width: 100%; height: 100%;
  opacity: 0; cursor: pointer; z-index: 1;
}

.gt-track {
  position: relative; display: block;
  width: 46px; height: 26px;
  border-radius: 999px;
  background: var(--line-strong, rgba(255,255,255,0.14));
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.28);
  transition: background-color 180ms ease;
}
.gt-input:checked + .gt-track { background: var(--brand-accent, #5e6ad2); }
.gt-input:focus-visible + .gt-track {
  outline: 2px solid var(--brand-accent, #5e6ad2);
  outline-offset: 3px;
}
.gt-input:active + .gt-track { box-shadow: inset 0 1px 2px rgba(0,0,0,0.28), 0 0 0 3px rgba(94,106,210,0.18); }

/* The bar on the left when on, the ring on the right when off. Two marks
   rather than one, so the state is readable without relying on the track
   colour alone. */
.gt-on, .gt-off { position: absolute; top: 50%; transition: opacity 140ms ease; }
.gt-on {
  left: 9px; width: 2px; height: 9px; margin-top: -4.5px;
  border-radius: 2px; background: #fff; opacity: 0;
}
.gt-off {
  right: 8px; width: 7px; height: 7px; margin-top: -3.5px;
  border-radius: 999px; border: 1.5px solid rgba(255,255,255,0.45); opacity: 1;
}
.gt-input:checked + .gt-track .gt-on { opacity: 1; }
.gt-input:checked + .gt-track .gt-off { opacity: 0; }

.gt-knob {
  position: absolute; top: 3px; left: 3px;
  width: 20px; height: 20px;
  border-radius: 999px;
  background: linear-gradient(180deg, #ffffff 0%, #f2f2f4 55%, #e4e4e8 100%);
  box-shadow: 0 2px 5px rgba(0,0,0,0.28), inset 0 -1.5px 3px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.9);
  transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.gt-input:checked + .gt-track .gt-knob { transform: translateX(20px); }
.gt-input:active + .gt-track .gt-knob { width: 23px; }

@media (prefers-reduced-motion: reduce) {
  .gt-track, .gt-knob, .gt-on, .gt-off { transition: none; }
}
`;
