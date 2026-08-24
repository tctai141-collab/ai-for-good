/**
 * The refraction filter the glass surfaces sample through.
 *
 * Extracted from LiquidGlassButton, which rendered it inside the button with a
 * note saying that was fine because there was exactly one on the page and "if a
 * second ever appears, the duplicate id is the thing to fix." The assessment
 * puts two or three glass panes on screen at once, so a second has appeared.
 *
 * SVG filter ids are global to the document. Two elements both defining
 * `#sprint-glass` is not an error anyone reports: the browser resolves every
 * reference to whichever it found first, and if that one unmounts, every pane
 * still pointing at it silently loses its refraction. Hence the id prop, one
 * instance per surface family, and no defaults.
 *
 * On `scale`: measured against this app's near-black ground, 8, 24 and 70 are
 * indistinguishable, because refracting near-black returns near-black. 18 reads
 * on the grid lines and the constellation where they pass behind a surface, and
 * does not smear when the mascot's glow reaches it.
 */
export default function GlassFilter({ id }: { id: string }) {
  return (
    <svg className="glass-filter" aria-hidden="true" focusable="false">
      <defs>
        <filter
          id={id}
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
