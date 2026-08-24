/**
 * The login headline, flying.
 *
 * Taken from a supplied jellyfish hero. What is worth having there is one
 * idea, and it is not the jellyfish: the words are not animated individually.
 * They are pinned at fixed seats on a vertical ring, each facing inward, and a
 * single container rotates. Everything else, the swell into centre, the
 * trapezoidal sweep, the turn away, falls out of that one rotation and the
 * browser's own perspective maths.
 *
 * The ring flies in the empty band across the top rather than around the
 * mascot. Around the mascot the silhouette ate the middle of every word and
 * left the band up here dead; up here the words are unobstructed and the page
 * has a headline where it had a gap. The glass treatment lives in the CSS.
 *
 * So none of the supplied dependencies come with it. three and
 * @react-three/fiber existed to draw the jellyfish procedurally, and this app
 * already has a mascot at the hub. The ring is CSS.
 *
 * Two words rather than the demo's five: this is a product name, not a mood
 * board. SPRINT and BUDDY sit opposite each other, so the name reads out in
 * order, one word at a time, as the ring comes round.
 */

/** Seconds for one full turn. Each word is legible for roughly half of it. */
const LOOP = 18;

const WORDS = ["SPRINT", "BUDDY"] as const;
const STEP = 360 / WORDS.length;

export default function WordRing() {
  return (
    /* aria-hidden because the real heading is an .sr-only <h1> beside the
       form. A ring of duplicated brand words is decoration, and reading it
       aloud in orbit order would be worse than silence. */
    <div className="ring" aria-hidden="true">
      <div className="ring-stage">
        {WORDS.map((word, i) => (
          <span
            key={word}
            className="ring-word"
            style={{
              /* Seat the word on the ring, then turn it to face inward, so the
                 readable side rounds the far side and passes behind the
                 mascot rather than in front of the viewer's own position. */
              transform: `rotateY(${i * STEP}deg) translateZ(var(--ring-r)) rotateY(180deg)`,
              /* A negative delay phase-locks the fade to this seat's moment in
                 the rotation, so exactly one word is bright at a time. The
                 half-loop shift is the inward facing above: the word is at the
                 back of the ring when it is in front of the reader. */
              animationDelay: `${(-LOOP * ((WORDS.length - i) % WORDS.length)) / WORDS.length - LOOP / 2}s`,
            }}
          >
            {word}
          </span>
        ))}
      </div>
    </div>
  );
}
