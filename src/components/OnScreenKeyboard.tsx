import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

/**
 * An on-screen keyboard that actually types.
 *
 * Rebuilt from a supplied component rather than copied, and the reason is the
 * whole feature: the original renders a beautiful keyboard and has no output.
 * It animates a keycap, plays a sound, and shows the pressed key in a caption.
 * Nothing it does reaches a text field. Dropped in as-is it would be an
 * ornament under the composer that looks broken the first time somebody tries
 * to write with it.
 *
 * So the layout, the wood case and the keycap sculpting are kept; the
 * behaviour is new. Every key emits a KeyOutput, Shift and CapsLock change what
 * is emitted, Backspace deletes at the caret and Enter sends. What it does with
 * that is the host's business, which is what lets one keyboard serve both a
 * React-controlled composer and a plain textarea on the admin page.
 *
 * Also not carried over:
 *
 *   The 30KB base64 audio sample. It sits in the bundle for everybody whether
 *   or not they ever open the keyboard, and this app ships four runtime
 *   dependencies precisely to avoid that kind of weight. The click is
 *   synthesised instead — a filtered noise burst with a fast envelope, which
 *   is what the sample is.
 *
 *   The global keydown listener. The original binds one to highlight keycaps
 *   as you type on a real keyboard, and it calls preventDefault on Alt. A
 *   listener that swallows modifiers on every page is not worth a highlight,
 *   and this keyboard exists for people who are not using a physical one.
 *
 *   Tailwind and motion/react, neither of which this codebase has.
 */

export type KeyOutput =
  | { type: "char"; char: string }
  | { type: "backspace" }
  | { type: "enter" }
  | { type: "space" };

type KeyConfig = {
  id: string;
  label: string;
  shiftLabel?: string;
  /** Relative width in key units. */
  width?: number;
  small?: boolean;
  align?: "left" | "center";
  muted?: boolean;
};

const ROWS: KeyConfig[][] = [
  [
    { id: "1", label: "1", shiftLabel: "!" }, { id: "2", label: "2", shiftLabel: "@" },
    { id: "3", label: "3", shiftLabel: "#" }, { id: "4", label: "4", shiftLabel: "$" },
    { id: "5", label: "5", shiftLabel: "%" }, { id: "6", label: "6", shiftLabel: "^" },
    { id: "7", label: "7", shiftLabel: "&" }, { id: "8", label: "8", shiftLabel: "*" },
    { id: "9", label: "9", shiftLabel: "(" }, { id: "0", label: "0", shiftLabel: ")" },
    { id: "minus", label: "-", shiftLabel: "_" }, { id: "equal", label: "=", shiftLabel: "+" },
    { id: "backspace", label: "⌫", width: 2, small: true },
  ],
  [
    { id: "q", label: "Q" }, { id: "w", label: "W" }, { id: "e", label: "E" },
    { id: "r", label: "R" }, { id: "t", label: "T" }, { id: "y", label: "Y" },
    { id: "u", label: "U" }, { id: "i", label: "I" }, { id: "o", label: "O" },
    { id: "p", label: "P" },
    { id: "lbracket", label: "[", shiftLabel: "{" }, { id: "rbracket", label: "]", shiftLabel: "}" },
  ],
  [
    { id: "caps", label: "Caps", width: 1.5, small: true, align: "left" },
    { id: "a", label: "A" }, { id: "s", label: "S" }, { id: "d", label: "D" },
    { id: "f", label: "F" }, { id: "g", label: "G" }, { id: "h", label: "H" },
    { id: "j", label: "J" }, { id: "k", label: "K" }, { id: "l", label: "L" },
    { id: "semicolon", label: ";", shiftLabel: ":" }, { id: "quote", label: "'", shiftLabel: '"' },
  ],
  [
    { id: "lshift", label: "Shift", width: 2, small: true, align: "left" },
    { id: "z", label: "Z" }, { id: "x", label: "X" }, { id: "c", label: "C" },
    { id: "v", label: "V" }, { id: "b", label: "B" }, { id: "n", label: "N" },
    { id: "m", label: "M" },
    { id: "comma", label: ",", shiftLabel: "<" }, { id: "period", label: ".", shiftLabel: ">" },
    { id: "slash", label: "/", shiftLabel: "?" },
  ],
  [
    { id: "space", label: "", width: 8 },
    { id: "enter", label: "Enter", width: 2.5, small: true },
  ],
];

/** What a key id produces, unshifted. */
const CHAR_FOR: Record<string, string> = {
  minus: "-", equal: "=", lbracket: "[", rbracket: "]",
  semicolon: ";", quote: "'", comma: ",", period: ".", slash: "/",
};

const STICKY = new Set(["lshift", "caps"]);
const COMMANDS = new Set(["backspace", "enter", "space"]);

/* ── Texture ───────────────────────────────────────────────────────────────
   Carried over from the supplied component. These are generated SVG noise,
   not image files, so they cost nothing to serve and the CSP already allows
   img-src data:. */
const uri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

const WOOD_GRAIN = uri(`<svg xmlns='http://www.w3.org/2000/svg' width='460' height='460'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.14 0.0032' numOctaves='6' seed='23' stitchTiles='stitch' result='n'/><feColorMatrix in='n' type='matrix' values='0 0 0 0 0.27  0 0 0 0 0.15  0 0 0 0 0.065  0 0 0 1.0 0'/></filter><rect width='100%' height='100%' filter='url(#g)'/></svg>`);
const WOOD_TONE = uri(`<svg xmlns='http://www.w3.org/2000/svg' width='520' height='520'><filter id='t'><feTurbulence type='fractalNoise' baseFrequency='0.0045' numOctaves='2' seed='11' result='n'/><feColorMatrix in='n' type='matrix' values='0 0 0 0 0.22  0 0 0 0 0.115  0 0 0 0 0.045  0 0 0 0.5 0'/></filter><rect width='100%' height='100%' filter='url(#t)'/></svg>`);
const PBT_NOISE = uri(`<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='4' result='t'/><feColorMatrix in='t' type='matrix' values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.045 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`);

const KEYCAP = "#DFD2C3";
const INK = "#413e38";
const INK_SOFT = "#726d64";

/** Deterministic per-key variation, so no two keycaps are identical. */
function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}
function shift(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v + amount * 2.2)));
  return `rgb(${c((n >> 16) & 255)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}

/* ── Sound ─────────────────────────────────────────────────────────────────
   Synthesised, not sampled. A filtered noise burst with a fast envelope is
   what a keypress is, and it costs a few lines instead of 30KB of base64 in
   everybody's bundle. Built lazily on the first press so no AudioContext is
   created for somebody who never opens the keyboard. */
let audio: { ctx: AudioContext; out: GainNode } | null = null;

function click(kind: "normal" | "space" | "modifier") {
  if (typeof window === "undefined") return;
  try {
    if (!audio) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const out = ctx.createGain();
      out.gain.value = 0.16;
      out.connect(ctx.destination);
      audio = { ctx, out };
    }
    const { ctx, out } = audio;
    if (ctx.state === "suspended") void ctx.resume();

    const now = ctx.currentTime;
    const dur = kind === "space" ? 0.09 : 0.055;
    const frames = Math.max(1, Math.ceil(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let lp = 0;
    for (let i = 0; i < frames; i++) {
      const t = i / frames;
      const raw = (Math.random() * 2 - 1) * Math.pow(1 - t, kind === "space" ? 3.2 : 4.6);
      lp += (raw - lp) * 0.42;
      data[i] = lp;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = kind === "space" ? 1400 : kind === "modifier" ? 2600 : 3400;
    const gain = ctx.createGain();
    gain.gain.value = kind === "space" ? 1 : kind === "modifier" ? 0.72 : 0.9;
    src.connect(filter); filter.connect(gain); gain.connect(out);
    src.onended = () => { src.disconnect(); filter.disconnect(); gain.disconnect(); };
    src.start(now);
  } catch {
    // Sound is decoration. Never let it stop a keypress reaching the field.
  }
}

const Key = memo(function Key({
  config, held, onPress,
}: {
  config: KeyConfig;
  held: boolean;
  onPress: (id: string) => void;
}) {
  const { id, label, shiftLabel, width = 1, small, align = "center" } = config;
  const [down, setDown] = useState(false);
  const v = useMemo(() => ({
    light: (hash(id + "b") - 0.5) * 4,
    hue: (hash(id) - 0.5) * 3,
    tilt: (hash(id + "e") - 0.5) * 0.32,
  }), [id]);

  const press = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    /* Keeps the caret in the field. Without it the first press blurs the
       textarea, and every character after that has nowhere to go. */
    event.preventDefault();
    setDown(true);
    onPress(id);
  }, [id, onPress]);

  const release = useCallback(() => setDown(false), []);
  const pressed = down || held;

  return (
    <button
      type="button"
      aria-label={label || "Space"}
      aria-pressed={STICKY.has(id) ? held : undefined}
      data-key={id}
      data-pressed={pressed}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      className="osk-key"
      style={{ flexGrow: width, flexBasis: 0, ["--tilt" as string]: `${v.tilt}deg` } as CSSProperties}
    >
      <span
        className="osk-wall"
        style={{
          background: `linear-gradient(180deg, ${shift("#f0e4d1", v.light)} 0%, ${shift("#e0cead", v.light)} 18%, ${shift("#c8b394", v.light)} 46%, ${shift("#a68e70", v.light * 0.7)} 78%, ${shift("#8c7458", v.light * 0.5)} 100%)`,
          filter: `hue-rotate(${v.hue}deg)`,
        }}
      />
      <span
        className="osk-top"
        style={{
          background: `radial-gradient(115% 125% at 23% 9%, rgba(255,255,255,0.4), rgba(255,255,255,0) 44%), ${shift(KEYCAP, v.light * 0.6)}`,
          backgroundImage: `url("${PBT_NOISE}")`,
          backgroundBlendMode: "overlay",
          filter: `hue-rotate(${v.hue * 0.4}deg)`,
        }}
      />
      <span className="osk-legend">
        {shiftLabel && <span className="osk-shift">{shiftLabel}</span>}
        {label && (
          <span
            className={small ? "osk-label osk-label--small" : "osk-label"}
            style={align === "left" ? { left: "0.7em", transform: "none" } : undefined}
          >
            {label}
          </span>
        )}
      </span>
    </button>
  );
});

export default function OnScreenKeyboard({ onKey }: { onKey: (out: KeyOutput) => void }) {
  /*
   * The refs are the modifier state; the useState pair only draws the held
   * keycap.
   *
   * Mirroring state into a ref during render (`shiftRef.current = shiftOn`)
   * looks equivalent and is not: two presses inside one frame both read the
   * value from before the first render, so pressing Shift then H produced a
   * lowercase h. Reproduced. Writing the ref inside the handler makes the next
   * press see it whatever React has or has not flushed.
   */
  const shiftRef = useRef(false);
  const capsRef = useRef(false);
  const [shiftOn, setShiftOn] = useState(false);
  const [capsOn, setCapsOn] = useState(false);

  const clearShift = useCallback(() => {
    if (!shiftRef.current) return;
    shiftRef.current = false;
    setShiftOn(false);
  }, []);

  const handle = useCallback((id: string) => {
    if (id === "lshift") {
      shiftRef.current = !shiftRef.current;
      setShiftOn(shiftRef.current);
      click("modifier");
      return;
    }
    if (id === "caps") {
      capsRef.current = !capsRef.current;
      setCapsOn(capsRef.current);
      click("modifier");
      return;
    }

    if (COMMANDS.has(id)) {
      click(id === "space" ? "space" : "modifier");
      onKey(id === "space" ? { type: "space" } : id === "enter" ? { type: "enter" } : { type: "backspace" });
      clearShift();
      return;
    }

    click("normal");
    const cfg = ROWS.flat().find((k) => k.id === id);
    /* Shift and Caps cancel each other on a letter, as they do everywhere. */
    const upper = shiftRef.current !== capsRef.current;
    let char: string;
    if (cfg?.shiftLabel && shiftRef.current) char = cfg.shiftLabel;
    else if (CHAR_FOR[id]) char = CHAR_FOR[id];
    else if (/^[a-z]$/.test(id)) char = upper ? id.toUpperCase() : id;
    else char = id;

    onKey({ type: "char", char });
    /* Shift is one-shot, the way it is on a real keyboard. Caps is not. */
    clearShift();
  }, [clearShift, onKey]);

  return (
    <div className="osk" role="group" aria-label="On-screen keyboard">
      <div className="osk-case">
        <span className="osk-tone" style={{ backgroundImage: `url("${WOOD_TONE}")` }} />
        <span className="osk-grain" style={{ backgroundImage: `url("${WOOD_GRAIN}")` }} />
        <div className="osk-bezel">
          {ROWS.map((row, i) => (
            <div className="osk-row" key={i}>
              {row.map((k) => (
                <Key
                  key={k.id}
                  config={k}
                  held={(k.id === "lshift" && shiftOn) || (k.id === "caps" && capsOn)}
                  onPress={handle}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Applies a keypress to a string at a caret.
 *
 * Takes the value rather than the element, and that is the whole point.
 *
 * The first version read `el.value` and `el.selectionStart` off the DOM. That
 * works for a textarea the page owns and is wrong for a React-controlled one:
 * the value in the DOM is last render's, so two presses inside one frame both
 * compute from the same stale string and the second overwrites the first.
 * Typing "Hi there" quickly produced "err422Y" — reproduced, not theorised.
 * Slow human typing hid it, which is the worst way for a bug like this to
 * behave.
 *
 * Pure, so each host can feed it whatever it knows to be current: the founder
 * composer passes React state through a functional update, and the admin page
 * passes the DOM. Also makes it testable without a browser.
 */
export function applyKey(
  value: string,
  start: number,
  end: number,
  out: KeyOutput,
): { value: string; caret: number } {

  const insert = (text: string) => ({
    value: value.slice(0, start) + text + value.slice(end),
    caret: start + text.length,
  });

  if (out.type === "char") return insert(out.char);
  if (out.type === "space") return insert(" ");
  if (out.type === "enter") return insert("\n");

  // Backspace: delete the selection if there is one, otherwise one character.
  if (start !== end) return { value: value.slice(0, start) + value.slice(end), caret: start };
  if (start === 0) return { value, caret: 0 };
  return { value: value.slice(0, start - 1) + value.slice(start), caret: start - 1 };
}

export const OSK_CSS = `
.osk { width: 100%; }
.osk-case {
  position: relative;
  padding: 1.1% 1.3%;
  border-radius: 6px;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.045) 0%, transparent 9%),
    linear-gradient(178deg, #ad7440 0%, #9d6636 26%, #895128 55%, #764a24 78%, #63391a 100%);
  box-shadow:
    0 0.5px 0 rgba(255,222,185,0.18) inset,
    0 -2px 4.5px rgba(35,19,6,0.32) inset,
    0 3px 6px rgba(15,8,3,0.22);
}
.osk-tone, .osk-grain {
  position: absolute; inset: 0; border-radius: 6px;
  mix-blend-mode: multiply; pointer-events: none;
}
.osk-tone { background-size: 520px 520px; opacity: 0.46; }
.osk-grain { background-size: 460px 460px; opacity: 0.5; }
.osk-bezel {
  position: relative;
  display: flex; flex-direction: column; gap: 3px;
  padding: 4px;
  border-radius: 4px;
  background: linear-gradient(155deg, #15120e 0%, #0e0c08 50%, #0a0805 100%);
  box-shadow: inset 0 2.5px 6px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(0,0,0,0.32);
}
.osk-row { display: flex; gap: 3px; }

.osk-key {
  position: relative;
  min-width: 0;
  height: clamp(1.9rem, 3.6vw, 2.6rem);
  padding: 0; border: 0; background: none;
  cursor: pointer;
  /* The caret must stay in the text field, so the key never takes focus. */
  -webkit-tap-highlight-color: transparent;
  touch-action: none;
  --tilt: 0deg;
  transform: translateY(0) rotate(var(--tilt));
  transition: transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.osk-key[data-pressed="true"] {
  transform: translateY(3px) scale(0.978) rotate(calc(var(--tilt) * 0.3));
  transition: transform 15ms linear;
}
.osk-key:focus-visible { outline: 2px solid var(--brand-accent, #5e6ad2); outline-offset: 2px; }

.osk-wall {
  position: absolute; inset: 0; border-radius: 6px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -1.5px 2px rgba(15,9,4,0.16);
}
.osk-top {
  position: absolute; inset: 3px 3.5px 8px 3.5px; border-radius: 5px;
  background-size: 40px 40px;
  box-shadow: inset 0 0 0 0.75px rgba(96,70,42,0.28), inset 0 0.6px 0 rgba(255,250,238,0.4);
}
.osk-legend { position: absolute; inset: 0; pointer-events: none; }
.osk-shift {
  position: absolute; top: 14%; left: 18%;
  font-size: clamp(0.44rem, 0.8vw, 0.56rem); font-weight: 500;
  color: ${INK_SOFT}; opacity: 0.66; line-height: 1;
}
.osk-label {
  position: absolute; bottom: 26%; left: 50%; transform: translateX(-50%);
  font-size: clamp(0.68rem, 1.3vw, 0.9rem); font-weight: 700;
  color: ${INK}; line-height: 1; white-space: nowrap;
}
.osk-label--small { font-size: clamp(0.5rem, 0.95vw, 0.66rem); font-weight: 600; }

/* Sticky keys read as held, which is the only way to tell Shift is armed. */
.osk-key[data-key="lshift"][data-pressed="true"] .osk-top,
.osk-key[data-key="caps"][data-pressed="true"] .osk-top {
  background: #b9c4f0;
}

@media (prefers-reduced-motion: reduce) {
  .osk-key, .osk-key[data-pressed="true"] { transition: none; }
}
`;
