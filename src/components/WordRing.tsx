/**
 * The login headline, flying.
 *
 * Taken from a supplied jellyfish hero. What is worth having there is one
 * idea, and it is not the jellyfish: the phrases are not animated
 * individually. They are pinned at fixed seats on a vertical ring, each facing
 * inward, and a single container rotates. Everything else, the swell into
 * centre, the trapezoidal sweep, the turn away, falls out of that one rotation
 * and the browser's own perspective maths.
 *
 * The ring flies in the empty band across the top rather than around the
 * mascot. Around the mascot the silhouette ate the middle of every word and
 * left the band up here dead; up here the phrase is unobstructed and the page
 * has a headline where it had a gap. The glass treatment lives in the CSS.
 *
 * So none of the supplied dependencies come with it. three and
 * @react-three/fiber existed to draw the jellyfish procedurally, and this app
 * already has a mascot at the hub. The ring is CSS.
 *
 * The demo carries five different phrases, one per seat, and reads as a mood
 * board. This carries one, repeated: the product's name is not two words that
 * take turns. Splitting it across seats meant SPRINT arrived, left, and BUDDY
 * turned up nine seconds later on its own, which is not what the thing is
 * called. Every seat now shows the whole name, so it is always whole, and
 * repeating it across seats is what keeps the carousel's rhythm: one copy
 * rounds into view as the last turns away.
 */

/** Seconds for one full turn. With two seats the name arrives twice a lap. */
const LOOP = 18;

const PHRASE = "SPRINT BUDDY";
/** Seats on the ring. Every one carries the whole phrase. */
const SEATS = 2;
const STEP = 360 / SEATS;

export default function WordRing() {
  return (
    /* aria-hidden because the real heading is an .sr-only <h1> beside the
       form. Repeating the name on every seat is decoration; announcing it
       once per seat would be worse than silence. */
    <div className="ring" aria-hidden="true">
      <div className="ring-stage">
        {Array.from({ length: SEATS }, (_, i) => (
          <span
            key={i}
            className="ring-word"
            style={{
              /* Seat the phrase on the ring, then turn it to face inward, so
                 the readable side rounds the far side and arrives through the
                 centre rather than sweeping past the viewer's own position. */
              transform: `rotateY(${i * STEP}deg) translateZ(var(--ring-r)) rotateY(180deg)`,
              /* A negative delay phase-locks the fade to this seat's moment in
                 the rotation, so exactly one copy is bright at a time. The
                 half-loop shift is the inward facing above: the phrase is at
                 the back of the ring when it is in front of the reader. */
              animationDelay: `${(-LOOP * ((SEATS - i) % SEATS)) / SEATS - LOOP / 2}s`,
            }}
          >
            {PHRASE}
          </span>
        ))}
      </div>
    </div>
  );
}
