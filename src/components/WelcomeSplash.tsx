import { useCallback, useEffect, useRef, useState } from "react";
import Typewriter from "./Typewriter";
import { runAsciiRain } from "../lib/asciiRain";

/**
 * The screen between a successful sign-in and the app.
 *
 * Film behind, the welcome typed over it, held for six seconds.
 *
 * The look is adapted from a supplied "Airlock" hero, and the adaptation is
 * most of the work: that component is scroll-driven end to end. It pins
 * document.body with position:fixed, spends wheel, touch and key input on
 * video.currentTime, hands the page back when the film runs out, and re-takes
 * the lock if the reader scrolls up into it again.
 *
 * None of that can attach here. This app never scrolls — body carries
 * overflow:hidden and every scrolling region is an internal overflow-y
 * container — so there is no page to hand back and nothing to scroll up into.
 * And this is a timed transition rather than a destination: three seconds,
 * now six, with no way to linger. So the film plays itself, and what is
 * actually borrowed is the picture: the falloff, the centre scrim, the
 * blur-to-focus on the type, and the progress line.
 *
 * The video is served from this origin. The original points at jsDelivr, which
 * the CSP would refuse outright — media-src is not set, so it falls back to
 * default-src 'self' — and which would hand every founder's IP to a CDN on
 * sign-in, the exact thing the self-hosted fonts exist to avoid.
 *
 * The rain is still here, underneath. It is not decoration on decoration: the
 * film is 1.2 MB and will not have arrived on a first sign-in over mobile
 * data, whereas the canvas paints in a frame with no network at all. So the
 * order is rain, then poster, then film as it becomes playable. If the video
 * is slow, or blocked, or refused autoplay, the founder gets the splash this
 * screen has always had rather than a black rectangle.
 *
 * The greeting uses the name on the account. Every account has one: it is set
 * when the organizer adds the person, and the session returns it alongside the
 * email and the role.
 */

/*
 * Two lines, and the break is written rather than left to the box.
 *
 * As one string it wrapped wherever the width happened to fall, which orphaned
 * "It" at the end of the first line and dropped "begins here!" on its own.
 * With a name in it the break moves about as the name changes length, so there
 * is no width that fixes it. The newline is rendered by white-space: pre-line.
 */
const SECOND_LINE = "It begins here!";

function greeting(name: string): string {
  const clean = name.trim();
  /* No name on the account is not worth a blank line: the cohort's own word
     stands in, which is what this said before it was personal. */
  return clean.length > 0 ? `Welcome, ${clean}.` : "Welcome Sprinters.";
}

/**
 * How long the splash is held. A floor, not a cut: see `onDone` below.
 *
 * Three seconds until the film arrived, which was long enough for a line of
 * type and too short to read as anything. Six is one number and moving it is a
 * one-line change — five is equally fine — but it is worth knowing what it
 * costs before raising it further: this runs on every interactive sign-in, and
 * sessions go idle after 24 hours, so a founder meets it most mornings for
 * seven weeks. That is what the skip control is for.
 */
export const SPLASH_MS = 6000;

/** Same-origin, committed under public/. See the note above on why. */
const FILM = "/video/iss-hero-720p.mp4";
const POSTER = "/video/iss-hero-poster.jpg";

/**
 * Paints what the rain samples. Not a photograph: the word itself, so the
 * denser characters trace the letters.
 */
function paintSource(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  /* A faint centre lift, not a wash. At 0.55 this raised the floor across the
     whole frame and the wordmark below had nothing left to stand out against:
     the rain came out an even field of green. */
  const glow = ctx.createRadialGradient(
    width / 2,
    height / 2,
    0,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.5,
  );
  glow.addColorStop(0, "rgba(255,255,255,0.18)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  const size = Math.min(width * 0.16, height * 0.26);
  /* Inter, like everything else. Drawn to a canvas, so it names the family
     directly rather than reading a CSS token. */
  ctx.font = `800 ${size}px Inter, ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText("SPRINT", width / 2, height / 2 - size * 0.55);
  ctx.fillText("BUDDY", width / 2, height / 2 + size * 0.55);
  ctx.restore();
}

export default function WelcomeSplash({ name, onDone }: { name: string; onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  /* Whether the film has enough data to paint. Until it does, the poster and
     the rain are what is on screen. */
  const [filmReady, setFilmReady] = useState(false);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
    };
    resize();

    /* The supplied preset, with cellSize scaled for device pixels so the grid
       is the same size on screen at any ratio rather than half as coarse on a
       retina display. */
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const stop = runAsciiRain(canvas, paintSource, {
      cellSize: 14 * dpr,
      bgColor: "#05070a",
    });

    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      stop();
    };
  }, []);

  /*
   * The film.
   *
   * muted is set on the element *and* here, which is not belt-and-braces for
   * its own sake: React does not reflect the muted attribute onto the DOM
   * property reliably, and an unmuted video is refused autoplay by every
   * mobile browser. Missing this is a film that silently never starts.
   *
   * play() is called rather than left to the autoplay attribute so the
   * rejection can be caught. Low-power mode and some data-saver settings
   * refuse it outright; that is a poster and some rain, not an exception.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setStill(reduced);

    video.muted = true;
    const onReady = () => setFilmReady(true);
    video.addEventListener("canplay", onReady);
    /* Already buffered from an earlier sign-in: canplay has been and gone. */
    if (video.readyState >= 3) setFilmReady(true);

    if (!reduced) void video.play().catch(() => {});

    return () => video.removeEventListener("canplay", onReady);
  }, []);

  /*
   * Ending it. `onDone` only lifts this component's own hold — App still waits
   * for the user data, so skipping early cannot land anyone on a half-built
   * screen. Calling it twice is harmless, which is what lets the timer and the
   * skip share it.
   */
  const done = useCallback(() => onDone(), [onDone]);

  useEffect(() => {
    const timer = window.setTimeout(done, SPLASH_MS);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter" || event.key === " ") done();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [done]);

  return (
    <div className="splash" role="status" aria-live="polite">
      <canvas ref={canvasRef} className="splash-canvas" aria-hidden="true" />

      <video
        ref={videoRef}
        className="splash-video"
        src={FILM}
        poster={POSTER}
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        style={{
          opacity: filmReady ? 1 : 0,
          /* Held still for anyone who asked for that; the frame is the point,
             not the drift across it. */
          animationDuration: still ? "0s" : `${SPLASH_MS}ms`,
        }}
      />

      {/* Top and bottom falloff, so the type never fights the sky. */}
      <div className="splash-falloff" aria-hidden="true" />
      {/* Centre scrim. The daylit half of the planet is bright enough to
          swallow the line without it. */}
      <div className="splash-scrim" aria-hidden="true" />

      <p className="splash-line">
        {/* The message is in the DOM as text for a screen reader; the film and
            the rain behind it are decoration and are hidden. */}
        <Typewriter text={`${greeting(name)}\n${SECOND_LINE}`} speed={48} startDelay={220} />
      </p>

      {/*
        Visible, unlike the original's, which is transparent until focused. A
        skip nobody can see is a skip nobody uses, and six seconds on every
        sign-in for seven weeks is precisely the thing worth being able to
        leave.
      */}
      <button type="button" className="splash-skip" onClick={done}>
        Skip
      </button>

      <div className="splash-progress" aria-hidden="true">
        <div
          className="splash-progress-fill"
          style={{ animationDuration: still ? "0s" : `${SPLASH_MS}ms` }}
        />
      </div>
    </div>
  );
}
