import { useCallback, useEffect, useState } from "react";

/**
 * Asking the organizers or the mentors for something.
 *
 * Rebuilt from a supplied textarea and select. Both were a `cn()` call around a
 * Tailwind string and a Radix primitive; there is no Tailwind here and the
 * select pulled in @radix-ui/react-select plus @radix-ui/react-icons to render
 * a listbox the platform already has. A native <select> is keyboard-navigable,
 * works with a screen reader, opens as a wheel on iOS, and costs nothing.
 *
 * What is deliberate rather than inherited:
 *
 *   The audience is a role, not a person. With one mentor on the programme a
 *   name would work today and break the moment there are two, or the moment he
 *   hands over.
 *
 *   The founder's name goes with it, and the form says so before they type. A
 *   check-in is private because it is thinking out loud; this is addressed to
 *   somebody and expects an answer, which cannot happen anonymously. Better to
 *   say that plainly than to let somebody discover it afterwards.
 */

export type WishReply = { id: string; authorName: string; body: string; createdAt: string };
export type Wish = {
  id: string;
  fromEmail: string;
  fromName: string;
  audience: "organizers" | "mentors";
  body: string;
  status: "open" | "answered";
  createdAt: string;
  replies: WishReply[];
};

export const AUDIENCE_LABEL: Record<Wish["audience"], string> = {
  organizers: "The organisers",
  mentors: "The mentors",
};

/** "12 Aug" or "12 Aug 2025", from the SQLite "YYYY-MM-DD HH:MM:SS" form. */
export function whenLabel(value: string, now = new Date()): string {
  const date = new Date(value.replace(" ", "T") + "Z");
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }),
  });
}

/* Takes nothing. The list is "my wishes" as decided by the session on the
   server, which is the only place that can decide it safely. */
export default function Wishes() {
  const [wishes, setWishes] = useState<Wish[] | null>(null);
  const [audience, setAudience] = useState<Wish["audience"]>("organizers");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  const load = useCallback(() => {
    fetch("/api/wishes")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setWishes((d.wishes as Wish[]) ?? []); })
      .catch(() => setWishes([]));
  }, []);

  useEffect(load, [load]);

  const send = useCallback(async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setNote(null);
    try {
      const res = await fetch("/api/wishes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience, body: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote({ text: (data as { error?: string }).error ?? "That did not send.", bad: true });
        return;
      }
      setBody("");
      setNote({ text: `Sent to ${AUDIENCE_LABEL[audience].toLowerCase()}. They get an email.`, bad: false });
      load();
    } catch {
      setNote({ text: "Could not reach the server.", bad: true });
    } finally {
      setSending(false);
    }
  }, [audience, body, sending, load]);

  const left = 2000 - body.length;

  return (
    <div className="wi-wrap">
      <style>{WISHES_CSS}</style>

      <header className="wi-head">
        <h1 className="wi-title">Ask for something</h1>
        <p className="wi-sub">
          Anything you want from the programme: a session on a topic, an
          introduction, a change to how something runs, a problem worth naming.
          It goes to the people who can act on it.
        </p>
      </header>

      <div className="wi-columns">
      <section className="wi-form">
        <label className="wi-label" htmlFor="wi-audience">Who is this for</label>
        <select
          id="wi-audience"
          className="wi-select"
          value={audience}
          onChange={(event) => setAudience(event.target.value as Wish["audience"])}
        >
          <option value="organizers">The organisers — how the programme runs</option>
          <option value="mentors">The mentors — advice and expertise</option>
        </select>

        <label className="wi-label" htmlFor="wi-body">What would you like</label>
        <textarea
          id="wi-body"
          className="wi-textarea"
          rows={5}
          maxLength={2000}
          value={body}
          placeholder="A session on pricing would help us more than another pitch practice."
          onChange={(event) => setBody(event.target.value)}
        />

        <div className="wi-actions">
          {/* Said before sending, not discovered afterwards. */}
          <p className="wi-note">
            Sent with your name. {AUDIENCE_LABEL[audience]} get an email and can reply here.
          </p>
          {/* Only once it matters. A counter reading "2000" beside an empty box
              is a limit nobody was approaching being announced anyway. */}
          {left < 200 && <span className={`wi-count${left < 50 ? " is-low" : ""}`}>{left}</span>}
          <button type="button" className="wi-send" onClick={send} disabled={!body.trim() || sending}>
            {sending ? "Sending…" : "Send"}
          </button>
        </div>

        {note && <p className={`wi-message${note.bad ? " is-bad" : ""}`}>{note.text}</p>}
      </section>

      <section className="wi-list">
        <h2 className="wi-listhead">What you have asked</h2>
        {wishes === null ? (
          <p className="wi-empty">Loading…</p>
        ) : wishes.length === 0 ? (
          <p className="wi-empty">Nothing yet. The first one is above.</p>
        ) : (
          wishes.map((wish) => (
            <article key={wish.id} className="wi-item">
              <div className="wi-itemhead">
                <span className="wi-to">{AUDIENCE_LABEL[wish.audience]}</span>
                <span className="wi-when">{whenLabel(wish.createdAt)}</span>
                <span className={`wi-status${wish.status === "answered" ? " is-answered" : ""}`}>
                  {wish.status === "answered" ? "Answered" : "Waiting"}
                </span>
              </div>
              <p className="wi-body">{wish.body}</p>
              {wish.replies.map((reply) => (
                <div key={reply.id} className="wi-reply">
                  <p className="wi-replyhead">
                    {reply.authorName} · {whenLabel(reply.createdAt)}
                  </p>
                  <p className="wi-body">{reply.body}</p>
                </div>
              ))}
            </article>
          ))
        )}
      </section>
      </div>
    </div>
  );
}

export const WISHES_CSS = `
.wi-wrap { max-width: min(1280px, 100%); margin: 0 auto; padding: 40px 32px 80px; }

/*
 * Two columns once there is room for two.
 *
 * Widening the container alone would have left the same narrow column sitting
 * in a wider box, which is the complaint rather than the fix. The form and the
 * history are different jobs and neither needs the full width, so on a large
 * screen they sit side by side and the page is actually full.
 */
@media (min-width: 1040px) {
  .wi-columns {
    display: grid;
    grid-template-columns: minmax(0, 420px) minmax(0, 1fr);
    gap: 40px;
    align-items: start;
  }
  .wi-list { margin-top: 0; }
}
.wi-head {
  /* Clear of the docked mascot, which floats over this corner. */
  padding-right: var(--mascot-gutter, 0px); margin-bottom: 24px; }
.wi-title {
  margin: 0; font-size: 1.75rem; font-weight: 700;
  letter-spacing: -0.022em; color: var(--ink);
}
.wi-sub {
  margin: 6px 0 0; max-width: 56ch;
  font-size: 0.9375rem; line-height: 1.55; color: var(--ink-sub, #8a8f98);
}

.wi-form {
  display: flex; flex-direction: column; gap: 8px;
  padding: 20px; border: 1px solid var(--line-strong, rgba(255,255,255,0.14));
  border-radius: 14px; background: rgba(255,255,255,0.02);
}
.wi-label {
  font-size: 0.75rem; font-weight: 700;
  letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--ink-sub, #8a8f98);
}
.wi-label + .wi-select, .wi-label + .wi-textarea { margin-bottom: 8px; }

.wi-select, .wi-textarea {
  width: 100%; padding: 10px 12px;
  border: 1px solid var(--line-strong, rgba(255,255,255,0.14));
  border-radius: 10px;
  background: var(--surface, #0e0f12); color: var(--ink);
  font: inherit; font-size: 0.9375rem;
}
.wi-textarea { resize: vertical; min-height: 108px; line-height: 1.55; }
.wi-select:focus-visible, .wi-textarea:focus-visible {
  outline: none; border-color: var(--brand-accent);
  box-shadow: 0 0 0 3px rgba(94, 106, 210, 0.22);
}

.wi-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.wi-note {
  flex: 1 1 260px; margin: 0;
  font-size: 0.8125rem; line-height: 1.45; color: var(--ink-sub, #8a8f98);
}
.wi-count { font-size: 0.75rem; color: var(--ink-sub, #8a8f98); font-variant-numeric: tabular-nums; }
.wi-count.is-low { color: var(--brand-accent); }
.wi-send {
  padding: 9px 20px; border: 0; border-radius: 10px;
  background: var(--brand-accent); color: #fff;
  font: 700 0.875rem/1 inherit; cursor: pointer;
}
.wi-send:hover:not(:disabled) { filter: brightness(1.1); }
.wi-send:disabled { opacity: 0.45; cursor: default; }
.wi-send:focus-visible { outline: 2px solid var(--brand-accent); outline-offset: 2px; }

.wi-message { margin: 4px 0 0; font-size: 0.8125rem; color: #7CB893; }
.wi-message.is-bad { color: #e5484d; }

.wi-list { margin-top: 34px; }
.wi-listhead {
  margin: 0 0 12px; font-size: 0.75rem; font-weight: 700;
  letter-spacing: 0.07em; text-transform: uppercase; color: var(--ink-sub, #8a8f98);
}
.wi-empty { margin: 0; font-size: 0.9375rem; color: var(--ink-sub, #8a8f98); }

.wi-item { padding: 14px 0; border-top: 1px solid var(--line); }
.wi-itemhead { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
.wi-to { font-size: 0.8125rem; font-weight: 600; color: var(--ink); }
.wi-when { font-size: 0.75rem; color: var(--ink-sub, #8a8f98); }
.wi-status {
  margin-left: auto; padding: 1px 8px; border-radius: 999px;
  border: 1px solid var(--line-strong, rgba(255,255,255,0.14));
  font-size: 0.6875rem; font-weight: 600; color: var(--ink-sub, #8a8f98);
}
.wi-status.is-answered { border-color: rgba(124,184,147,0.5); color: #7CB893; }
.wi-body {
  margin: 0; max-width: 62ch;
  font-size: 0.9375rem; line-height: 1.55; color: var(--ink-sub, #8a8f98);
  white-space: pre-wrap;
}
.wi-reply {
  margin-top: 12px; padding-left: 14px;
  border-left: 2px solid var(--brand-accent);
}
.wi-replyhead {
  margin: 0 0 3px; font-size: 0.75rem; font-weight: 700;
  color: var(--ink);
}

@media (max-width: 720px) {
  .wi-wrap { padding: 24px 16px 64px; }
  .wi-form { padding: 16px; }
  .wi-send { flex: 1 1 100%; }
}
`;
