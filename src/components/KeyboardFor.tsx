import { useCallback, useEffect, useRef, useState } from "react";
import GlassToggle, { GLASS_TOGGLE_CSS } from "./GlassToggle";
import OnScreenKeyboard, { applyKey, OSK_CSS, type KeyOutput } from "./OnScreenKeyboard";

/**
 * The on-screen keyboard, attached to a textarea the page already owns.
 *
 * /admin is a vanilla page — one 3,000-line inline script and no React except
 * the islands bolted onto it — so the keyboard cannot be handed state the way
 * the founder composer hands it. It is given an element id instead and writes
 * to the DOM node directly.
 *
 * Writing to a DOM node is only correct *because* the node is not React's. On
 * the founder side the same keys go through a functional state update, since
 * a controlled textarea's DOM value is a frame behind and inserting against it
 * loses characters. Two hosts, two ways of applying the same KeyOutput, one
 * applyKey between them so the insertion rules cannot drift apart.
 *
 * There is no chat on /admin — the coach view has a cohort dashboard, not a
 * composer — so this sits under the broadcast message box, which is the one
 * place an organizer writes prose.
 */
export default function KeyboardFor({
  targetId,
  storageKey,
  label = "On-screen keyboard",
}: {
  /** id of the textarea or input to type into. */
  targetId: string;
  /** Where the on/off choice is remembered. */
  storageKey: string;
  label?: string;
}) {
  const [on, setOn] = useState(false);
  const [ready, setReady] = useState(false);
  const targetRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  useEffect(() => {
    /* The panel this sits in may be hidden behind a tab when the island
       mounts, but the element exists either way — /admin keeps every panel in
       the DOM and only toggles hidden. */
    targetRef.current = document.getElementById(targetId) as HTMLTextAreaElement | null;
    try { setOn(localStorage.getItem(storageKey) === "1"); } catch { /* private mode */ }
    setReady(true);
  }, [targetId, storageKey]);

  const toggle = useCallback((next: boolean) => {
    setOn(next);
    try { localStorage.setItem(storageKey, next ? "1" : "0"); } catch { /* private mode */ }
    if (next) requestAnimationFrame(() => targetRef.current?.focus());
  }, [storageKey]);

  const onKey = useCallback((out: KeyOutput) => {
    const el = targetRef.current;
    if (!el) return;

    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const { value, caret } = applyKey(el.value, start, end, out);

    el.value = value;
    el.setSelectionRange(caret, caret);
    el.focus();
    /* The page's own listeners are watching for input — the broadcast panel
       recounts recipients and re-checks the wording hash on every keystroke.
       Setting .value fires nothing on its own, so a message typed here would
       otherwise never unlock the send button. */
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, []);

  /* Nothing rendered until the target has been looked up, so the switch never
     appears beside a field it cannot type into. */
  if (!ready || !targetRef.current) return null;

  return (
    <div className="kbfor">
      <style>{`${GLASS_TOGGLE_CSS}\n${OSK_CSS}\n
.kbfor { margin-top: 12px; }
.kbfor-row { display: flex; align-items: center; gap: 10px; }
.kbfor-label {
  font-size: 0.8125rem;
  color: var(--muted, #8a8f98);
  cursor: pointer;
}
.kbfor-board { margin-top: 12px; }
`}</style>
      <div className="kbfor-row">
        <GlassToggle
          id={`osk-${targetId}`}
          checked={on}
          onChange={toggle}
          label={label}
        />
        <label className="kbfor-label" htmlFor={`osk-${targetId}`}>{label}</label>
      </div>
      {on && (
        <div className="kbfor-board">
          <OnScreenKeyboard onKey={onKey} />
        </div>
      )}
    </div>
  );
}
