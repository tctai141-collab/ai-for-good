import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The operating team's assistant, in the dashboard rather than on /admin.
 *
 * It started as a tab on the admin page, which was the wrong home: /admin is
 * where you go to *change* something — add a founder, set a deadline, edit the
 * programme. Asking who to talk to this week is not administration, it is the
 * thing you do before deciding anything, and it belongs beside the cohort
 * heatmap where that question is already being asked.
 *
 * Organizers only, which is why the sidebar entry is not rendered for a mentor
 * at all rather than shown and refused. The briefing behind it is the whole
 * cohort's state and a mentor's view of this app is deliberately narrower.
 *
 * What it can and cannot see is decided server-side in lib/admin-context.ts,
 * not here. This is a transcript and a text box.
 */

type Turn = { role: "user" | "assistant"; content: string };

const EXAMPLES = [
  "Who should I talk to this week?",
  "What is due in the next fortnight?",
  "What has the cohort asked us for?",
];

export default function Assistant() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  /* Follows the answer as it streams, which is the whole reason to stream. */
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [turns]);

  const ask = useCallback(async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;

    setBusy(true);
    setError(null);
    setDraft("");

    const history: Turn[] = [...turns, { role: "user", content: text }];
    setTurns([...history, { role: "assistant", content: "" }]);

    let res: Response;
    try {
      res = await fetch("/api/admin/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
    } catch {
      setError("Could not reach the server.");
      setTurns(history);
      setBusy(false);
      return;
    }

    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "That did not work.");
      setTurns(history);
      setBusy(false);
      return;
    }

    /* OpenAI-shaped SSE, the same as the founder chat, so the parsing is the
       same handful of lines. */
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const chunk = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
          const bit = chunk.choices?.[0]?.delta?.content;
          if (!bit) continue;
          answer += bit;
          setTurns([...history, { role: "assistant", content: answer }]);
        } catch {
          // A half-arrived frame; the next read completes it.
        }
      }
    }

    setBusy(false);
    inputRef.current?.focus();
  }, [busy, turns]);

  const showBriefing = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ briefing: true }),
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "That did not work.");
        return;
      }
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: `This is everything I am given, word for word:\n\n${data.text ?? ""}` },
      ]);
    } catch {
      setError("Could not reach the server.");
    }
  }, []);

  return (
    <div className="as-wrap">
      <style>{ASSISTANT_CSS}</style>

      <header className="as-head">
        <h1 className="as-title">Assistant</h1>
        <p className="as-sub">
          It reads what you can: attention scores and themes, deadlines and who is
          behind, the programme, what the cohort has asked for, and the titles of
          conversations handed over.
        </p>
        <p className="as-sub as-quiet">
          It cannot read founders&rsquo; conversations, the words of their check-ins,
          or their working-style answers. Those are private to each founder and the
          team has never had them. It will say so rather than guess.
        </p>
      </header>

      {turns.length > 0 && (
        <div className="as-log" ref={logRef} aria-live="polite">
          {turns.map((turn, i) => (
            <div key={i} className={`as-turn is-${turn.role}`}>
              <span className="as-who">{turn.role === "user" ? "You" : "Assistant"}</span>
              <p className="as-text">
                {turn.content || (busy && i === turns.length - 1 ? "…" : "")}
              </p>
            </div>
          ))}
        </div>
      )}

      {turns.length === 0 && (
        <div className="as-examples">
          {EXAMPLES.map((example) => (
            <button key={example} type="button" className="as-eg" onClick={() => ask(example)}>
              {example}
            </button>
          ))}
          {/* An assistant claiming a privacy boundary should let somebody read
              the thing it is actually given, rather than take the claim on
              faith. This prints the briefing verbatim. */}
          <button type="button" className="as-eg" onClick={showBriefing}>
            Show me exactly what you can see
          </button>
        </div>
      )}

      <form
        className="as-form"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(draft);
        }}
      >
        <textarea
          ref={inputRef}
          className="as-input"
          rows={2}
          maxLength={2000}
          value={draft}
          placeholder="Who should I talk to this week?"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, shift+enter is a newline. Same as the founder side.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void ask(draft);
            }
          }}
        />
        <button type="submit" className="as-send" disabled={busy || !draft.trim()}>
          {busy ? "…" : "Ask"}
        </button>
      </form>

      {error && <p className="as-error" role="status">{error}</p>}
    </div>
  );
}

export const ASSISTANT_CSS = `
/* Wider than it was, but the transcript keeps its measure below: a chat read
   at 140 characters a line is worse, not fuller. */
.as-wrap { max-width: min(1100px, 100%); margin: 0 auto; padding: 40px 32px 80px; }

.as-head {
  /* Clear of the docked mascot, which floats over this corner. */
  padding-right: var(--mascot-gutter, 0px); margin-bottom: 22px; }
.as-title {
  margin: 0; font-size: 1.75rem; font-weight: 700;
  letter-spacing: -0.022em; color: var(--ink);
}
.as-sub {
  margin: 8px 0 0; max-width: 62ch;
  font-size: 0.9375rem; line-height: 1.55; color: var(--ink-sub, #8a8f98);
}
.as-quiet { font-size: 0.875rem; opacity: 0.82; }

.as-log {
  display: flex; flex-direction: column; gap: 18px;
  max-height: 52vh; overflow-y: auto;
  margin: 8px 0 18px; padding: 4px 2px;
}
.as-turn { display: flex; flex-direction: column; gap: 4px; }
.as-who {
  font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.07em;
  text-transform: uppercase; color: var(--ink-sub, #8a8f98);
}
.as-turn.is-user .as-who { color: var(--brand-accent); }
.as-text {
  margin: 0; max-width: 68ch;
  font-size: 0.9375rem; line-height: 1.62; color: var(--ink);
  white-space: pre-wrap;
}
.as-turn.is-user .as-text { color: var(--ink-sub, #8a8f98); }

.as-examples { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 18px; }
.as-eg {
  padding: 7px 13px; border-radius: 999px;
  border: 1px solid var(--line-strong, rgba(255,255,255,0.14));
  background: transparent; color: var(--ink-sub, #8a8f98);
  font: 500 0.8125rem/1 inherit; cursor: pointer;
  transition: color 140ms ease, border-color 140ms ease;
}
.as-eg:hover { color: var(--ink); border-color: rgba(255,255,255,0.3); }
.as-eg:focus-visible { outline: 2px solid var(--brand-accent); outline-offset: 2px; }

.as-form { display: flex; gap: 10px; align-items: flex-end; }
.as-input {
  flex: 1 1 auto; min-width: 0;
  padding: 11px 13px;
  border: 1px solid var(--line-strong, rgba(255,255,255,0.14));
  border-radius: 12px;
  background: var(--surface-card, #17181a); color: var(--ink);
  font: inherit; font-size: 0.9375rem; line-height: 1.5;
  resize: vertical;
}
.as-input:focus-visible {
  outline: none; border-color: var(--brand-accent);
  box-shadow: 0 0 0 3px rgba(94, 106, 210, 0.22);
}
.as-send {
  flex: 0 0 auto; min-height: 44px; padding: 0 20px;
  border: 0; border-radius: 11px;
  background: var(--brand-accent); color: #fff;
  font: 700 0.875rem/1 inherit; cursor: pointer;
}
.as-send:hover:not(:disabled) { filter: brightness(1.1); }
.as-send:disabled { opacity: 0.45; cursor: default; }
.as-send:focus-visible { outline: 2px solid var(--brand-accent); outline-offset: 2px; }

.as-error { margin: 10px 0 0; font-size: 0.8125rem; color: #e5484d; }

@media (max-width: 720px) {
  .as-wrap { padding: 24px 16px 64px; }
  .as-form { flex-direction: column; align-items: stretch; }
  .as-send { width: 100%; }
}
`;
