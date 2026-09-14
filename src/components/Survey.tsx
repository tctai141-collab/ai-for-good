import { useCallback, useEffect, useMemo, useState } from "react";
import { RatingScaleGroup, RatingScaleItem } from "@/components/ui/rating-scale-group";

/**
 * Taking a survey round.
 *
 * Roman's questionnaire, which used to be a Webropol link. The account says
 * who answered, so there is no name field. Every statement is required and an
 * answer cannot be changed after sending, as it was in Webropol: this is
 * research data, compared round to round.
 *
 * The rating scale is the shadcn component under ./ui, wrapped in .sb-shadcn so
 * it takes Sprint Buddy's palette. Everything else here is styled the way the
 * rest of the app is, with a component-owned CSS string.
 */

type Item = { id: string; statement: string };
type Group = { id: string; heading: string; lowLabel: string; highLabel: string; items: Item[] };
type Round = { id: string; title: string; intro: string; opensAt: string; closesAt: string; groups: Group[] };
type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "none"; next: { title: string; opensAt: string } | null }
  | { kind: "done"; title: string }
  | { kind: "open"; round: Round; staff: boolean };

const POINTS = ["1", "2", "3", "4", "5"];

function helsinki(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/Helsinki", weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function Survey({ onDone }: { onDone?: () => void }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/survey");
      const data = await res.json();
      if (!res.ok) return setState({ kind: "error", message: data.error ?? "Could not load the survey." });
      if (!data.round) return setState({ kind: "none", next: data.next ?? null });
      if (data.submitted) return setState({ kind: "done", title: data.round.title });
      setState({ kind: "open", round: data.round, staff: data.staff === true });
    } catch {
      setState({ kind: "error", message: "Could not reach the server." });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const itemIds = useMemo(
    () => (state.kind === "open" ? state.round.groups.flatMap((g) => g.items.map((i) => i.id)) : []),
    [state],
  );
  const answered = itemIds.filter((id) => answers[id]).length;
  const complete = itemIds.length > 0 && answered === itemIds.length;

  const send = async () => {
    /* Organizers preview; the server refuses their answers anyway. */
    if (state.kind !== "open" || state.staff || !complete || sending) return;
    setSending(true);
    setNote(null);
    try {
      const res = await fetch("/api/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", roundId: state.round.id, answers }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok || res.status === 409) {
        setState({ kind: "done", title: state.round.title });
        onDone?.();
        return;
      }
      setNote((data as { error?: string }).error ?? "That did not send. Your answers are still here.");
    } catch {
      setNote("Could not reach the server. Your answers are still here.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="sv-wrap">
      <style>{SURVEY_CSS}</style>

      {state.kind === "loading" && <p className="sv-quiet">Loading…</p>}

      {state.kind === "error" && (
        <>
          <h1 className="sv-title">Survey</h1>
          <p className="sv-quiet">{state.message}</p>
        </>
      )}

      {state.kind === "none" && (
        <>
          <h1 className="sv-title">Survey</h1>
          <p className="sv-lede">No survey open right now.</p>
          {state.next && (
            <p className="sv-quiet">{state.next.title} opens {helsinki(state.next.opensAt)}.</p>
          )}
        </>
      )}

      {state.kind === "done" && (
        <>
          <h1 className="sv-title">{state.title}</h1>
          <p className="sv-lede">Recorded, thank you.</p>
          <p className="sv-quiet">Answers cannot be changed once sent.</p>
        </>
      )}

      {state.kind === "open" && (
        <>
          <header className="sv-head">
            {state.staff && (
              <p className="sv-preview" role="note">
                Staff preview. This round is open and founders can answer it now.
                Organizer accounts cannot send answers; the responses are in
                admin, under Survey.
              </p>
            )}
            <h1 className="sv-title">{state.round.title}</h1>
            {state.round.intro.split(/\n{2,}/).map((para, i) => (
              <p key={i} className="sv-intro">{para}</p>
            ))}
            <p className="sv-quiet">Open until {helsinki(state.round.closesAt)}.</p>
          </header>

          {state.round.groups.map((group) => (
            <section key={group.id} className="sv-group">
              <h2 className="sv-heading">{group.heading}</h2>
              {group.items.map((item) => (
                <div key={item.id} className="sv-item">
                  <p className="sv-statement" id={`sv-${item.id}`}>{item.statement}</p>
                  {/* Wrapped so the shadcn variables apply to this scale and
                      nowhere else in the app. */}
                  <div className="sb-shadcn sv-scale">
                    <RatingScaleGroup
                      aria-labelledby={`sv-${item.id}`}
                      value={answers[item.id] ? String(answers[item.id]) : ""}
                      onValueChange={(v) => setAnswers((prev) => ({ ...prev, [item.id]: Number(v) }))}
                    >
                      {POINTS.map((p) => (
                        <RatingScaleItem key={p} value={p} label={p} aria-label={`${p} of 5`} />
                      ))}
                    </RatingScaleGroup>
                    <div className="sv-anchors" aria-hidden="true">
                      <span>{group.lowLabel}</span>
                      <span>{group.highLabel}</span>
                    </div>
                  </div>
                </div>
              ))}
            </section>
          ))}

          {!state.staff && (
            <div className="sv-actions">
              <button type="button" className="sv-send" onClick={send} disabled={!complete || sending}>
                {sending ? "Sending…" : "Send answers"}
              </button>
              <span className="sv-count">{answered} of {itemIds.length} answered</span>
            </div>
          )}
          {note && <p className="sv-note">{note}</p>}
        </>
      )}
    </div>
  );
}

export const SURVEY_CSS = `
.sv-wrap { max-width: min(860px, 100%); margin: 0 auto; padding: 40px 32px 96px; color: var(--ink); }
.sv-head { padding-right: var(--mascot-gutter, 0px); margin-bottom: 28px; }
.sv-title { margin: 0 0 10px; font-size: 1.75rem; font-weight: 700; letter-spacing: -0.022em; color: var(--ink); }
.sv-intro { margin: 0 0 10px; max-width: 62ch; font-size: 0.9375rem; line-height: 1.6; color: var(--ink-sub); }
.sv-lede { margin: 0 0 6px; font-size: 1rem; color: var(--ink-sub); }
.sv-quiet { margin: 4px 0 0; font-size: 0.8125rem; line-height: 1.5; color: var(--ink-faint); }
.sv-group { margin-top: 28px; border-top: 1px solid var(--line-strong); padding-top: 20px; }
.sv-heading { margin: 0 0 8px; font-size: 1rem; font-weight: 650; line-height: 1.45; color: var(--ink); }
.sv-item {
  display: grid; grid-template-columns: minmax(0, 1fr) 248px; gap: 12px 28px; align-items: center;
  padding: 14px 0; border-bottom: 1px solid var(--line);
}
.sv-statement { margin: 0; font-size: 0.9375rem; line-height: 1.5; color: var(--ink-sub); }
.sv-scale { color: var(--ink); }
.sv-anchors { display: flex; justify-content: space-between; gap: 8px; margin-top: 6px; font-size: 0.6875rem; line-height: 1.3; color: var(--ink-faint); }
.sv-anchors span:last-child { text-align: right; }
.sv-actions { display: flex; align-items: center; gap: 14px; margin-top: 28px; }
.sv-send {
  min-height: 40px; padding: 0 20px; border-radius: 999px;
  border: 1px solid var(--line-strong); background: var(--brand-accent); color: #fff;
  font: 700 0.9375rem/1 inherit; cursor: pointer;
}
.sv-send:disabled { opacity: 0.45; cursor: default; }
.sv-send:focus-visible { outline: 2px solid var(--brand-accent); outline-offset: 2px; }
.sv-count { font-size: 0.8125rem; color: var(--ink-faint); font-variant-numeric: tabular-nums; }
.sv-preview {
  margin: 0 0 18px; padding: 10px 14px; max-width: 62ch;
  border: 1px solid var(--line-strong); border-radius: 10px;
  background: rgba(94, 106, 210, 0.12);
  font-size: 0.875rem; line-height: 1.5; color: var(--ink-sub);
}
.sv-note { margin: 12px 0 0; font-size: 0.875rem; color: var(--danger, #eb5757); }
/* On a phone the statement sits above its scale, and the scale keeps its width:
   five 40px boxes and the gaps between them fit inside 320px. */
@media (max-width: 640px) {
  .sv-wrap { padding: 24px 16px 80px; }
  .sv-item { grid-template-columns: minmax(0, 1fr); }
  .sv-scale { max-width: 248px; }
}
`;
