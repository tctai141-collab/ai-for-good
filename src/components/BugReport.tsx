import { useCallback, useState } from "react";

/**
 * Reporting a bug.
 *
 * Deliberately the smallest thing that works: a box, a button, and two fields
 * filled in by the browser that the person filing never sees or thinks about.
 *
 * It does not list what you have reported before. Reports carry a status an
 * organizer moves, and that status is not shown to whoever filed it — so a
 * list here would be a row with nothing on it, raising exactly the question
 * the design has chosen not to answer. Better to say plainly where it went.
 *
 * Anyone signed in can file. A founder reaches this from their sidebar; an
 * organizer or mentor from the Bugs tab on /admin, which is also where they
 * are read.
 */

const MAX = 2000;

/**
 * `from` is the screen the reporter was on when they went looking for this
 * form, passed in by the app.
 *
 * It used to be read here as `location.pathname`, which is honest-looking and
 * useless: Sprint Buddy is one page, so that string is "/" for every report
 * ever filed. Worse, the obvious repair — read it at submit — records "Report
 * a bug" every time, because that is where they are standing by then. The only
 * screen worth knowing is the one they left.
 */
export default function BugReport({ from }: { from?: string }) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  const send = useCallback(async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setNote(null);
    try {
      const res = await fetch("/api/bugs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: text,
          /*
           * The two things nobody would think to include, and the two that
           * usually decide how long the bug takes to find: the screen they came
           * from, and the browser — the difference between a bug everybody has
           * and one only iPhones have.
           */
          page: from ?? "",
          userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote({ text: (data as { error?: string }).error ?? "That did not send.", bad: true });
        return;
      }
      setBody("");
      setNote({ text: "Reported. The team gets an email with the details.", bad: false });
    } catch {
      setNote({ text: "Could not reach the server.", bad: true });
    } finally {
      setSending(false);
    }
  }, [body, sending, from]);

  const left = MAX - body.length;

  return (
    <div className="bug-wrap">
      <style>{BUG_CSS}</style>

      <header className="bug-head">
        <h1 className="bug-title">Report a bug</h1>
        <p className="bug-sub">
          Something broken, something that looks wrong, something that did not
          do what you expected. A sentence is enough — say what you were doing
          and what happened.
        </p>
      </header>

      <div className="bug-form">
        <label className="bug-label" htmlFor="bug-body">What went wrong</label>
        <textarea
          id="bug-body"
          className="bug-input"
          value={body}
          maxLength={MAX}
          rows={6}
          placeholder="I tapped today's check-in on my phone and nothing happened."
          onChange={(e) => setBody(e.target.value)}
        />

        <div className="bug-actions">
          <button
            type="button"
            className="bug-send"
            onClick={send}
            disabled={!body.trim() || sending}
          >
            {sending ? "Sending…" : "Report it"}
          </button>
          {/* Only once it is close. A counter reading 2000 beside an empty box
              announces a limit nobody was approaching. */}
          {left < 200 && <span className="bug-left">{left} left</span>}
        </div>

        {note && <p className={`bug-note${note.bad ? " is-bad" : ""}`}>{note.text}</p>}

        {/*
          Said before they type, not after they send. Which screen they came
          from and which browser they use goes with the report, and somebody
          should know that while deciding what to write rather than discovering
          it afterwards.
        */}
        <p className="bug-fine">
          Sent with your name, the screen you came from, and
          which browser you are using. Nothing else from your account goes with it.
        </p>
      </div>
    </div>
  );
}

export const BUG_CSS = `
.bug-wrap { max-width: min(1280px, 100%); margin: 0 auto; padding: 40px 32px 80px; }
.bug-head {
  /* Clear of the docked mascot, which floats over this corner. */
  padding-right: var(--mascot-gutter, 0px); margin-bottom: 24px;
}
.bug-title {
  margin: 0; font-size: 1.75rem; font-weight: 700;
  letter-spacing: -0.022em; color: var(--ink);
}
.bug-sub {
  margin: 6px 0 0; max-width: 56ch;
  font-size: 0.9375rem; line-height: 1.55; color: var(--ink-sub, #8a8f98);
}

.bug-form { max-width: 620px; }
.bug-label {
  display: block; margin-bottom: 6px;
  font-size: 0.75rem; font-weight: 700; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--ink-sub, #8a8f98);
}
.bug-input {
  width: 100%; padding: 12px 14px;
  border-radius: 10px; border: 1px solid var(--line-strong, rgba(255,255,255,0.14));
  background: rgba(0,0,0,0.28); color: var(--ink);
  font-family: inherit; font-size: 0.9375rem; line-height: 1.55;
  resize: vertical;
}
.bug-input:focus-visible { outline: 2px solid var(--brand-accent); outline-offset: 1px; }

.bug-actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
.bug-send {
  min-height: 38px; padding: 0 18px;
  border-radius: 999px; border: 1px solid var(--line-strong, rgba(255,255,255,0.14));
  background: rgba(255,255,255,0.06); color: var(--ink);
  font: 700 0.875rem/1 inherit; cursor: pointer;
}
.bug-send:hover:not(:disabled) { background: rgba(255,255,255,0.10); }
.bug-send:disabled { opacity: 0.45; cursor: default; }
.bug-send:focus-visible { outline: 2px solid var(--brand-accent); outline-offset: 2px; }
.bug-left {
  font-size: 0.8125rem; color: var(--ink-faint, #8a8f98);
  font-variant-numeric: tabular-nums;
}

.bug-note { margin: 12px 0 0; font-size: 0.875rem; line-height: 1.5; color: var(--ok, #4cb782); }
.bug-note.is-bad { color: var(--danger, #eb5757); }
.bug-fine {
  margin: 18px 0 0; max-width: 52ch;
  font-size: 0.8125rem; line-height: 1.55; color: var(--ink-faint, #8a8f98);
}

@media (max-width: 720px) {
  .bug-wrap { padding: 24px 16px 64px; }
}
`;
