import { useCallback, useEffect, useRef, useState } from "react";
import VoiceOrb from "./VoiceOrb";

/**
 * Talking to Sprint Buddy instead of typing.
 *
 * Three decisions worth stating, because each one had an obvious alternative.
 *
 * It dictates into the composer. It does not send. What the microphone heard
 * lands in the box where you can read and fix it, and you press Send yourself.
 * A voice assistant that transmits whatever it thought it heard is how a
 * founder tells their coach "I think we should fire Anna" because the model
 * mangled a sentence about pricing. The text is a draft until a person says
 * otherwise.
 *
 * It uses the browser's own speech recognition rather than an audio endpoint.
 * No new dependency, no new service, no per-minute cost, and the recording
 * never touches this server. The tradeoff is real and is stated on screen
 * rather than buried here: in Chrome this API streams audio to Google for
 * transcription. Sprint Buddy's whole promise is that nothing a founder writes
 * is read by the team, so a feature that hands their speech to a third party
 * has to say so before it is switched on, not after.
 *
 * Safari implements it under a webkit prefix. Firefox does not implement it at
 * all, and the button is simply absent there rather than present and broken.
 */

/* The vendor-prefixed constructors, which no lib.dom typing covers. */
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

/** The constructor this browser has, or null. Firefox has neither. */
export function speechRecognizer(win: SpeechWindow): (new () => SpeechRecognitionLike) | null {
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

/**
 * Joins a dictated phrase onto what is already in the box.
 *
 * The rules are the ones a person would apply without thinking: do not glue
 * two words together, do not put a space before a full stop, and start a
 * sentence with a capital if the last one ended.
 */
export function appendTranscript(existing: string, phrase: string): string {
  const addition = phrase.trim();
  if (!addition) return existing;
  if (!existing.trim()) return addition.charAt(0).toUpperCase() + addition.slice(1);

  const needsSpace = !/\s$/.test(existing);
  const afterSentence = /[.!?]\s*$/.test(existing);
  const head = afterSentence ? addition.charAt(0).toUpperCase() + addition.slice(1) : addition;
  return existing + (needsSpace ? " " : "") + head;
}

/** RMS of a byte-domain analyser frame, 0–1, with a little headroom applied. */
export function levelFromBytes(bytes: Uint8Array | number[]): number {
  if (!bytes.length) return 0;
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    const v = (bytes[i] ?? 0) / 255;
    sum += v * v;
  }
  return Math.min(Math.sqrt(sum / bytes.length) * 3, 1);
}

/** Remembered per browser, so the warning is read once rather than every time. */
const CONSENT_KEY = "sprintbuddy.voice.understood";

export default function VoiceInput({
  onPhrase,
  disabled,
}: {
  /** Called with each settled phrase. The host decides where it lands. */
  onPhrase: (phrase: string) => void;
  disabled?: boolean;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    setSupported(Boolean(speechRecognizer(window as SpeechWindow)));
  }, []);

  /* Everything the microphone touches, released together. A page that keeps
     the recording indicator lit after you stop talking is a page nobody trusts
     twice. */
  const teardown = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (contextRef.current && contextRef.current.state !== "closed") {
      contextRef.current.close().catch(() => {});
    }
    contextRef.current = null;
    setLevel(0);
    setInterim("");
    setListening(false);
  }, []);

  useEffect(() => teardown, [teardown]);

  const start = useCallback(async () => {
    const Recognizer = speechRecognizer(window as SpeechWindow);
    if (!Recognizer) return;

    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      /* Denied, or no microphone. Both are the same sentence to a founder, and
         neither is worth a stack trace. */
      setError("No microphone. Check the browser has permission.");
      return;
    }
    streamRef.current = stream;

    /* The meter is separate from the recognizer: the API reports words, never
       loudness, and without a level the orb would sit still while somebody
       talks into a muted headset. */
    try {
      const context = new AudioContext();
      contextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      const bytes = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        rafRef.current = requestAnimationFrame(tick);
        analyser.getByteFrequencyData(bytes);
        setLevel(levelFromBytes(bytes));
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      // No meter is survivable; the orb just sits at rest.
    }

    const recognition = new Recognizer();
    recognitionRef.current = recognition;
    recognition.lang = navigator.language || "en-GB";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let pending = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result?.[0]?.transcript ?? "";
        if (result?.isFinal) onPhrase(text);
        else pending += text;
      }
      setInterim(pending);
    };
    recognition.onerror = (event) => {
      if (event.error === "no-speech") return; // Ordinary, not a failure.
      setError(event.error === "not-allowed" ? "Microphone permission was refused." : "Dictation stopped.");
      teardown();
    };
    recognition.onend = () => teardown();

    try {
      recognition.start();
      setListening(true);
    } catch {
      setError("Dictation would not start.");
      teardown();
    }
  }, [onPhrase, teardown]);

  const toggle = useCallback(() => {
    if (listening) {
      teardown();
      return;
    }
    /* Asked once per browser, before the microphone opens rather than after.
       Somebody who would not have agreed should not have already spoken. */
    let understood = false;
    try { understood = localStorage.getItem(CONSENT_KEY) === "1"; } catch { /* private mode */ }
    if (!understood) {
      setAsking(true);
      return;
    }
    void start();
  }, [listening, start, teardown]);

  const accept = useCallback(() => {
    try { localStorage.setItem(CONSENT_KEY, "1"); } catch { /* private mode */ }
    setAsking(false);
    void start();
  }, [start]);

  if (!supported) return null;

  return (
    <>
      <style>{VOICE_CSS}</style>

      <button
        type="button"
        className={`vi-button${listening ? " is-live" : ""}`}
        onClick={toggle}
        disabled={disabled}
        aria-pressed={listening}
        aria-label={listening ? "Stop dictating" : "Dictate a message"}
        title={listening ? "Stop dictating" : "Dictate a message"}
      >
        {listening ? (
          <VoiceOrb level={level} active={listening} size={26} />
        ) : (
          <span aria-hidden="true" className="vi-mic">◎</span>
        )}
      </button>

      {/* Live region: what it heard, before it settles. Somebody dictating is
          looking at the screen to see whether it is getting the words right. */}
      {listening && (
        <p className="vi-interim" aria-live="polite">
          {interim || "Listening…"}
        </p>
      )}
      {error && <p className="vi-error" role="status">{error}</p>}

      {asking && (
        <div className="vi-scrim" role="dialog" aria-modal="true" aria-labelledby="vi-title">
          <div className="vi-dialog">
            <h2 id="vi-title">Before you use the microphone</h2>
            <p>
              Dictation is your browser&rsquo;s, not ours. In Chrome that means
              your <strong>speech is sent to Google</strong> to be turned into
              text. It does not pass through Sprint Buddy&rsquo;s servers, and we
              never store the audio, but it does leave your machine.
            </p>
            <p>
              Everything else you write here stays between you and Sprint Buddy.
              This one feature does not, which is why you are being asked.
            </p>
            <div className="vi-dialogactions">
              <button type="button" className="vi-secondary" onClick={() => setAsking(false)}>
                Not now
              </button>
              <button type="button" className="vi-primary" onClick={accept}>
                I understand, start
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export const VOICE_CSS = `
.vi-button {
  flex: 0 0 auto;
  width: 38px; height: 38px;
  display: grid; place-items: center;
  padding: 0; border: 1px solid var(--line-strong, rgba(255,255,255,0.14));
  border-radius: 10px; background: transparent;
  color: var(--ink-sub, #8a8f98); cursor: pointer;
  transition: border-color 140ms ease, color 140ms ease;
}
.vi-button:hover:not(:disabled) { color: var(--ink); border-color: rgba(255,255,255,0.28); }
.vi-button:disabled { opacity: 0.4; cursor: default; }
.vi-button:focus-visible { outline: 2px solid var(--brand-accent); outline-offset: 2px; }
.vi-button.is-live { border-color: var(--brand-accent); }
.vi-mic { font-size: 17px; line-height: 1; }

/*
 * The transcript hangs under the composer, not inside it.
 *
 * The composer row is a single nowrap flex line, so a child asking for
 * flex: 1 1 100% does not wrap onto a second row — it takes width from the
 * textarea and spills out past the rounded border. Anchoring to the box and
 * sitting below it leaves the row exactly as it was.
 */
.composer-box { position: relative; }
.vi-interim, .vi-error {
  /* Above the box, not below it. The composer sits on the bottom edge of the
     viewport, so anything hung underneath is drawn off-screen. */
  position: absolute; bottom: calc(100% + 7px); left: 2px; right: 2px;
  margin: 0;
  font-size: 0.8125rem; line-height: 1.45; color: var(--ink-sub, #8a8f98);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.vi-error { color: #e5484d; }

.vi-scrim {
  position: fixed; inset: 0; z-index: 120;
  display: grid; place-items: center; padding: 20px;
  background: rgba(0,0,0,0.55);
}
.vi-dialog {
  width: min(460px, 100%);
  padding: 22px;
  border: 1px solid var(--line-strong, rgba(255,255,255,0.14));
  border-radius: 14px;
  background: var(--surface-card, #17181a);
  box-shadow: 0 18px 50px rgba(0,0,0,0.45);
}
.vi-dialog h2 {
  margin: 0 0 10px; font-size: 1.0625rem; font-weight: 700;
  letter-spacing: -0.015em; color: var(--ink);
}
.vi-dialog p {
  margin: 0 0 10px; font-size: 0.875rem; line-height: 1.6;
  color: var(--ink-sub, #8a8f98);
}
.vi-dialog strong { color: var(--ink); }
.vi-dialogactions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.vi-primary, .vi-secondary {
  min-height: 40px; padding: 0 16px; border-radius: 9px;
  font: 700 0.8125rem/1 inherit; cursor: pointer;
}
.vi-primary { border: 0; background: var(--brand-accent); color: #fff; }
.vi-secondary {
  border: 1px solid var(--line-strong, rgba(255,255,255,0.14));
  background: transparent; color: var(--ink);
}
.vi-primary:focus-visible, .vi-secondary:focus-visible {
  outline: 2px solid var(--brand-accent); outline-offset: 2px;
}
`;
